import { config } from './config.js';
import { db, queries } from './db.js';
import { euipoRequest, EuipoError } from './euipo.js';

/**
 * Monitoring EUIPO: alerty definiowane wzorcem elementu słownego (wildcard `*`).
 * Seed pobiera stan zastany, kolejne sprawdzenia wykrywają nowe wpisy (diff po id).
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // limit 1000 rekordów na alert

const API_DEF = {
  trademark: {
    endpoint: '/trademarks',
    collection: 'trademarks',
    idField: 'applicationNumber',
    queryField: 'wordMarkSpecification.verbalElement',
    sort: 'applicationNumber:desc',
  },
  design: {
    endpoint: '/designs',
    collection: 'designs',
    idField: 'designNumber',
    queryField: 'verbalElement',
    sort: 'designNumber:desc',
  },
};

export class AlertError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Walidacja wzorca: dozwolone litery/cyfry/spacje/`-_.&+` oraz wildcard `*`. */
export function validatePattern(pattern) {
  const trimmed = String(pattern || '').trim();
  if (!trimmed) throw new AlertError(400, 'Wzorzec nie może być pusty.');
  if (trimmed.length > 100) throw new AlertError(400, 'Wzorzec jest zbyt długi (max 100 znaków).');
  if (!/^[\p{L}\p{N}\s\-_.&+*]+$/u.test(trimmed)) {
    throw new AlertError(400, 'Wzorzec zawiera niedozwolone znaki — dozwolone są litery, cyfry, spacje, -_.&+ oraz *.');
  }
  if (!trimmed.replace(/\*/g, '').trim()) {
    throw new AlertError(400, 'Wzorzec nie może składać się z samych gwiazdek.');
  }
  return trimmed;
}

export function buildAlertQuery(api, pattern) {
  const def = API_DEF[api];
  if (!def) throw new AlertError(400, `Nieznane API: ${api}`);
  const value = validatePattern(pattern);
  // Spacje wymagają cudzysłowu w RSQL
  const quoted = /\s/.test(value) ? `"${value}"` : value;
  return `${def.queryField}==${quoted}`;
}

/**
 * Pobiera wszystkie rekordy pasujące do zapytania (paginacja, sort malejąco po numerze,
 * limit MAX_PAGES stron). Dzięki sortowaniu malejącemu nowe zgłoszenia zawsze trafiają
 * na pierwszą stronę, nawet gdy wynik jest przycięty.
 */
export async function fetchAllRecords(api, query) {
  const def = API_DEF[api];
  const items = [];
  let totalElements = 0;
  let totalPages = 1;

  for (let page = 0; page < Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await euipoRequest(api, def.endpoint, {
      query: { query, size: PAGE_SIZE, page, sort: def.sort },
    });
    totalElements = result.data.totalElements ?? 0;
    totalPages = result.data.totalPages ?? 1;
    items.push(...(result.data[def.collection] || []));
  }

  return {
    items,
    totalElements,
    truncated: totalPages > MAX_PAGES,
    idField: def.idField,
  };
}

/** Tworzy alert i wykonuje seed początkowy (rekordy zastane, bez flagi NOWY). */
export async function createAlert({ api, name, pattern }) {
  const query = buildAlertQuery(api, pattern);
  const alertName = String(name || '').trim() || validatePattern(pattern);

  const info = queries.insertAlert.run({
    api,
    environment: config.euipo.environment,
    name: alertName.slice(0, 120),
    pattern: validatePattern(pattern),
    query,
  });
  const alert = queries.getAlert.get(info.lastInsertRowid);

  try {
    const result = await runAlertCheck(alert, { seed: true });
    return { alert: queries.getAlert.get(alert.id), ...result };
  } catch (err) {
    // Seed się nie udał (np. brak autoryzacji) — alert zostaje, scheduler spróbuje ponownie
    return { alert: queries.getAlert.get(alert.id), error: err.message };
  }
}

/**
 * Jedno sprawdzenie alertu: pobiera aktualny stan, zapisuje nieznane rekordy.
 * @param {object} alert wiersz z tabeli alert
 * @param {{seed?: boolean}} opts seed=true oznacza stan początkowy (is_new=0)
 */
export async function runAlertCheck(alert, { seed = false } = {}) {
  try {
    const { items, totalElements, truncated, idField } = await fetchAllRecords(
      alert.api,
      alert.query
    );

    const known = new Set(
      queries.alertRecordIds.all(alert.id).map((row) => row.record_id)
    );

    const fresh = [];
    const insertMany = db.transaction(() => {
      for (const item of items) {
        const recordId = item[idField];
        if (!recordId || known.has(recordId)) continue;
        known.add(recordId); // deduplikacja w obrębie jednego pobrania
        queries.insertAlertRecord.run({
          alert_id: alert.id,
          record_id: recordId,
          snapshot: JSON.stringify(item),
          is_new: seed ? 0 : 1,
        });
        fresh.push(recordId);
      }
    });
    insertMany();

    queries.updateAlertCheck.run({
      id: alert.id,
      status: 'ok',
      error: null,
      total: totalElements,
    });
    queries.insertAlertCheck.run({
      alert_id: alert.id,
      found_total: totalElements,
      new_count: seed ? 0 : fresh.length,
      status: 'ok',
      error: null,
    });

    return { found: totalElements, newRecords: seed ? [] : fresh, truncated };
  } catch (err) {
    const message =
      err instanceof EuipoError ? `EUIPO: ${err.message}` : err.message;
    queries.updateAlertCheck.run({
      id: alert.id,
      status: 'error',
      error: message,
      total: alert.total_records ?? null,
    });
    queries.insertAlertCheck.run({
      alert_id: alert.id,
      found_total: null,
      new_count: null,
      status: 'error',
      error: message,
    });
    throw err;
  }
}

/* ------------------------------------------------------------- scheduler */

const TICK_MS = 15 * 60 * 1000; // co 15 min sprawdzamy, czy któryś alert jest wymagalny
const FIRST_TICK_MS = 60 * 1000; // pierwszy tick minutę po starcie (łapie zaległe)

let running = false;

async function tick() {
  if (running) return; // poprzedni przebieg jeszcze trwa
  running = true;
  try {
    const due = queries.dueAlerts.all(config.euipo.environment);
    for (const alert of due) {
      try {
        const result = await runAlertCheck(alert);
        console.log(
          `[NEURON] Alert #${alert.id} „${alert.name}": ${result.found} rekordów, nowych: ${result.newRecords.length}`
        );
      } catch (err) {
        console.error(`[NEURON] Alert #${alert.id} „${alert.name}" — błąd sprawdzania:`, err.message);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setTimeout(tick, FIRST_TICK_MS);
  setInterval(tick, TICK_MS).unref();
  console.log('[NEURON] Scheduler alertów uruchomiony (tick co 15 min).');
}
