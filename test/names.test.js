import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from '../src/names.js';

test('normalizacja usuwa diakrytyki, interpunkcję i wielkość liter', () => {
  assert.equal(normalizeName('Leśna Świeca'), 'LESNA SWIECA');
  assert.equal(normalizeName('ŁÓDŹ & Żabka sp. z o.o.'), 'LODZ ZABKA SP Z O O');
  assert.equal(normalizeName('Straße—Øl'), 'STRASSE OL');
  assert.equal(normalizeName('  neuro-LAB  '), 'NEURO LAB');
  assert.equal(normalizeName(null), '');
});
