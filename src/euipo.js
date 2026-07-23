import { config } from './config.js';
import { logRequest } from './db.js';

/** Cache tokenu w pamięci procesu (PM2 cluster: jeden token na worker). */
let tokenCache = { value: null, expiresAt: 0 };

export class EuipoError extends Error {
  constructor(status, payload) {
    super(
      payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Błąd EUIPO (HTTP ${status})`
    );
    this.status = status;
    this.payload = payload;
  }
}

export async function getAccessToken({ force = false } = {}) {
  const now = Date.now();
  if (!force && tokenCache.value && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.value;
  }

  const { clientId, clientSecret, tokenUrl, scope, isSandbox } = config.euipo;
  if (!clientId || !clientSecret) {
    const keys = isSandbox
      ? 'EUIPO_SANDBOX_API_KEY / EUIPO_SANDBOX_API_SECRET'
      : 'EUIPO_API_KEY / EUIPO_API_SECRET';
    throw new EuipoError(500, { message: `Brak ${keys} w pliku .env` });
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text.slice(0, 500) };
  }

  if (!res.ok || !data.access_token) {
    throw new EuipoError(res.status || 500, data);
  }

  tokenCache = {
    value: data.access_token,
    expiresAt: now + (Number(data.expires_in || 3600) * 1000),
  };
  return tokenCache.value;
}

export function tokenInfo() {
  return {
    cached: Boolean(tokenCache.value),
    expiresAt: tokenCache.value ? new Date(tokenCache.expiresAt).toISOString() : null,
    expiresInSeconds: tokenCache.value
      ? Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000))
      : 0,
  };
}

function baseUrlFor(api) {
  return api === 'design' ? config.euipo.designBase : config.euipo.trademarkBase;
}

/**
 * Wykonuje żądanie do EUIPO. Ponawia raz po odświeżeniu tokenu na 401.
 * @param {'trademark'|'design'} api
 * @param {string} endpoint np. '/trademarks'
 * @param {object} opts { query, acceptLanguage, accept, raw }
 */
export async function euipoRequest(api, endpoint, opts = {}) {
  const { query = {}, acceptLanguage, accept = 'application/json', raw = false } = opts;

  const url = new URL(baseUrlFor(api) + endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value);
  }

  const started = Date.now();
  let attempt = 0;
  let res;

  while (true) {
    const token = await getAccessToken({ force: attempt > 0 });
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-IBM-Client-Id': config.euipo.clientId,
      Accept: accept,
      // Zawsze ustawiamy jawnie: fetch Node.js domyślnie dodaje `Accept-Language: *`,
      // które API wzorów odrzuca jako błąd walidacji (HTTP 400). Pusta wartość
      // oznacza dla EUIPO brak filtra — elementy wielojęzyczne we wszystkich językach.
      'Accept-Language': acceptLanguage || '',
    };

    res = await fetch(url, { headers });
    if (res.status !== 401 || attempt > 0) break;
    attempt += 1;
  }

  const durationMs = Date.now() - started;
  const rateLimit = {
    limit: res.headers.get('X-RateLimit-Limit'),
    remaining: res.headers.get('X-RateLimit-Remaining'),
    reset: res.headers.get('X-RateLimit-Reset'),
    retryAfter: res.headers.get('Retry-After'),
  };

  if (raw) {
    if (!res.ok) {
      const payload = await safeJson(res);
      logRequest({
        api, endpoint, params: query, status: res.status, durationMs,
        error: payload?.message || `HTTP ${res.status}`,
      });
      throw new EuipoError(res.status, payload);
    }
    logRequest({ api, endpoint, params: query, status: res.status, durationMs });
    return {
      stream: res.body,
      contentType: res.headers.get('Content-Type') || 'application/octet-stream',
      contentLength: res.headers.get('Content-Length'),
      rateLimit,
    };
  }

  const payload = await safeJson(res);

  if (!res.ok) {
    logRequest({
      api, endpoint, params: query, status: res.status, durationMs,
      error: payload?.message || payload?.detail || `HTTP ${res.status}`,
    });
    throw new EuipoError(res.status, payload);
  }

  logRequest({
    api, endpoint, params: query, status: res.status, durationMs,
    totalElements: typeof payload?.totalElements === 'number' ? payload.totalElements : null,
  });

  return { data: payload, status: res.status, durationMs, rateLimit, url: url.toString() };
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1000) };
  }
}
