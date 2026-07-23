import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

/**
 * Środowisko EUIPO. ENV=sandbox przełącza na system testowy
 * (inny serwer autoryzacji, inny host API i osobna para kluczy).
 */
const envName = String(process.env.ENV || 'production').trim().toLowerCase();
export const IS_SANDBOX = ['sandbox', 'test', 'dev'].includes(envName);

const ENVIRONMENTS = {
  production: {
    tokenUrl: 'https://euipo.europa.eu/cas-server-webapp/oidc/accessToken',
    apiHost: 'https://api.euipo.europa.eu',
  },
  sandbox: {
    tokenUrl: 'https://auth-sandbox.euipo.europa.eu/oidc/accessToken',
    apiHost: 'https://api-sandbox.euipo.europa.eu',
  },
};

const active = IS_SANDBOX ? ENVIRONMENTS.sandbox : ENVIRONMENTS.production;

/** W trybie sandbox klucze SANDBOX mają pierwszeństwo, z fallbackiem na produkcyjne. */
const clientId = IS_SANDBOX
  ? process.env.EUIPO_SANDBOX_API_KEY || process.env.EUIPO_API_KEY
  : process.env.EUIPO_API_KEY;

const clientSecret = IS_SANDBOX
  ? process.env.EUIPO_SANDBOX_API_SECRET || process.env.EUIPO_API_SECRET
  : process.env.EUIPO_API_SECRET;

const apiHost = process.env.EUIPO_API_HOST || active.apiHost;

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  // Ścieżka bazowa gdy aplikacja stoi za NGINX pod podkatalogiem (np. /neuron)
  basePath: (process.env.BASE_PATH || '').replace(/\/$/, ''),
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'neuron.sqlite'),
  euipo: {
    environment: IS_SANDBOX ? 'sandbox' : 'production',
    isSandbox: IS_SANDBOX,
    clientId,
    clientSecret,
    apiHost,
    tokenUrl: process.env.EUIPO_TOKEN_URL || active.tokenUrl,
    trademarkBase: process.env.EUIPO_TRADEMARK_BASE || `${apiHost}/trademark-search`,
    designBase: process.env.EUIPO_DESIGN_BASE || `${apiHost}/design-search`,
    scope: process.env.EUIPO_SCOPE || 'uid',
  },
};

/**
 * Znacznik wersji zasobów statycznych — doklejany do URL-i CSS/JS jako `?v=`.
 * Zmienia się przy każdej edycji pliku w `public/`, więc przeglądarka pobiera nową
 * wersję natychmiast, zamiast trzymać starą kopię do wygaśnięcia cache.
 */
export function assetVersion() {
  const dir = path.join(ROOT, 'public');
  let newest = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try {
    walk(dir);
  } catch {
    return String(Date.now());
  }
  return Math.round(newest).toString(36);
}

export function assertCredentials() {
  const { environment, clientId: id, tokenUrl, apiHost: host } = config.euipo;
  console.log(`[NEURON] Środowisko EUIPO: ${environment.toUpperCase()} (${host})`);

  if (!id || !config.euipo.clientSecret) {
    const keyName = IS_SANDBOX ? 'EUIPO_SANDBOX_API_KEY / EUIPO_SANDBOX_API_SECRET' : 'EUIPO_API_KEY / EUIPO_API_SECRET';
    console.warn(`[NEURON] Brak ${keyName} w .env — zapytania do API będą odrzucane.`);
  } else {
    console.log(`[NEURON] Client ID: ${id.slice(0, 8)}… · token: ${tokenUrl}`);
  }
}
