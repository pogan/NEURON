import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../src/migrate.js';

const migrations = [(d) => d.exec('CREATE TABLE a (x)'), (d) => d.exec('ALTER TABLE a ADD COLUMN y')];

test('migracje wykonują się raz i ustawiają user_version', () => {
  const db = new Database(':memory:');
  assert.equal(migrate(db, migrations), 2);
  assert.equal(migrate(db, migrations), 2); // ponowne uruchomienie niczego nie psuje
  db.prepare('INSERT INTO a (x, y) VALUES (1, 2)').run();
});

test('nieudana migracja wycofuje się w całości', () => {
  const db = new Database(':memory:');
  const broken = [migrations[0], (d) => { d.exec('CREATE TABLE b (z)'); throw new Error('boom'); }];
  assert.throws(() => migrate(db, broken), /boom/);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'`).get().n, 0);
});

test('starszy kod na nowszej bazie przerywa start', () => {
  const db = new Database(':memory:');
  db.pragma('user_version = 5');
  assert.throws(() => migrate(db, migrations), /starszy kod/);
});
