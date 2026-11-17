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
