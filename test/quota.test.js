import './helpers.js'; // QUOTA_EUIPO_TRADEMARK=10
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { consume, usage, recordRemote, parseRateLimitHeader, QuotaError } = await import('../src/quota.js');

test('odczyt nagłówka limitu EUIPO', () => {
  assert.equal(parseRateLimitHeader('name=default,6000;'), 6000);
  assert.equal(parseRateLimitHeader('42'), 42);
  assert.equal(parseRateLimitHeader(null), null);
  assert.equal(parseRateLimitHeader('brak'), null);
});

test('import zatrzymuje się na 80%, odświeżanie na 90%, użytkownik dostaje resztę', () => {
  for (let i = 0; i < 8; i += 1) consume('euipo-trademark', 'import');
  assert.throws(() => consume('euipo-trademark', 'import'), QuotaError);
  consume('euipo-trademark', 'sync');
  assert.throws(() => consume('euipo-trademark', 'sync'), QuotaError);
  consume('euipo-trademark', 'interactive');
  assert.throws(() => consume('euipo-trademark', 'interactive'), QuotaError);
  assert.deepEqual(
    { used: usage('euipo-trademark').used, remaining: usage('euipo-trademark').remaining },
    { used: 10, remaining: 0 }
  );
});

test('mniejszy limit zgłoszony przez API ma pierwszeństwo', () => {
  consume('euipo-design', 'interactive');
  recordRemote('euipo-design', { limit: 'name=default,35000;', remaining: 'name=default,3;' });
  assert.equal(usage('euipo-design').remaining, 3);
});

test('nieznany priorytet to błąd programisty', () => {
  assert.throws(() => consume('uprp', 'pilne'), /Nieznany priorytet/);
});
