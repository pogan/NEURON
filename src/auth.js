import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Prosta brama hasła dla całej aplikacji.
 *
 * Hasło (WEBSITE_PASS) nigdy nie trafia do przeglądarki — po poprawnym logowaniu
 * wydawane jest podpisane HMAC-iem ciasteczko z datą wygaśnięcia. Sprawdzanie
 * odbywa się po stronie serwera, więc modal nie jest tylko ozdobą: bez ciasteczka
 * żaden widok ani endpoint API nie zwróci danych.
 */

const COOKIE = 'nrn_auth';

/** Klucz podpisu. Bez SESSION_SECRET wyprowadzany z hasła — sesje przeżywają restart, ale giną po zmianie hasła. */
const SIGNING_KEY = config.auth.secret
  ? Buffer.from(config.auth.secret)
  : crypto.createHash('sha256').update(`neuron:${config.auth.password}`).digest();

export const authEnabled = Boolean(config.auth.password);

function hmac(value) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(value).digest('base64url');
}

function issueToken() {
  const exp = String(Date.now() + config.auth.maxAgeMs);
  return `${exp}.${hmac(exp)}`;
}

function tokenValid(token) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  const expected = hmac(exp);
  // Długości są tu stałe, ale timingSafeEqual rzuca przy różnych — stąd wcześniejszy test.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}

function passwordValid(input) {
  if (typeof input !== 'string' || !input) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(config.auth.password).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function cookiePath() {
  return config.basePath || '/';
}

function isSecure(req) {
  if (config.auth.cookieSecure) return true;
  return (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
}

function setSession(req, res) {
  res.cookie(COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    path: cookiePath(),
    maxAge: config.auth.maxAgeMs,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: cookiePath() });
}

/** Cel powrotu po zalogowaniu — tylko ścieżki wewnątrz aplikacji, żeby nie zrobić open redirectu. */
function safeNext(value, base) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return `${base}/`;
  return value;
}

/**
 * Rejestruje trasy logowania i bramę na przekazanym routerze.
 * Wywołać PO `/static` i `/healthz`, a PRZED trasami z danymi.
 */
export function installAuthGate(router, { base, assetVersion }) {
  if (!authEnabled) {
    console.warn('[NEURON] Brak WEBSITE_PASS w .env — strona jest publiczna (brama hasła wyłączona).');
    return;
  }

  const renderLogin = (res, locals = {}) =>
    res.render('login', { base, v: assetVersion, title: 'Logowanie', error: null, next: `${base}/`, ...locals });

  router.get('/login', (req, res) => {
    if (tokenValid(readCookie(req, COOKIE))) return res.redirect(safeNext(req.query.next, base));
    return renderLogin(res, { next: safeNext(req.query.next, base) });
  });

  router.post('/login', (req, res) => {
    const next = safeNext(req.body?.next, base);
    if (!passwordValid(req.body?.password)) {
      return res.status(401).render('login', {
        base,
        v: assetVersion,
        title: 'Logowanie',
        error: 'Nieprawidłowe hasło.',
        next,
      });
    }
    setSession(req, res);
    return res.redirect(next);
  });

  router.post('/logout', (_req, res) => {
    clearSession(res);
    res.redirect(`${base}/login`);
  });

  router.use((req, res, nextFn) => {
    if (tokenValid(readCookie(req, COOKIE))) return nextFn();

    // Zapytania AJAX/API dostają czytelny status zamiast HTML-a logowania.
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'unauthorized', message: 'Sesja wygasła — zaloguj się ponownie.' });
    }

    // originalUrl zawiera już basePath (router jest zamontowany pod nim).
    return res.redirect(`${base}/login?next=${encodeURIComponent(req.originalUrl)}`);
  });
}
