import { registryDb } from './registry-db.js';
import { indexSimilarity, getSyncState, setSyncState } from './registry.js';
import { registerJob, enqueue } from './jobs.js';

/**
 * Jednorazowe uzupełnienie indeksu podobieństwa (trademark_sim) dla znaków zapisanych przed
 * migracją 4. Nowe i odświeżane znaki trafiają do indeksu same (upsertTrademark).
 * Partie po 5 tys. wierszy (ok. 0,3 s), z oddaniem pętli zdarzeń między partiami.
 */

const BATCH = 5000;
export const SIM_SOURCE = 'sim-index';

const rows = registryDb.prepare(`SELECT id, name FROM trademark WHERE id > ? ORDER BY id LIMIT ?`);
const indexBatch = registryDb.transaction((list) => {
  for (const r of list) indexSimilarity(r.id, r.name);
});

/** Jedna partia. Zwraca true, gdy indeks obejmuje wszystkie znaki. */
export function runSimBatch({ batch = BATCH } = {}) {
  const state = getSyncState(SIM_SOURCE);
  if (state?.phase === 'done') return true;
  const lastId = state?.cursor?.lastId ?? 0;
  const list = rows.all(lastId, batch);
  indexBatch(list);
  const records = (state?.records || 0) + list.length;
  if (list.length < batch) {
    setSyncState(SIM_SOURCE, { phase: 'done', cursor: null, records, lastSyncAt: new Date().toISOString() });
    return true;
  }
  setSyncState(SIM_SOURCE, { phase: 'running', cursor: { lastId: list.at(-1).id }, records });
  return false;
}

registerJob('sim-index', async () => {
  await new Promise((resolve) => setImmediate(resolve));
  if (!runSimBatch()) enqueue('sim-index', {}, { priority: 2 });
});

/** Wywoływane przy starcie: zakłada zadanie, dopóki indeks nie jest kompletny (niezależnie od REGISTRY_SYNC). */
export function ensureSimJobs() {
  if (getSyncState(SIM_SOURCE)?.phase !== 'done') enqueue('sim-index', {}, { unique: true, priority: 2 });
}
