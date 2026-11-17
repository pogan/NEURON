import { config } from './config.js';
import { db } from './db.js';

/**
 * Dzienny budżet zapytań do API rejestrów (doba UTC, tak jak liczy EUIPO).
 *
 * Priorytety dzielą limit tak, żeby import w tle nigdy nie zjadł zapytań potrzebnych
 * użytkownikom: import może zużyć do 80% limitu, odświeżanie do 90%, a zapytania
 * wywołane przez użytkownika resztę.
 */

export const PRIORITY_SHARE = {
  interactive: 1,
  sync: 0.9,
  import: 0.8,
};

export class QuotaError extends Error {
  constructor(source, priority) {
    super(`Dzienny limit zapytań do ${source} wyczerpany dla zadań typu „${priority}”. Spróbuj po północy UTC.`);
    this.status = 429;
    this.source = source;
    this.priority = priority;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

const statements = {
  get: db.prepare(`SELECT * FROM api_quota WHERE source = ? AND day = ?`),
  consume: db.prepare(`
    INSERT INTO api_quota (source, day, used) VALUES (?, ?, 1)
    ON CONFLICT (source, day) DO UPDATE SET used = used + 1, updated_at = datetime('now')
  `),
  remote: db.prepare(`
    UPDATE api_quota SET remote_limit = @limit, remote_remaining = @remaining, updated_at = datetime('now')
    WHERE source = @source AND day = @day
  `),
};

/** Odczyt nagłówka EUIPO w formacie `name=default,6000;` (albo zwykłej liczby). */
export function parseRateLimitHeader(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/(\d+)\s*;?\s*$/);
  return match ? Number(match[1]) : null;
}

export function usage(source, day = today()) {
  const row = statements.get.get(source, day);
  const limit = config.quota[source];
  const used = row?.used ?? 0;
  // Gdy API samo podało, ile zostało, ufamy mniejszej z wartości (np. zapytania z innej instancji na tym samym kluczu).
  const remainingLocal = limit - used;
  const remaining = row?.remote_remaining != null ? Math.min(remainingLocal, row.remote_remaining) : remainingLocal;
  return { source, day, limit, used, remaining: Math.max(0, remaining) };
}

/**
 * Rezerwuje jedno zapytanie. Rzuca QuotaError, gdy zadania tego priorytetu wyczerpały swoją część limitu.
 * @param {keyof typeof config.quota} source
 * @param {'interactive'|'sync'|'import'} priority
 */
export function consume(source, priority = 'interactive') {
  const share = PRIORITY_SHARE[priority];
  if (share === undefined) throw new Error(`Nieznany priorytet: ${priority}`);
  const { limit, remaining } = usage(source);
  const usedSoFar = limit - remaining;
  if (usedSoFar >= Math.floor(limit * share)) throw new QuotaError(source, priority);
  statements.consume.run(source, today());
}

/** Zapisuje stan limitu podany przez API (nagłówki X-RateLimit-*), jeśli jest. */
export function recordRemote(source, { limit, remaining }) {
  const parsedLimit = parseRateLimitHeader(limit);
  const parsedRemaining = parseRateLimitHeader(remaining);
  if (parsedLimit === null && parsedRemaining === null) return;
  statements.remote.run({ source, day: today(), limit: parsedLimit, remaining: parsedRemaining });
}
