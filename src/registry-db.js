import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { migrate } from './migrate.js';

/**
 * Lokalna kopia rejestrów (EUIPO, UPRP). Osobny plik od danych aplikacji: da się ją
 * w całości odbudować z API, więc nie musi trafiać do kopii zapasowej, a jej rozmiar
 * (kilka GB) nie spowalnia backupu danych użytkowników.
 */

fs.mkdirSync(path.dirname(config.registryDbFile), { recursive: true });

export const registryDb = new Database(config.registryDbFile);
registryDb.pragma('journal_mode = WAL');

const migrations = [
  // 1: stan synchronizacji każdego źródła — punkt wznowienia importu i ostatnie odświeżenie.
  (d) => {
    d.exec(`
      CREATE TABLE sync_state (
        source       TEXT PRIMARY KEY,
        phase        TEXT NOT NULL DEFAULT 'idle',
        cursor       TEXT,
        records      INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        last_error   TEXT,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
];

migrate(registryDb, migrations);
