// Błąd prototypu: po nieudanym seedzie następne sprawdzenie oznaczało wszystkie istniejące rekordy jako NOWE.
import { stubFetch } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.QUOTA_EUIPO_TRADEMARK = '1000';
const { db, queries } = await import('../src/db.js');
const { createAlert, runAlertCheck } = await import('../src/monitor.js');

const page = (...ids) => ({
  body: { trademarks: ids.map((id) => ({ applicationNumber: id })), totalElements: ids.length, totalPages: 1 },
});

test('nieudany seed nie zamienia stanu zastanego w NOWE rekordy', async () => {
  stubFetch([{ status: 500, body: { message: 'awaria' } }]);
  const { alert, error } = await createAlert({ api: 'trademark', name: 'test', pattern: '*neuron*' });
  assert.match(error, /awaria/);
  assert.equal(queries.getAlert.get(alert.id).seeded_at, null);

  stubFetch([page('001', '002')]);
  const seeded = await runAlertCheck(queries.getAlert.get(alert.id));
  assert.deepEqual(seeded.newRecords, []);
  assert.ok(queries.getAlert.get(alert.id).seeded_at);
  assert.equal(db.prepare('SELECT SUM(is_new) AS n FROM alert_record WHERE alert_id = ?').get(alert.id).n, 0);

  stubFetch([page('003', '001', '002')]);
  const next = await runAlertCheck(queries.getAlert.get(alert.id), { priority: 'sync' });
  assert.deepEqual(next.newRecords, ['003']);
});
