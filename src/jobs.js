import { db } from './db.js';
import { QuotaError } from './quota.js';

/**
 * Kolejka zadań w tabeli `job` z jednym wykonawcą w procesie aplikacji.
 * Podgląd i produkcja działają jako jeden proces (PM2 fork / jeden kontener),
 * więc nie potrzebujemy osobnego workera ani Redisa.
 *
 * Zadanie, które rzuci wyjątek, wraca do kolejki z wykładniczo rosnącym opóźnieniem;
 * po `max_attempts` dostaje status `failed`. Wyczerpany limit API (QuotaError)
 * nie zużywa prób — zadanie czeka do następnej doby UTC.
 */

const handlers = new Map();

const statements = {
  insert: db.prepare(`
    INSERT INTO job (type, payload, priority, run_at, max_attempts)
    VALUES (@type, @payload, @priority, @run_at, @max_attempts)
  `),
  // Zadanie zawieszone przez zbyt długo trwający przebieg (np. restart w trakcie) wraca po wygaśnięciu blokady.
  next: db.prepare(`
    SELECT * FROM job
    WHERE status IN ('pending', 'running')
      AND run_at <= datetime('now')
      AND (locked_until IS NULL OR locked_until <= datetime('now'))
    ORDER BY priority DESC, run_at ASC, id ASC
    LIMIT 1
  `),
  lock: db.prepare(`
    UPDATE job SET status = 'running', attempts = attempts + 1,
           locked_until = datetime('now', '+' || @lock_seconds || ' seconds')
    WHERE id = @id AND (locked_until IS NULL OR locked_until <= datetime('now'))
  `),
  done: db.prepare(`
    UPDATE job SET status = 'done', locked_until = NULL, last_error = NULL, finished_at = datetime('now')
    WHERE id = ?
  `),
  retry: db.prepare(`
    UPDATE job SET status = 'pending', locked_until = NULL, last_error = @error,
           run_at = datetime('now', '+' || @delay_seconds || ' seconds')
    WHERE id = @id
  `),
  postpone: db.prepare(`
    UPDATE job SET status = 'pending', locked_until = NULL, last_error = @error,
           attempts = attempts - 1, run_at = @run_at
    WHERE id = @id
  `),
  fail: db.prepare(`
    UPDATE job SET status = 'failed', locked_until = NULL, last_error = @error, finished_at = datetime('now')
    WHERE id = @id
  `),
  pendingOfType: db.prepare(
    `SELECT COUNT(*) AS n FROM job WHERE type = ? AND status IN ('pending', 'running')`
  ),
};

/** Format daty SQLite (UTC, bez strefy) — porównywalny z datetime('now'). */
const sqlTime = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

/**
 * Rejestruje obsługę typu zadania.
 * @param {string} type
 * @param {(payload: object, job: object) => Promise<void>} handler
 * @param {{lockSeconds?: number}} opts ile maksymalnie może trwać jeden przebieg
 */
export function registerJob(type, handler, { lockSeconds = 600 } = {}) {
  handlers.set(type, { handler, lockSeconds });
}

/**
 * Dodaje zadanie do kolejki.
 * @param {{runAt?: Date, priority?: number, maxAttempts?: number, unique?: boolean}} opts
 *   unique: nie dodawaj, jeśli zadanie tego typu już czeka (np. cykliczne odświeżanie)
 */
export function enqueue(type, payload = {}, { runAt = new Date(), priority = 0, maxAttempts = 5, unique = false } = {}) {
  if (unique && statements.pendingOfType.get(type).n > 0) return null;
  const info = statements.insert.run({
    type,
    payload: JSON.stringify(payload),
    priority,
    run_at: sqlTime(runAt),
    max_attempts: maxAttempts,
  });
  return Number(info.lastInsertRowid);
}

/** Opóźnienie kolejnej próby: 1, 2, 4, 8… minut, najwyżej 6 h. */
export function retryDelaySeconds(attempts) {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);
}

function nextUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}

/**
 * Wykonuje jedno wymagalne zadanie. Zwraca false, gdy kolejka jest pusta.
 * Eksportowane dla testów i ręcznego uruchamiania; w aplikacji woła je startJobRunner().
 */
export async function runNextJob() {
  const job = statements.next.get();
  if (!job) return false;

  const entry = handlers.get(job.type);
  if (!entry) {
    statements.fail.run({ id: job.id, error: `Brak obsługi zadania typu „${job.type}”.` });
    return true;
  }
  // Inny przebieg mógł zablokować zadanie między SELECT a UPDATE.
  if (statements.lock.run({ id: job.id, lock_seconds: entry.lockSeconds }).changes === 0) return true;

  try {
    await entry.handler(JSON.parse(job.payload), job);
    statements.done.run(job.id);
  } catch (err) {
    const error = String(err?.message || err).slice(0, 1000);
    if (err instanceof QuotaError) {
      statements.postpone.run({ id: job.id, error, run_at: sqlTime(nextUtcMidnight()) });
    } else if (job.attempts + 1 >= job.max_attempts) {
      statements.fail.run({ id: job.id, error });
      console.error(`[NEURON] Zadanie #${job.id} (${job.type}) nieudane po ${job.attempts + 1} próbach: ${error}`);
    } else {
      statements.retry.run({ id: job.id, error, delay_seconds: retryDelaySeconds(job.attempts + 1) });
    }
  }
  return true;
}

let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    // Limit na jeden tick, żeby długa kolejka nie blokowała procesu w nieskończoność.
    for (let i = 0; i < 50 && (await runNextJob()); i += 1);
  } catch (err) {
    console.error('[NEURON] Błąd wykonawcy zadań:', err);
  } finally {
    running = false;
  }
}

export function startJobRunner({ intervalMs = 60_000 } = {}) {
  setTimeout(drain, 5_000).unref();
  setInterval(drain, intervalMs).unref();
  console.log(`[NEURON] Kolejka zadań uruchomiona (tick co ${Math.round(intervalMs / 1000)} s).`);
}
