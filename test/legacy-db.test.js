// Baza z prototypu (bez user_version) musi przejść migracje bez utraty danych,
// a alerty z udanym sprawdzeniem dostają seeded_at — nie będą seedowane ponownie.
import { tmpDir } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';

const legacy = new Database(path.join(tmpDir, 'app.sqlite'));
legacy.exec(`
  CREATE TABLE request_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    api TEXT NOT NULL, endpoint TEXT NOT NULL, params TEXT, status INTEGER, duration_ms INTEGER, total_elements INTEGER, error TEXT,
    environment TEXT);
  CREATE TABLE alert (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), api TEXT NOT NULL,
    environment TEXT NOT NULL, name TEXT NOT NULL, pattern TEXT NOT NULL, query TEXT NOT NULL,
    interval_hours INTEGER NOT NULL DEFAULT 24, active INTEGER NOT NULL DEFAULT 1, last_check_at TEXT, last_status TEXT,
    last_error TEXT, total_records INTEGER);
  CREATE TABLE alert_check (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')), found_total INTEGER, new_count INTEGER, status TEXT, error TEXT);
  INSERT INTO alert (api, environment, name, pattern, query) VALUES ('trademark', 'sandbox', 'ok', '*a*', 'q'), ('trademark', 'sandbox', 'bez seeda', '*b*', 'q');
  INSERT INTO alert_check (alert_id, checked_at, status) VALUES (1, '2026-07-24 15:01:49', 'error'), (1, '2026-07-24 15:01:57', 'ok'), (2, '2026-07-25 10:00:00', 'error');
  INSERT INTO request_log (api, endpoint, environment) VALUES ('trademark', '/trademarks', 'production');
`);
legacy.close();

const { db } = await import('../src/db.js');

test('baza prototypu dostaje migracje i zachowuje dane', () => {
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_log').get().n, 1);
  const alerts = db.prepare('SELECT id, seeded_at FROM alert ORDER BY id').all();
  assert.equal(alerts[0].seeded_at, '2026-07-24 15:01:57');
  assert.equal(alerts[1].seeded_at, null);
});
