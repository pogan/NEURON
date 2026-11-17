import { config } from './config.js';
import { bulletin, currentExtract } from './krs.js';
import { registerJob, enqueue } from './jobs.js';
import { upsertCompany, markCompanyRemoved, krsToCompany, getSyncState, setSyncState } from './registry.js';

/**
 * Indeks nazw podmiotów z KRS w registry.sqlite. API KRS nie ma wyszukiwania po nazwie,
 * więc budujemy własny indeks z odpisów pobieranych po numerze.
 *
 * - `krs-bulletin`: dzień po dniu biuletyn zmian (ok. 3,3 tys. podmiotów na dobę, pomiar 2026-11-17)
 *   i odpis każdego z nich. Biuletyn dnia bieżącego jest niepełny, więc kończymy na wczoraj.
 * - `krs-backfill`: pełne przejście po numerach od najwyższego w dół (ok. 1,28 mln numerów,
 *   do 2 zapytań na numer). Tylko przy KRS_BACKFILL=true — decyzja Karola.
 *
 * Zapytania idą po kolei (ok. 0,2 s każde, pomiar 2026-11-17), małymi partiami, żeby nie blokować innych zadań w kolejce.
 */

const ENTITIES_PER_RUN = 50;
const BULLETIN_HOUR_UTC = 1;

export const BULLETIN_SOURCE = 'krs-bulletin';
export const BACKFILL_SOURCE = 'krs-backfill';

const day = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDay, n) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};

/** Pobiera odpis i zapisuje podmiot; brak odpisu oznacza wykreślenie (o ile był w indeksie). */
async function refreshEntity(krs, priority) {
  const odpis = await currentExtract(krs, priority);
  const company = odpis ? krsToCompany(odpis) : null;
  if (company) upsertCompany(company);
  else if (!odpis) markCompanyRemoved(krs);
  else console.warn(`[NEURON] KRS ${krs}: odpis bez nazwy podmiotu — pominięty.`);
  return Boolean(company);
}

/** Jedna partia biuletynu. Zwraca true, gdy przetworzone są wszystkie dni do wczoraj. */
export async function runBulletinBatch({ today = day(new Date()), from = config.registry.krsFrom } = {}) {
  const yesterday = addDays(today, -1);
  const state = getSyncState(BULLETIN_SOURCE);
  let { date, numbers, index } = state?.cursor || { date: from || yesterday, numbers: null, index: 0 };
  let records = state?.records || 0;
  let processed = 0;

  while (date <= yesterday) {
    numbers ??= await bulletin(date);
    while (index < numbers.length && processed < ENTITIES_PER_RUN) {
      if (await refreshEntity(numbers[index], 'sync')) records += 1;
      index += 1;
      processed += 1;
    }
    if (index < numbers.length) {
      setSyncState(BULLETIN_SOURCE, { phase: 'running', cursor: { date, numbers, index }, records });
      return false;
    }
    date = addDays(date, 1);
    numbers = null;
    index = 0;
    setSyncState(BULLETIN_SOURCE, {
      phase: 'idle', cursor: { date, numbers, index }, records, lastSyncAt: new Date().toISOString(),
    });
  }
  return true;
}

/** Jedna partia pełnego przejścia po numerach (od `start` w dół). Zwraca true na końcu. */
export async function runBackfillBatch({ start = 1_300_000 } = {}) {
  const state = getSyncState(BACKFILL_SOURCE);
  if (state?.phase === 'done') return true;
  let next = state?.cursor?.next ?? start;
  let records = state?.records || 0;

  for (let i = 0; i < ENTITIES_PER_RUN && next >= 1; i += 1, next -= 1) {
    if (await refreshEntity(next, 'import')) records += 1;
  }
  const done = next < 1;
  setSyncState(BACKFILL_SOURCE, {
    phase: done ? 'done' : 'running',
    cursor: done ? null : { next },
    records,
    lastSyncAt: done ? new Date().toISOString() : null,
  });
  return done;
}

/** Biuletyn sprawdzamy o 1:00 UTC (dzień poprzedni jest wtedy zamknięty). */
export function nextBulletinTime(now = new Date()) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), BULLETIN_HOUR_UTC));
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

registerJob('krs-bulletin', async () => {
  const done = await runBulletinBatch();
  enqueue('krs-bulletin', {}, { runAt: done ? nextBulletinTime() : new Date(Date.now() + 30_000), priority: 1 });
});

registerJob('krs-backfill', async () => {
  const done = await runBackfillBatch();
  if (!done) enqueue('krs-backfill', {}, { runAt: new Date(Date.now() + 30_000) });
});

/** Wywoływane przy starcie: zakłada zadania, jeśli jeszcze nie czekają w kolejce. */
export function ensureKrsJobs() {
  if (!config.registry.sync) return;
  enqueue('krs-bulletin', {}, { unique: true, priority: 1 });
  if (config.registry.krsBackfill && getSyncState(BACKFILL_SOURCE)?.phase !== 'done') {
    enqueue('krs-backfill', {}, { unique: true });
  }
}
