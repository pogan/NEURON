import { stubFetch } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QUOTA_EUIPO_TRADEMARK = '1000';
const { runImportBatch, runSyncBatch, nextSyncTime, IMPORT_SOURCE, SYNC_SOURCE } = await import('../src/sync-euipo.js');
const { getSyncState, findByFragment, trademarkCounts } = await import('../src/registry.js');
const { registryDb } = await import('../src/registry-db.js');

const tm = (number, name, extra = {}) => ({
  applicationNumber: number,
  wordMarkSpecification: name ? { verbalElement: name } : undefined,
  status: 'REGISTERED',
  niceClasses: [25, 3],
  applicants: [{ office: 'PL', name: 'Firma' }],
  applicationDate: '2026-11-10',
  ...extra,
});
const page = (items, totalPages) => ({ body: { trademarks: items, totalPages, totalElements: items.length } });

test('import idzie tygodniowymi oknami wstecz do daty startowej i zapisuje punkt wznowienia', async () => {
  const calls = stubFetch([
    page([tm('001', 'Leśna Świeca'), tm('002', 'NEURON')], 2),
    page([tm('003', 'Neurolab')], 2),
    page([], 0), // okno 2026-11-04..2026-11-11: brak zgłoszeń
    page([tm('004', null, { markFeature: 'FIGURATIVE' })], 1),
  ]);
  const done = await runImportBatch({ from: '2026-10-28', today: '2026-11-17' });
  assert.equal(done, true);
  const queries = calls.filter((u) => u.includes('/trademarks?')).map((u) => decodeURIComponent(new URL(u).searchParams.get('query')));
  assert.deepEqual(queries, [
    'applicationDate>=2026-11-11 and applicationDate<2026-11-18',
    'applicationDate>=2026-11-11 and applicationDate<2026-11-18',
    'applicationDate>=2026-11-04 and applicationDate<2026-11-11',
    'applicationDate>=2026-10-28 and applicationDate<2026-11-04',
  ]);
  assert.equal(getSyncState(IMPORT_SOURCE).phase, 'done');
  assert.equal(trademarkCounts().euipo, 4);
  assert.equal(await runImportBatch(), true); // po zakończeniu nic nie pobiera
});

test('wyszukiwanie fragmentu nazwy po indeksie trigramowym', () => {
  assert.deepEqual(findByFragment('neuro').map((t) => t.number).sort(), ['002', '003']);
  assert.deepEqual(findByFragment('lesna swieca').map((t) => t.number), ['001']);
  assert.deepEqual(findByFragment('Leśna').map((t) => t.number), ['001']);
  const row = registryDb.prepare(`SELECT nice_classes, applicants FROM trademark WHERE number = '001'`).get();
  assert.equal(row.nice_classes, ',3,25,');
  assert.deepEqual(JSON.parse(row.applicants), [{ name: 'Firma', country: 'PL' }]);
});

test('odświeżanie pobiera zmiany od wczoraj i aktualizuje istniejące rekordy', async () => {
  const calls = stubFetch([page([tm('002', 'NEURON', { status: 'EXPIRED' })], 1)]);
  assert.equal(await runSyncBatch({ today: '2026-11-17' }), true);
  assert.match(decodeURIComponent(calls.at(-1)), /updateDate>=2026-11-16/);
  assert.equal(registryDb.prepare(`SELECT status FROM trademark WHERE number = '002'`).get().status, 'EXPIRED');
  assert.deepEqual(getSyncState(SYNC_SOURCE).cursor, { since: '2026-11-16' });
});

test('odświeżanie o 3:00 i 13:00 UTC', () => {
  assert.equal(nextSyncTime(new Date('2026-11-17T02:00:00Z')).toISOString(), '2026-11-17T03:00:00.000Z');
  assert.equal(nextSyncTime(new Date('2026-11-17T03:00:00Z')).toISOString(), '2026-11-17T13:00:00.000Z');
  assert.equal(nextSyncTime(new Date('2026-11-17T20:00:00Z')).toISOString(), '2026-11-18T03:00:00.000Z');
});
