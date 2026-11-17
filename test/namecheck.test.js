import { stubFetch } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { checkName, domainLabels, socialHandle } = await import('../src/namecheck.js');
const { upsertTrademark, euipoToTrademark } = await import('../src/registry.js');

test('etykiety domen i nazwa konta z polskiej nazwy', () => {
  assert.deepEqual(domainLabels('Leśna Świeca'), ['lesnaswieca', 'lesna-swieca']);
  assert.deepEqual(domainLabels('!!!'), []);
  assert.equal(socialHandle('Leśna Świeca'), 'lesnaswieca');
});

test('domeny z RDAP (404 = wolna), linki do kont i znaki z kopii rejestru', async () => {
  upsertTrademark(euipoToTrademark({ applicationNumber: '009', wordMarkSpecification: { verbalElement: 'LEŚNA ŚWIECA' }, status: 'REGISTERED' }));
  const calls = stubFetch([
    (url) => ({ status: url.includes('lesnaswieca.pl') ? 200 : 404 }),
    () => ({ status: 404 }),
    () => ({ status: 404 }),
    () => ({ status: 404 }),
  ]);
  const result = await checkName('Leśna Świeca', { tlds: ['pl', 'com'] });
  const byDomain = Object.fromEntries(result.domains.map((d) => [d.domain, d.status]));
  assert.equal(byDomain['lesnaswieca.pl'], 'taken');
  assert.equal(byDomain['lesnaswieca.com'], 'free');
  assert.equal(byDomain['lesna-swieca.pl'], 'free');
  assert.ok(calls.some((u) => u.startsWith('https://rdap.dns.pl/domain/')));
  assert.equal(result.social.find((s) => s.id === 'instagram').url, 'https://www.instagram.com/lesnaswieca/');
  assert.equal(result.trademarks.matches[0].exact, true);

  // Druga prośba o te same domeny idzie z pamięci podręcznej, bez zapytań RDAP.
  stubFetch([]);
  const again = await checkName('Leśna Świeca', { tlds: ['pl', 'com'] });
  assert.ok(again.domains.every((d) => d.cached));
});
