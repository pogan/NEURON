import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { upsertTrademarks, euipoToTrademark } = await import('../src/registry.js');
const { examineName, classFactor, statusInfo, verdictFor } = await import('../src/badanie.js');
const { runSimBatch } = await import('../src/sync-sim.js');

const tm = (number, name, classes, status = 'REGISTERED', extra = {}) => euipoToTrademark({
  applicationNumber: number, wordMarkSpecification: { verbalElement: name }, niceClasses: classes,
  status, markFeature: 'WORD', applicants: [{ name: 'Firma', office: 'PL' }], ...extra,
});

upsertTrademarks([
  tm('1', 'LEŚNA ŚWIECA', [4]),
  tm('2', 'LESNA SWIECZKA', [3]),
  tm('3', 'Leśna Świeca', [25], 'EXPIRED'),
  tm('4', 'MLECZNA DROGA', [30]),
  tm('5', 'MARKOSKOP', [42]),
  tm('6', 'SWIECA LESNA', [4], 'APPLICATION_PUBLISHED', { markFeature: 'FIGURATIVE' }),
]);

test('wagi branży i statusu', () => {
  assert.equal(classFactor([4], [4, 35]).factor, 1);
  assert.equal(classFactor([25], [18]).factor, 0.6);
  assert.equal(classFactor([35], [4]).factor, 0.4);
  assert.equal(classFactor([4], [42]).factor, 0.15);
  assert.equal(classFactor([], [42]).factor, 1);
  assert.equal(statusInfo('Udzielenie prawa', '2035-01-30', '2026-11-18').state, 'registered');
  assert.equal(statusInfo('REGISTERED', '2020-01-01', '2026-11-18').state, 'inactive');
  assert.equal(statusInfo('Okres sprzeciwowy', null).state, 'pending');
  assert.equal(verdictFor(0.9).level, 'high');
  assert.equal(verdictFor(0.75).level, 'warning');
  assert.equal(verdictFor(0.2).level, 'low');
});

test('badanie: ten sam znak w tej samej klasie = wysokie ryzyko, z powodami', () => {
  const r = examineName('Leśna Świeca', { classes: [4], today: '2026-11-18' });
  assert.equal(r.verdict.level, 'high');
  assert.equal(r.matches[0].number, '1');
  assert.deepEqual(r.matches[0].reasons.map((x) => x.code), ['identical', 'sameClass']);
  assert.equal(r.matches[0].group, 'main');
  const expired = r.matches.find((m) => m.number === '3');
  assert.equal(expired.state, 'inactive');
  assert.equal(expired.group, 'inactive');
  assert.ok(expired.risk < 0.1);
  const reordered = r.matches.find((m) => m.number === '6');
  assert.ok(reordered.reasons.some((x) => x.code === 'words'));
  assert.ok(reordered.reasons.some((x) => x.code === 'pending'));
  assert.ok(!r.matches.some((m) => m.number === '5'));
});

test('badanie: inna branża obniża ryzyko', () => {
  const r = examineName('Leśna Świeca', { classes: [42], today: '2026-11-18' });
  assert.equal(r.verdict.level, 'low');
  assert.equal(r.matches[0].reasons.at(-1).code, 'otherClass');
  assert.equal(r.matches[0].group, 'other');
  assert.deepEqual(r.groups, { main: 0, other: 3, inactive: 1 });
});

test('indeks podobieństwa dla znaków sprzed migracji (sim-index)', () => {
  assert.equal(runSimBatch({ batch: 4 }), false);
  assert.equal(runSimBatch({ batch: 4 }), true);
  assert.equal(examineName('Droga Mleczna').matches[0].number, '4');
});
