import fs from 'node:fs';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

// Testy ustawiają środowisko same — lokalny .env (prawdziwe klucze API) nie może do nich przeciekać.
const IS_TEST = process.env.NODE_ENV === 'test';
if (!IS_TEST) dotenv.config({ quiet: true });

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

const dbFile = process.env.DB_FILE || path.join(ROOT, 'data', 'neuron.sqlite');

/** Liczba całkowita ze zmiennej środowiskowej; zły zapis zgłasza validate(). */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
}

export const config = {
  isTest: IS_TEST,
  port: int('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',
  // Ścieżka bazowa gdy aplikacja stoi za NGINX pod podkatalogiem (np. /neuron)
  basePath: (process.env.BASE_PATH || '').replace(/\/$/, ''),
  // Dane aplikacji (użytkownicy, alerty, kolejka) — objęte kopią zapasową.
  dbFile,
  // Kopia rejestrów EUIPO/UPRP — da się ją odbudować z API, więc może leżeć poza kopią zapasową.
  registryDbFile: process.env.REGISTRY_DB_FILE || path.join(path.dirname(dbFile), 'registry.sqlite'),
  // Lokalna kopia rejestrów: zadania importu i odświeżania działają tylko przy REGISTRY_SYNC=true
  // (nie w CI ani w testach). IMPORT_EUIPO_FROM ogranicza import do zgłoszeń od tej daty —
  // na podglądzie krótszy okres, żeby nie zużywać limitu wspólnego z produkcją.
  registry: {
    sync: String(process.env.REGISTRY_SYNC || '').toLowerCase() === 'true',
    importEuipoFrom: process.env.IMPORT_EUIPO_FROM || '1996-01-01',
    importUprpFrom: process.env.IMPORT_UPRP_FROM || '1900-01-01',
    // Indeks nazw podmiotów z KRS: dzienny biuletyn zmian od tej daty (domyślnie od dnia pierwszego uruchomienia).
    krsFrom: process.env.KRS_FROM || '',
    // Pełne przejście po numerach KRS (ok. 1,3 mln zapytań) — tylko po decyzji Karola.
    krsBackfill: String(process.env.KRS_BACKFILL || '').toLowerCase() === 'true',
  },
  // Dzienne limity zapytań (doba UTC). Wartości z nagłówków X-RateLimit EUIPO (2026-11);
  // UPRP nie podaje limitu, więc ostrożne założenie do czasu pomiaru.
  quota: {
    'euipo-trademark': int('QUOTA_EUIPO_TRADEMARK', 6000),
    'euipo-design': int('QUOTA_EUIPO_DESIGN', 35000),
    uprp: int('QUOTA_UPRP', 5000),
    // KRS nie publikuje limitu; ostrożnie, zapytania i tak idą po kolei.
    krs: int('QUOTA_KRS', 10000),
  },
  // Brama hasła. Pusty WEBSITE_PASS = strona publiczna.
  auth: {
    password: process.env.WEBSITE_PASS || '',
    secret: process.env.SESSION_SECRET || '',
    maxAgeMs: Number(process.env.SESSION_HOURS || 12) * 60 * 60 * 1000,
    // Wymuszenie flagi Secure gdy TLS kończy się na NGINX i nie ma X-Forwarded-Proto.
    cookieSecure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
  },
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
  // UPRP nie rozróżnia środowisk — jest tylko system produkcyjny PUEUP.
  uprp: {
    apiKey: process.env.UPRP_API_KEY || process.env.UPRP_API_SECRET,
    tokenUrl: process.env.UPRP_TOKEN_URL || 'https://api.uprp.gov.pl/cmuia/api/external/auth/token',
    apiBase: process.env.UPRP_API_BASE || 'https://api.uprp.gov.pl/ewyszukiwarka/api/external',
  },
  // Otwarte API KRS (Ministerstwo Sprawiedliwości) — bez klucza.
  krs: {
    apiBase: process.env.KRS_API_BASE || 'https://api-krs.ms.gov.pl/api',
  },
};

/**
 * Sprawdza konfigurację przy starcie. Błędy (zły zapis liczb) przerywają start;
 * brak kluczy API tylko ostrzega — aplikacja wstaje, a zapytania do danego rejestru są odrzucane.
 * @returns {string[]} lista błędów (pusta = OK)
 */
export function validateConfig(cfg = config) {
  const errors = [];
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) errors.push('PORT musi być liczbą 1–65535.');
  for (const [source, limit] of Object.entries(cfg.quota)) {
    if (!Number.isInteger(limit) || limit < 1) errors.push(`Limit zapytań dla ${source} musi być dodatnią liczbą całkowitą.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.registry.importEuipoFrom)) {
    errors.push('IMPORT_EUIPO_FROM musi mieć format RRRR-MM-DD.');
  }
  if (path.resolve(cfg.dbFile) === path.resolve(cfg.registryDbFile)) {
    errors.push('DB_FILE i REGISTRY_DB_FILE muszą wskazywać różne pliki.');
  }
  return errors;
}

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

  if (!config.uprp.apiKey) {
    console.warn('[NEURON] Brak UPRP_API_KEY / UPRP_API_SECRET w .env — moduł UPRP będzie nieaktywny.');
  } else {
    console.log(`[NEURON] UPRP: klucz ${config.uprp.apiKey.slice(0, 8)}… · API: ${config.uprp.apiBase}`);
  }
}
