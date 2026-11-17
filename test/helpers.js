// Wspólne przygotowanie testów: każdy plik testowy (osobny proces node --test) dostaje
// własny katalog z bazami i kontrolowane środowisko. Importować PRZED czymkolwiek z src/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuron-test-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  ENV: 'sandbox',
  EUIPO_SANDBOX_API_KEY: 'test-key',
  EUIPO_SANDBOX_API_SECRET: 'test-secret',
  UPRP_API_KEY: 'test-uprp',
  WEBSITE_PASS: '',
  DB_FILE: path.join(tmpDir, 'app.sqlite'),
  REGISTRY_DB_FILE: path.join(tmpDir, 'registry.sqlite'),
  QUOTA_EUIPO_TRADEMARK: process.env.QUOTA_EUIPO_TRADEMARK || '10',
});

process.on('exit', () => fs.rmSync(tmpDir, { recursive: true, force: true }));

/**
 * Podmienia globalny fetch na odpowiedzi z kolejki (token OAuth obsługiwany automatycznie).
 * Każdy element kolejki: { status, body } albo funkcja (url) => { status, body }.
 */
export function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('accessToken') || url.includes('/auth/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, token: 'a.b.c' }), { status: 200 });
    }
    const next = responses.shift();
    if (!next) throw new Error(`Nieoczekiwane zapytanie w teście: ${url}`);
    const { status = 200, body = {} } = typeof next === 'function' ? next(url) : next;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': 'name=default,5000;' },
    });
  };
  return calls;
}
