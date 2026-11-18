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

  // 2: znaki towarowe z obu rejestrów + indeks trigramowy znormalizowanej nazwy (wyszukiwanie fragmentów).
  (d) => {
    d.exec(`
      CREATE TABLE trademark (
        id                INTEGER PRIMARY KEY,
        source            TEXT NOT NULL,            -- 'euipo' | 'uprp'
        number            TEXT NOT NULL,            -- numer zgłoszenia w rejestrze
        name              TEXT,                     -- element słowny w oryginalnej pisowni
        name_norm         TEXT NOT NULL DEFAULT '', -- normalizeName(name)
        mark_feature      TEXT,
        mark_kind         TEXT,
        status            TEXT,
        nice_classes      TEXT,                     -- ',25,35,' (przecinki na brzegach ułatwiają LIKE)
        applicants        TEXT,                     -- JSON [{ name, country }]
        application_date  TEXT,
        registration_date TEXT,
        expiry_date       TEXT,
        data              TEXT NOT NULL,            -- rekord z API (lista wyników) jako JSON
        synced_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source, number)
      );
      CREATE INDEX idx_trademark_application ON trademark (source, application_date);

      CREATE VIRTUAL TABLE trademark_fts USING fts5(
        name_norm, content = 'trademark', content_rowid = 'id', tokenize = 'trigram'
      );
      CREATE TRIGGER trademark_ai AFTER INSERT ON trademark BEGIN
        INSERT INTO trademark_fts (rowid, name_norm) VALUES (new.id, new.name_norm);
      END;
      CREATE TRIGGER trademark_ad AFTER DELETE ON trademark BEGIN
        INSERT INTO trademark_fts (trademark_fts, rowid, name_norm) VALUES ('delete', old.id, old.name_norm);
      END;
      CREATE TRIGGER trademark_au AFTER UPDATE OF name_norm ON trademark BEGIN
        INSERT INTO trademark_fts (trademark_fts, rowid, name_norm) VALUES ('delete', old.id, old.name_norm);
        INSERT INTO trademark_fts (rowid, name_norm) VALUES (new.id, new.name_norm);
      END;
    `);
  },

  // 3: nazwy podmiotów z KRS (rejestr przedsiębiorców P i stowarzyszeń S) + indeks trigramowy.
  (d) => {
    d.exec(`
      CREATE TABLE company (
        id            INTEGER PRIMARY KEY,         -- stały rowid dla indeksu FTS (VACUUM nie zmienia)
        krs           TEXT NOT NULL UNIQUE,        -- numer KRS, 10 cyfr
        register      TEXT NOT NULL,               -- 'P' | 'S'
        name          TEXT NOT NULL,
        name_norm     TEXT NOT NULL DEFAULT '',
        legal_form    TEXT,
        nip           TEXT,
        regon         TEXT,
        city          TEXT,
        registered_on TEXT,                        -- data wpisu do KRS (RRRR-MM-DD)
        last_entry_on TEXT,                        -- data ostatniego wpisu
        removed       INTEGER NOT NULL DEFAULT 0,  -- 1: brak odpisu aktualnego (podmiot wykreślony)
        synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE company_fts USING fts5(
        name_norm, content = 'company', content_rowid = 'id', tokenize = 'trigram'
      );
      CREATE TRIGGER company_ai AFTER INSERT ON company BEGIN
        INSERT INTO company_fts (rowid, name_norm) VALUES (new.id, new.name_norm);
      END;
      CREATE TRIGGER company_ad AFTER DELETE ON company BEGIN
        INSERT INTO company_fts (company_fts, rowid, name_norm) VALUES ('delete', old.id, old.name_norm);
      END;
      CREATE TRIGGER company_au AFTER UPDATE OF name_norm ON company BEGIN
        INSERT INTO company_fts (company_fts, rowid, name_norm) VALUES ('delete', old.id, old.name_norm);
        INSERT INTO company_fts (rowid, name_norm) VALUES (new.id, new.name_norm);
      END;
    `);
  },

  // 4: indeks silnika podobieństwa — nazwa sklejona i klucze fonetyczne (PL, EN) jako trigramy.
  // Bez kopii treści (klucze liczy similarity.js); wiersze dopisuje upsertTrademark,
  // a znaki sprzed tej migracji uzupełnia zadanie sim-index (sync-sim.js).
  (d) => {
    d.exec(`
      CREATE VIRTUAL TABLE trademark_sim USING fts5(
        compact, pl, en, content = '', contentless_delete = 1, tokenize = 'trigram'
      );
    `);
  },
];

migrate(registryDb, migrations);
