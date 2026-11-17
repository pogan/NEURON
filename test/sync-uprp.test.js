import { stubFetch } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { runImportBatch, runSyncBatch, nextSyncTime, IMPORT_SOURCE, SYNC_SOURCE } = await import('../src/sync-uprp.js');
const { getSyncState, findByFragment } = await import('../src/registry.js');
const { registryDb } = await import('../src/registry-db.js');

/** Rekord znaku w formacie ST.66, jak w odpowiedziach e-Wyszukiwarki. */
const tm = (number, name, { classes = [35], applicants = ['STRZELCZYK PRZEMYSŁAW'], status = 'Udzielenie prawa' } = {}) => `
  <Transaction><TradeMarkTransactionBody><TransactionContentDetails><TransactionData><TradeMarkDetails><TradeMark>
    <ApplicationNumber>${number}</ApplicationNumber>
    <ApplicationDate>2025-01-30</ApplicationDate>
    <MarkCurrentStatusCode>${status}</MarkCurrentStatusCode>
    <KindMark>Individual</KindMark>
    <MarkFeature>Word</MarkFeature>
    ${name ? `<WordMarkSpecification><MarkVerbalElementText languageCode="pl">${name}</MarkVerbalElementText></WordMarkSpecification>` : ''}
    <GoodsServicesDetails><GoodsServices><ClassDescriptionDetails>
      ${classes.map((c) => `<ClassDescription><ClassNumber>${c}</ClassNumber><GoodsServicesDescription languageCode="pl">opis</GoodsServicesDescription></ClassDescription>`).join('')}
    </ClassDescriptionDetails></GoodsServices></GoodsServicesDetails>
    <ApplicantDetails>${applicants.map((a) => `<Applicant><ApplicantAddressBook><FormattedNameAddress>
      <Name><FreeFormatName><FreeFormatNameDetails><FreeFormatNameLine>${a}</FreeFormatNameLine></FreeFormatNameDetails></FreeFormatName></Name>
      <Address><AddressCountryCode>PL</AddressCountryCode></Address>
    </FormattedNameAddress></ApplicantAddressBook></Applicant>`).join('')}</ApplicantDetails>
  </TradeMark></TradeMarkDetails></TransactionData></TransactionContentDetails></TradeMarkTransactionBody></Transaction>`;
const patent = `<root><pl-patent-document doc-number="123"/></root>`;
const page = (items, { total = items.length, pages = 1 } = {}) => ({
  body: `<?xml version="1.0" encoding="UTF-8"?><root><total>${total}</total><pages>${pages}</pages><_embedded>${items.join('')}</_embedded></root>`,
});
const criteria = (id) => ({ body: id });
const searchBodies = [];

test('import: okna wstecz, podział zbyt pełnego okna, wydłużanie pustych, koniec na dacie startowej', async () => {
  const calls = stubFetch([
    criteria('c1'), page([tm('Z.1', 'KROPLOSFERA'), tm('Z.2', 'NEURON')], { total: 600, pages: 2 }),
    page([tm('Z.3', 'Neurolab', { classes: [9, 42], applicants: ['A', 'B'] })], { total: 600, pages: 2 }),
    criteria('c2'), page([], { total: 10000, pages: 20 }), // okno ucięte → dzielimy na pół
    criteria('c3'), page([tm('Z.4', null)], { total: 1 }),
    criteria('c4'), page([], { total: 0 }),
    criteria('c5'), page([], { total: 0 }),
  ]);
  globalThis.fetch = ((inner) => async (url, opts) => {
    if (opts?.body && String(url).includes('deterministic-search')) searchBodies.push(JSON.parse(opts.body));
    return inner(url, opts);
  })(globalThis.fetch);

  const done = await runImportBatch({ from: '2025-11-01', today: '2026-01-29' });
  assert.equal(done, true);
  const ranges = searchBodies.map((b) => b.attributes.conditions[0].value.join('..'));
  assert.deepEqual(ranges, [
    '2025-12-31..2026-01-29', // 30 dni
    '2025-12-01..2025-12-30', // 30 dni: wynik ucięty
    '2025-12-16..2025-12-30', // 15 dni
    '2025-11-16..2025-12-15', // mały wynik → okno dwa razy dłuższe (30 dni)
    '2025-11-01..2025-11-15', // 60 dni, przycięte do daty startowej
  ]);
  assert.ok(searchBodies.every((b) => b.pwpTypes[0] === 1));
  assert.ok(calls.some((u) => u.includes('/search-results/c1?page=2&limit=500')));
  assert.equal(getSyncState(IMPORT_SOURCE).phase, 'done');
  assert.equal(await runImportBatch(), true);

  const row = registryDb.prepare(`SELECT * FROM trademark WHERE source = 'uprp' AND number = 'Z.3'`).get();
  assert.equal(row.nice_classes, ',9,42,');
  assert.deepEqual(JSON.parse(row.applicants), [{ name: 'A', country: 'PL' }, { name: 'B', country: 'PL' }]);
  assert.equal(row.status, 'Udzielenie prawa');
  assert.equal(JSON.parse(row.data).GoodsServicesDetails, undefined); // bez opisów towarów
  assert.deepEqual(findByFragment('neuro').map((t) => t.number).sort(), ['Z.2', 'Z.3']);
});

test('odświeżanie: dziennik zmian od wczoraj, tylko znaki (patenty pomijane)', async () => {
  const calls = stubFetch([
    page([patent, tm('Z.2', 'NEURON', { status: 'Wygaśnięcie prawa' })], { total: 2, pages: 2 }),
    page([patent], { total: 2, pages: 2 }),
  ]);
  assert.equal(await runSyncBatch({ today: '2026-11-17' }), true);
  assert.ok(calls.some((u) => u.includes('/pwps-changed-since/2026-11-16?page=1&limit=1000')));
  assert.equal(registryDb.prepare(`SELECT status FROM trademark WHERE number = 'Z.2'`).get().status, 'Wygaśnięcie prawa');
  assert.deepEqual(getSyncState(SYNC_SOURCE).cursor, { since: '2026-11-16' });
});

test('odświeżanie o 5:00 UTC', () => {
  assert.equal(nextSyncTime(new Date('2026-11-17T04:00:00Z')).toISOString(), '2026-11-17T05:00:00.000Z');
  assert.equal(nextSyncTime(new Date('2026-11-17T05:00:00Z')).toISOString(), '2026-11-18T05:00:00.000Z');
});
