import { config } from './config.js';
import { uprpRequest } from './uprp.js';
import { registerJob, enqueue } from './jobs.js';
import { upsertTrademarks, uprpTrademarksFrom, getSyncState, setSyncState } from './registry.js';

/**
 * Kopia rejestru znaków UPRP w registry.sqlite (pomiary z 2026-11-17).
 *
 * - `uprp-import`: pełny import wstecz oknami daty zgłoszenia. Wyszukiwanie (v2/deterministic-search)
 *   zwraca identyfikator kryteriów, a wyniki (search-results) idą stronami do 1000 rekordów.
 *   UPRP ucina wynik na 10 000 rekordów, więc okno dopasowuje się samo: zbyt pełne dzielimy na pół,
 *   a w latach z małą liczbą zgłoszeń (przed 1990 r. kilkaset rocznie) wydłużamy do roku.
 *   Dziś to ok. 1,2–1,4 tys. zgłoszeń miesięcznie.
 * - `uprp-sync`: raz na dobę dziennik zmian (pwps-changed-since) — ok. 5 tys. praw wszystkich typów,
 *   znaki to ok. jedna piąta. UPRP generuje zmiany ok. 3:00 UTC.
 *
 * Wersja v1 wyszukiwania przyjmuje daty tylko z godziną i z attributeName/formType (inaczej 400);
 * v2 z operatorem `between` przyjmuje zwykłe daty.
 */

const PAGE_SIZE = 500;
const PAGES_PER_RUN = 20;
const RESULT_CAP = 10_000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const CHANGES_PAGE_SIZE = 1000;
const SYNC_HOUR_UTC = 5;
const TRADEMARKS = 1; // id typu PWP „Znaki Towarowe”

export const IMPORT_SOURCE = 'uprp-import';
export const SYNC_SOURCE = 'uprp-sync';

const day = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDay, n) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};

/** Rejestruje wyszukiwanie znaków zgłoszonych w dniach first..last (włącznie). */
async function searchByApplicationDate(first, last) {
  const { data } = await uprpRequest('/v2/deterministic-search', {
    method: 'POST',
    priority: 'import',
    body: {
      attributes: {
        type: 'group',
        operator: 'and',
        conditions: [{
          type: 'condition',
          operator: 'between',
          attribute: { id: 156, name: 'data_zgloszenia', formType: 'date' },
          value: [first, last],
        }],
      },
      pwpTypes: [TRADEMARKS],
    },
  });
  if (typeof data !== 'string' || !data) throw new Error('UPRP nie zwrócił identyfikatora kryteriów.');
  return data;
}

async function fetchResults(endpoint, page, limit, priority) {
  const { data } = await uprpRequest(endpoint, { query: { page, limit }, priority });
  return {
    trademarks: uprpTrademarksFrom(data),
    total: Number(data?.root?.total ?? 0),
    pages: Number(data?.root?.pages ?? 0),
  };
}

/** Jedna partia importu. Zwraca true, gdy import się zakończył. */
export async function runImportBatch({ from = config.registry.importUprpFrom, today = day(new Date()) } = {}) {
  const state = getSyncState(IMPORT_SOURCE);
  if (state?.phase === 'done') return true;

  let { windowEnd, days, page } = state?.cursor || { windowEnd: addDays(today, 1), days: DEFAULT_WINDOW_DAYS, page: 1 };
  let records = state?.records || 0;
  let criteriaId = null;

  for (let batch = 0; batch < PAGES_PER_RUN; batch += 1) {
    const windowStart = addDays(windowEnd, -days) < from ? from : addDays(windowEnd, -days);
    // Identyfikator kryteriów zakładamy na nowo w każdym przebiegu — nie wiadomo, jak długo UPRP go trzyma.
    criteriaId ??= await searchByApplicationDate(windowStart, addDays(windowEnd, -1));
    const { trademarks, total, pages } = await fetchResults(`/search-results/${criteriaId}`, page, PAGE_SIZE, 'import');

    if (total >= RESULT_CAP && days > 1) {
      days = Math.ceil(days / 2);
      page = 1;
      criteriaId = null;
    } else {
      upsertTrademarks(trademarks);
      records += trademarks.length;
      if (page < pages) {
        page += 1;
      } else if (windowStart <= from) {
        setSyncState(IMPORT_SOURCE, { phase: 'done', cursor: null, records, lastSyncAt: new Date().toISOString() });
        return true;
      } else {
        windowEnd = windowStart;
        page = 1;
        criteriaId = null;
        if (total < PAGE_SIZE) days = Math.min(days * 2, MAX_WINDOW_DAYS);
        else if (total > RESULT_CAP / 2) days = Math.max(1, Math.floor(days / 2));
      }
    }
    setSyncState(IMPORT_SOURCE, { phase: 'running', cursor: { windowEnd, days, page }, records });
  }
  return false;
}

/** Jedna partia odświeżania z dziennika zmian. Zwraca true, gdy objęła wszystkie zmiany. */
export async function runSyncBatch({ today = day(new Date()) } = {}) {
  const state = getSyncState(SYNC_SOURCE);
  // Zakładka jednego dnia, jak w EUIPO: dziennik ma dokładność do dnia.
  const startedOn = state?.cursor?.startedOn || today;
  const since = state?.cursor?.since || addDays(today, -1);
  let page = state?.cursor?.page || 1;
  let records = state?.records || 0;

  for (let batch = 0; batch < PAGES_PER_RUN; batch += 1) {
    const { trademarks, pages } = await fetchResults(`/pwps-changed-since/${since}`, page, CHANGES_PAGE_SIZE, 'sync');
    upsertTrademarks(trademarks);
    records += trademarks.length;
    if (page >= pages) {
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

/** Najbliższa pora odświeżania (5:00 UTC, po nocnym dzienniku zmian UPRP). */
export function nextSyncTime(now = new Date()) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SYNC_HOUR_UTC));
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

registerJob('uprp-import', async () => {
  const done = await runImportBatch();
  if (!done) enqueue('uprp-import', {}, { runAt: new Date(Date.now() + 60_000) });
});

registerJob('uprp-sync', async () => {
  const done = await runSyncBatch();
  enqueue('uprp-sync', {}, { runAt: done ? nextSyncTime() : new Date(Date.now() + 60_000), priority: 1 });
});

/** Wywoływane przy starcie: zakłada zadania, jeśli jeszcze nie czekają w kolejce. */
export function ensureUprpJobs() {
  if (!config.registry.sync || !config.uprp.apiKey) return;
  if (getSyncState(IMPORT_SOURCE)?.phase !== 'done') enqueue('uprp-import', {}, { unique: true });
  enqueue('uprp-sync', {}, { unique: true, priority: 1 });
}
