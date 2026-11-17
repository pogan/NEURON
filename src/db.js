import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { migrate, columnNames } from './migrate.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* Schemat bazy aplikacji. Nowe zmiany tylko jako kolejne elementy tablicy (patrz migrate.js). */
const migrations = [
  // 1: schemat prototypu (IF NOT EXISTS — bazy sprzed migracji mają już te tabele).
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        api           TEXT    NOT NULL,
        endpoint      TEXT    NOT NULL,
        params        TEXT,
        status        INTEGER,
        duration_ms   INTEGER,
        total_elements INTEGER,
        error         TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log (created_at DESC);

      CREATE TABLE IF NOT EXISTS saved_query (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        api        TEXT NOT NULL,
        name       TEXT NOT NULL,
        params     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alert (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        api            TEXT NOT NULL,
        environment    TEXT NOT NULL,
        name           TEXT NOT NULL,
        pattern        TEXT NOT NULL,
        query          TEXT NOT NULL,
        interval_hours INTEGER NOT NULL DEFAULT 24,
        active         INTEGER NOT NULL DEFAULT 1,
        last_check_at  TEXT,
        last_status    TEXT,
        last_error     TEXT,
        total_records  INTEGER
      );

      CREATE TABLE IF NOT EXISTS alert_record (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id      INTEGER NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
        record_id     TEXT NOT NULL,
        snapshot      TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_new        INTEGER NOT NULL DEFAULT 0,
        UNIQUE (alert_id, record_id)
      );

      CREATE INDEX IF NOT EXISTS idx_alert_record_alert ON alert_record (alert_id, is_new);

      CREATE TABLE IF NOT EXISTS alert_check (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id    INTEGER NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
        checked_at  TEXT NOT NULL DEFAULT (datetime('now')),
        found_total INTEGER,
        new_count   INTEGER,
        status      TEXT,
        error       TEXT
      );
    `);
    // Kolumna z nazwą środowiska EUIPO (produkcja / sandbox) — dodana w prototypie bez migracji.
    if (!columnNames(d, 'request_log').includes('environment')) {
      d.exec(`ALTER TABLE request_log ADD COLUMN environment TEXT`);
    }
  },

  // 2: kolejka zadań, dzienne zużycie limitów API, znacznik udanego stanu początkowego alertu.
  (d) => {
    d.exec(`
      CREATE TABLE job (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        type         TEXT    NOT NULL,
        payload      TEXT    NOT NULL DEFAULT '{}',
        priority     INTEGER NOT NULL DEFAULT 0,
        run_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        locked_until TEXT,
        status       TEXT    NOT NULL DEFAULT 'pending',
        last_error   TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        finished_at  TEXT
      );
      CREATE INDEX idx_job_due ON job (status, run_at, priority DESC);

      CREATE TABLE api_quota (
        source         TEXT    NOT NULL,
        day            TEXT    NOT NULL,
        used           INTEGER NOT NULL DEFAULT 0,
        remote_limit   INTEGER,
        remote_remaining INTEGER,
        updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source, day)
      );

      ALTER TABLE alert ADD COLUMN seeded_at TEXT;
    `);
    // Alerty, które miały już udane sprawdzenie, mają stan początkowy — nie wolno ich seedować ponownie.
    d.exec(`
      UPDATE alert SET seeded_at = (
        SELECT MIN(checked_at) FROM alert_check c WHERE c.alert_id = alert.id AND c.status = 'ok'
      )
    `);
  },

  // 3: pamięć podręczna sprawdzeń dostępności domen (RDAP/DNS).
  (d) => {
    d.exec(`
      CREATE TABLE domain_check (
        domain     TEXT PRIMARY KEY,
        status     TEXT NOT NULL,   -- 'taken' | 'free' | 'unknown'
        method     TEXT NOT NULL,   -- 'rdap' | 'dns'
        checked_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
];

migrate(db, migrations);

const insertLog = db.prepare(`
  INSERT INTO request_log (api, environment, endpoint, params, status, duration_ms, total_elements, error)
  VALUES (@api, @environment, @endpoint, @params, @status, @duration_ms, @total_elements, @error)
`);

export function logRequest(entry) {
  try {
    insertLog.run({
      api: entry.api,
      // UPRP i inne moduły mogą podać własne środowisko; domyślnie bierzemy EUIPO.
      environment: entry.environment || config.euipo.environment,
      endpoint: entry.endpoint,
      params: entry.params ? JSON.stringify(entry.params) : null,
      status: entry.status ?? null,
      duration_ms: entry.durationMs ?? null,
      total_elements: entry.totalElements ?? null,
      error: entry.error ?? null,
    });
  } catch (err) {
    console.error('[NEURON] Nie udało się zapisać logu:', err.message);
  }
}

export const queries = {
  recentLogs: db.prepare(
    `SELECT * FROM request_log ORDER BY id DESC LIMIT ?`
  ),
  listSaved: db.prepare(
    `SELECT * FROM saved_query WHERE api = ? ORDER BY id DESC LIMIT 50`
  ),
  insertSaved: db.prepare(
    `INSERT INTO saved_query (api, name, params) VALUES (?, ?, ?)`
  ),
  deleteSaved: db.prepare(`DELETE FROM saved_query WHERE id = ?`),
  stats: db.prepare(`
    SELECT api, environment,
           COUNT(*)                                   AS calls,
           SUM(CASE WHEN status >= 400 OR status IS NULL THEN 1 ELSE 0 END) AS errors,
           ROUND(AVG(duration_ms))                    AS avg_ms
    FROM request_log
    GROUP BY api, environment
  `),

  /* ------------------------------------------------------ alerty */

  listAlerts: db.prepare(`
    SELECT a.*,
           COALESCE(r.record_count, 0) AS record_count,
           COALESCE(r.new_count, 0)    AS new_count
    FROM alert a
    LEFT JOIN (
      SELECT alert_id, COUNT(*) AS record_count, SUM(is_new) AS new_count
      FROM alert_record GROUP BY alert_id
    ) r ON r.alert_id = a.id
    WHERE a.environment = ?
    ORDER BY a.id DESC
  `),
  getAlert: db.prepare(`SELECT * FROM alert WHERE id = ?`),
  insertAlert: db.prepare(`
    INSERT INTO alert (api, environment, name, pattern, query)
    VALUES (@api, @environment, @name, @pattern, @query)
  `),
  updateAlertCheck: db.prepare(`
    UPDATE alert
    SET last_check_at = datetime('now'), last_status = @status,
        last_error = @error, total_records = @total
    WHERE id = @id
  `),
  markAlertSeeded: db.prepare(
    `UPDATE alert SET seeded_at = datetime('now') WHERE id = ? AND seeded_at IS NULL`
  ),
  toggleAlert: db.prepare(`UPDATE alert SET active = 1 - active WHERE id = ?`),
  deleteAlert: db.prepare(`DELETE FROM alert WHERE id = ?`),
  dueAlerts: db.prepare(`
    SELECT * FROM alert
    WHERE active = 1 AND environment = ?
      AND (last_check_at IS NULL
           OR last_check_at <= datetime('now', '-' || interval_hours || ' hours'))
    ORDER BY last_check_at ASC
  `),

  alertRecords: db.prepare(`
    SELECT * FROM alert_record
    WHERE alert_id = ?
    ORDER BY is_new DESC, first_seen_at DESC, id DESC
  `),
  alertRecordIds: db.prepare(`SELECT record_id FROM alert_record WHERE alert_id = ?`),
  insertAlertRecord: db.prepare(`
    INSERT OR IGNORE INTO alert_record (alert_id, record_id, snapshot, is_new)
    VALUES (@alert_id, @record_id, @snapshot, @is_new)
  `),
  ackAlertRecords: db.prepare(`UPDATE alert_record SET is_new = 0 WHERE alert_id = ?`),

  insertAlertCheck: db.prepare(`
    INSERT INTO alert_check (alert_id, found_total, new_count, status, error)
    VALUES (@alert_id, @found_total, @new_count, @status, @error)
  `),
  alertChecks: db.prepare(`
    SELECT * FROM alert_check WHERE alert_id = ? ORDER BY id DESC LIMIT 20
  `),
  newCountTotal: db.prepare(`
    SELECT COALESCE(SUM(is_new), 0) AS new_count
    FROM alert_record r JOIN alert a ON a.id = r.alert_id
    WHERE a.environment = ?
  `),
};
