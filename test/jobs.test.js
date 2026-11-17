import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../src/db.js');
const { registerJob, enqueue, runNextJob, retryDelaySeconds } = await import('../src/jobs.js');
const { QuotaError } = await import('../src/quota.js');

const job = (id) => db.prepare('SELECT * FROM job WHERE id = ?').get(id);

test('zadanie wykonuje się z payloadem i kończy jako done', async () => {
  const seen = [];
  registerJob('echo', async (payload) => seen.push(payload));
  const id = enqueue('echo', { a: 1 });
  assert.equal(await runNextJob(), true);
  assert.deepEqual(seen, [{ a: 1 }]);
  assert.equal(job(id).status, 'done');
  assert.equal(await runNextJob(), false);
});

test('błąd odkłada zadanie z opóźnieniem, a po max_attempts zostaje failed', async () => {
  registerJob('broken', async () => { throw new Error('nie działa'); });
  const id = enqueue('broken', {}, { maxAttempts: 2 });
  await runNextJob();
  assert.equal(job(id).status, 'pending');
  assert.equal(job(id).attempts, 1);
  assert.ok(job(id).run_at > db.prepare(`SELECT datetime('now') AS t`).get().t);
  db.prepare(`UPDATE job SET run_at = datetime('now') WHERE id = ?`).run(id);
  await runNextJob();
  assert.equal(job(id).status, 'failed');
  assert.equal(job(id).last_error, 'nie działa');
});

test('wyczerpany limit API przesuwa zadanie na następną dobę bez zużycia próby', async () => {
  registerJob('quota', async () => { throw new QuotaError('euipo-trademark', 'import'); });
  const id = enqueue('quota', {}, { maxAttempts: 1 });
  await runNextJob();
  assert.equal(job(id).status, 'pending');
  assert.equal(job(id).attempts, 0);
  assert.match(job(id).run_at, / 00:05:00$/);
});

test('unique nie dubluje czekającego zadania', () => {
  registerJob('sync', async () => {});
  assert.ok(enqueue('sync', {}, { unique: true, runAt: new Date(Date.now() + 3600_000) }));
  assert.equal(enqueue('sync', {}, { unique: true }), null);
});

test('zadanie bez obsługi kończy się failed', async () => {
  const id = enqueue('nieznane');
  db.prepare(`UPDATE job SET priority = 100 WHERE id = ?`).run(id);
  await runNextJob();
  assert.equal(job(id).status, 'failed');
});

test('opóźnienia rosną wykładniczo do 6 h', () => {
  assert.deepEqual([1, 2, 3, 20].map(retryDelaySeconds), [60, 120, 240, 21600]);
});
