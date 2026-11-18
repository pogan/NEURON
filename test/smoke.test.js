import './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../src/app.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('GET /healthz zwraca 200 z wersją i sprawdzeniem obu baz', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.version);
  assert.equal(body.checks.db, 'ok');
  assert.equal(body.checks.registry, 'ok');
});

test('strona główna i 404 renderują się w Express 5', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/nie-ma-takiej-strony`)).status, 404);
});

test('strona „Sprawdź nazwę” i walidacja zapytania', async () => {
  assert.equal((await fetch(`${base}/sprawdz`)).status, 200);
  assert.equal((await fetch(`${base}/api/check?name=`)).status, 400);
});

test('strona „Badanie nazwy” z branżami i walidacja /api/badanie', async () => {
  const res = await fetch(`${base}/badanie`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const data = JSON.parse(html.match(/<script type="application\/json" id="industriesData">([\s\S]*?)<\/script>/)[1]);
  assert.ok(data.industries.length >= 30);
  assert.equal(data.classNames[25], 'odzież i obuwie');
  assert.equal((await fetch(`${base}/api/badanie?name=`)).status, 400);
  const ok = await (await fetch(`${base}/api/badanie?name=Neuron&classes=9,42`)).json();
  assert.equal(ok.verdict.level, 'low'); // pusta kopia rejestrów w teście
  assert.deepEqual(ok.classes, [9, 42]);
});
