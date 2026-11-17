import { stubFetch } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { runBulletinBatch, runBackfillBatch, nextBulletinTime, BULLETIN_SOURCE } = await import('../src/sync-krs.js');
const { getSyncState, findCompanies, companyCount } = await import('../src/registry.js');
const { checkName } = await import('../src/namecheck.js');

const odpis = (krs, name, rejestr = 'RejP') => ({
  body: {
    odpis: {
      rodzaj: 'Aktualny',
      naglowekA: { rejestr, numerKRS: krs, dataRejestracjiWKRS: '11.06.2001', dataOstatniegoWpisu: '08.10.2026' },
      dane: {
        dzial1: {
          danePodmiotu: { formaPrawna: 'SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', nazwa: name, identyfikatory: { nip: '5250000251', regon: '00012680100000' } },
          siedzibaIAdres: { siedziba: { miejscowosc: 'GDAŃSK' } },
        },
      },
    },
  },
});
const notFound = { status: 404, body: { status: 404 } };

test('biuletyn: dzień po dniu do wczoraj, P potem S, wykreśleni oznaczani', async () => {
  const calls = stubFetch([
    { body: ['19193', '19193', '1250000'] },     // 2026-11-15 (powtórzenia w biuletynie)
    odpis('0000019193', 'LEŚNA ŚWIECA SPÓŁKA Z O.O.'),
    notFound, odpis('0001250000', 'STOWARZYSZENIE LEŚNA ŚWIECA', 'RejS'),
    { body: ['19193'] },                          // 2026-11-16: podmiot wykreślony
    notFound, notFound,
  ]);
  assert.equal(await runBulletinBatch({ today: '2026-11-17', from: '2026-11-15' }), true);
  assert.ok(calls[0].endsWith('/Krs/Biuletyn/2026-11-15'));
  assert.ok(calls[1].endsWith('/krs/OdpisAktualny/0000019193?rejestr=P&format=json'));
  assert.ok(calls[3].includes('/OdpisAktualny/0001250000?rejestr=S'));
  assert.equal(getSyncState(BULLETIN_SOURCE).cursor.date, '2026-11-17');

  const found = findCompanies('Leśna Świeca');
  assert.deepEqual(found.map((c) => c.krs), ['0001250000']); // wykreślona spółka nie wraca
  assert.equal(found[0].register, 'S');
  assert.equal(found[0].city, 'GDAŃSK');
  assert.equal(found[0].registered_on, '2001-06-11');
  assert.equal(companyCount(), 1);

  stubFetch([]); // dzisiejszego biuletynu nie pobieramy
  assert.equal(await runBulletinBatch({ today: '2026-11-17' }), true);
});

test('pełne przejście po numerach w dół, partiami', async () => {
  stubFetch([odpis('0000000003', 'NEURON S.A.'), notFound, notFound, notFound, notFound]);
  assert.equal(await runBackfillBatch({ start: 3 }), true);
  assert.deepEqual(findCompanies('neuron').map((c) => c.krs), ['0000000003']);
});

test('sprawdzenie nazwy zwraca firmy z KRS', async () => {
  stubFetch([]);
  const result = await checkName('Neuron', { tlds: [] });
  assert.equal(result.companies.matches[0].krs, '0000000003');
  assert.equal(result.companies.indexed, 2);
});

test('biuletyn o 1:00 UTC', () => {
  assert.equal(nextBulletinTime(new Date('2026-11-17T00:30:00Z')).toISOString(), '2026-11-17T01:00:00.000Z');
  assert.equal(nextBulletinTime(new Date('2026-11-17T01:00:00Z')).toISOString(), '2026-11-18T01:00:00.000Z');
});
