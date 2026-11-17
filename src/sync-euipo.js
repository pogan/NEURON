import { config } from './config.js';
import { euipoRequest } from './euipo.js';
import { registerJob, enqueue } from './jobs.js';
import { upsertTrademarks, euipoToTrademark, getSyncState, setSyncState } from './registry.js';

/**
 * Kopia rejestru znaków EUIPO w registry.sqlite.
 *
 * - `euipo-import`: pełny import wstecz, tygodniowymi oknami daty zgłoszenia (ok. 3,5 tys. zgłoszeń
 *   na tydzień, czyli ok. 35 stron — z zapasem poniżej granic paginacji). Najnowsze zgłoszenia
 *   trafiają do bazy najpierw. Punkt wznowienia w sync_state, więc restart niczego nie gubi.
 * - `euipo-sync`: dwa razy na dobę rekordy zmienione od poprzedniego odświeżenia (updateDate).
 *
 * Oba zadania pracują partiami i same dopisują się z powrotem do kolejki; wyczerpany limit
 * zapytań przesuwa je na następną dobę (jobs.js).
 */

const PAGE_SIZE = 100;
const PAGES_PER_RUN = 40;
const WINDOW_DAYS = 7;
const SYNC_HOURS_UTC = [3, 13];

export const IMPORT_SOURCE = 'euipo-import';
export const SYNC_SOURCE = 'euipo-sync';

const day = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDay, n) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};

async function fetchPage(query, sort, page, priority) {
  const { data } = await euipoRequest('trademark', '/trademarks', {
    query: { query, sort, page, size: PAGE_SIZE },
    priority,
  });
  const items = data?.trademarks || [];
  upsertTrademarks(items.map(euipoToTrademark));
  return { count: items.length, totalPages: data?.totalPages ?? 0 };
}

/** Jedna partia importu. Zwraca true, gdy import się zakończył. */
export async function runImportBatch({ from = config.registry.importEuipoFrom, today = day(new Date()) } = {}) {
  const state = getSyncState(IMPORT_SOURCE);
  if (state?.phase === 'done') return true;

  let { windowEnd, page } = state?.cursor || { windowEnd: addDays(today, 1), page: 0 };
  let records = state?.records || 0;

  for (let batch = 0; batch < PAGES_PER_RUN; batch += 1) {
    const windowStart = addDays(windowEnd, -WINDOW_DAYS) < from ? from : addDays(windowEnd, -WINDOW_DAYS);
    const query = `applicationDate>=${windowStart} and applicationDate<${windowEnd}`;
    const { count, totalPages } = await fetchPage(query, 'applicationNumber:asc', page, 'import');
    records += count;

    if (page + 1 < totalPages) {
      page += 1;
    } else if (windowStart <= from) {
      setSyncState(IMPORT_SOURCE, { phase: 'done', cursor: null, records, lastSyncAt: new Date().toISOString() });
      return true;
    } else {
      windowEnd = windowStart;
      page = 0;
    }
    setSyncState(IMPORT_SOURCE, { phase: 'running', cursor: { windowEnd, page }, records });
  }
  return false;
}

/** Jedna partia odświeżania. Zwraca true, gdy odświeżanie objęło wszystkie zmiany. */
export async function runSyncBatch({ today = day(new Date()) } = {}) {
  const state = getSyncState(SYNC_SOURCE);
  // Zakładka jednego dnia: updateDate ma dokładność do dnia, a zmiany z dnia odświeżenia mogły dojść później.
  const startedOn = state?.cursor?.startedOn || today;
  const since = state?.cursor?.since || addDays(today, -1);
  let page = state?.cursor?.page || 0;
  let records = state?.records || 0;

  for (let batch = 0; batch < PAGES_PER_RUN; batch += 1) {
    const { count, totalPages } = await fetchPage(`updateDate>=${since}`, 'updateDate:asc', page, 'sync');
    records += count;
    if (page + 1 >= totalPages) {
      setSyncState(SYNC_SOURCE, {
        phase: 'idle',
        cursor: { since: addDays(startedOn, -1) },
        records,
        lastSyncAt: new Date().toISOString(),
      });
      return true;
    }
    page += 1;
    setSyncState(SYNC_SOURCE, { phase: 'running', cursor: { since, page, startedOn }, records });
  }
  return false;
}

/** Najbliższa pora odświeżania (3:00 albo 13:00 UTC). */
export function nextSyncTime(now = new Date()) {
  for (let d = 0; d < 2; d += 1) {
    for (const hour of SYNC_HOURS_UTC) {
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, hour));
      if (t > now) return t;
    }
  }
  throw new Error('nieosiągalne');
}

registerJob('euipo-import', async () => {
  const done = await runImportBatch();
  if (!done) enqueue('euipo-import', {}, { runAt: new Date(Date.now() + 60_000) });
});

registerJob('euipo-sync', async () => {
  const done = await runSyncBatch();
  enqueue('euipo-sync', {}, { runAt: done ? nextSyncTime() : new Date(Date.now() + 60_000), priority: 1 });
});

/** Wywoływane przy starcie: zakłada zadania, jeśli jeszcze nie czekają w kolejce. */
export function ensureEuipoJobs() {
  if (!config.registry.sync) return;
  if (getSyncState(IMPORT_SOURCE)?.phase !== 'done') enqueue('euipo-import', {}, { unique: true });
  enqueue('euipo-sync', {}, { unique: true, priority: 1 });
}
