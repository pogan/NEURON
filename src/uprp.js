import { XMLParser } from 'fast-xml-parser';
import { config } from './config.js';
import { logRequest } from './db.js';

/**
 * Klient API UPRP (PUEUP, moduł e-Wyszukiwarka).
 * Autoryzacja: klucz API → token JWT z CMUIA (ważny 24 h) → nagłówek Bearer.
 * Dokumentacja: docs/e-Wyszukiwarka.pdf oraz https://api.uprp.gov.pl/doc/ewyszukiwarka
 */

let tokenCache = { value: null, expiresAt: 0 };

export class UprpError extends Error {
  constructor(status, payload) {
    super(payload?.message || payload?.error || `Błąd UPRP (HTTP ${status})`);
    this.status = status;
    this.payload = payload;
  }
}

/** Odczyt `exp` z payloadu JWT — CMUIA nie zwraca czasu ważności obok tokenu. */
function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    /* token bez czytelnego payloadu — użyjemy domyślnej ważności */
  }
  return Date.now() + 23 * 3600_000;
}

export async function getUprpToken({ force = false } = {}) {
  const now = Date.now();
  if (!force && tokenCache.value && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.value;
  }

  const { apiKey, tokenUrl } = config.uprp;
  if (!apiKey) {
    throw new UprpError(500, { message: 'Brak UPRP_API_KEY / UPRP_API_SECRET w pliku .env' });
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ access_token: apiKey }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text.slice(0, 500) };
  }

  if (!res.ok || !data.token) {
    throw new UprpError(res.status || 500, data);
  }

  tokenCache = { value: data.token, expiresAt: jwtExpiry(data.token) };
  return tokenCache.value;
}

export function uprpTokenInfo() {
  return {
    cached: Boolean(tokenCache.value),
    expiresAt: tokenCache.value ? new Date(tokenCache.expiresAt).toISOString() : null,
    expiresInSeconds: tokenCache.value
      ? Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000))
      : 0,
  };
}

/** Parser XML — atrybuty zachowujemy z prefiksem @, żeby nie kolidowały z elementami. */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: true,
  // Numery zgłoszeń (np. „381951") i daty muszą pozostać tekstem.
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseXml(xml) {
  return xmlParser.parse(xml);
}

/**
 * Wykonuje żądanie do e-Wyszukiwarki UPRP. Ponawia raz po odświeżeniu tokenu na 401.
 * Odpowiedzi XML są parsowane do JSON; surowy XML wraca w polu `xml`.
 * @param {string} endpoint np. '/pwp-types'
 * @param {object} opts { method, query, body }
 */
export async function uprpRequest(endpoint, opts = {}) {
  const { method = 'GET', query = {}, body } = opts;

  const url = new URL(config.uprp.apiBase + endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value);
  }

  const started = Date.now();
  let attempt = 0;
  let res;

  while (true) {
    const token = await getUprpToken({ force: attempt > 0 });
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, application/xml, text/plain, */*',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 401 || attempt > 0) break;
    attempt += 1;
  }

  const durationMs = Date.now() - started;
  const contentType = res.headers.get('Content-Type') || '';
  const text = await res.text();

  if (!res.ok) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // UPRP zwraca 400/404 z pustym ciałem, gdy nie znajdzie PWP o podanym numerze.
      const fallback =
        res.status === 404 || res.status === 400
          ? 'Nie znaleziono PWP o podanym numerze zgłoszenia.'
          : `Błąd UPRP (HTTP ${res.status})`;
      payload = { message: text.slice(0, 1000).trim() || fallback };
    }
    logRequest({
      api: 'uprp', environment: 'production',
      endpoint, params: { ...query, ...(body ? { body } : {}) },
      status: res.status, durationMs,
      error: payload?.message || payload?.error || `HTTP ${res.status}`,
    });
    throw new UprpError(res.status, payload);
  }

  let data = null;
  let xml = null;
  let totalElements = null;

  if (text.trimStart().startsWith('<')) {
    xml = text;
    try {
      data = parseXml(text);
      const total = data?.root?.total;
      if (total !== undefined) totalElements = Number(total);
    } catch {
      data = null;
    }
  } else {
    try {
      data = JSON.parse(text);
      if (Array.isArray(data)) totalElements = data.length;
    } catch {
      // deterministic-search zwraca goły identyfikator jako text/plain
      data = text.trim().replace(/^"|"$/g, '');
    }
  }

  logRequest({
    api: 'uprp', environment: 'production',
    endpoint, params: { ...query, ...(body ? { body } : {}) },
    status: res.status, durationMs, totalElements,
  });

  return { data, xml, status: res.status, durationMs, contentType, url: url.toString() };
}
