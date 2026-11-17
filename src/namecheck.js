import dns from 'node:dns/promises';
import { db } from './db.js';
import { normalizeName } from './names.js';
import { findByFragment, trademarkCounts, findCompanies, companyCount } from './registry.js';

/**
 * „Sprawdź nazwę wszędzie”: domeny, linki do kont w social mediach, szybki przegląd
 * znaków z lokalnej kopii rejestrów i nazwy podmiotów z indeksu KRS.
 *
 * Domeny: RDAP rejestru (.pl — NASK, .com — Verisign; 404 = brak domeny w rejestrze),
 * a gdy RDAP nie odpowie albo go nie ma (.eu) — rekordy NS w DNS (wynik orientacyjny).
 * Pytamy tylko o nazwy wpisane przez użytkownika, z pamięcią podręczną — regulaminy RDAP
 * zabraniają masowych zapytań.
 *
 * Konta w social mediach: tylko linki do sprawdzenia przez użytkownika. Platformy nie mają
 * oficjalnego sposobu sprawdzania dostępności nazwy, a regulaminy zabraniają automatycznego
 * odpytywania (decyzja z 2026-11-17).
 */

const RDAP = {
  pl: (domain) => `https://rdap.dns.pl/domain/${domain}`,
  com: (domain) => `https://rdap.verisign.com/com/v1/domain/${domain}`,
};
export const TLDS = ['pl', 'com', 'eu'];
const CACHE_HOURS = 12;
const LOOKUPS_PER_MINUTE = 30;

export const SOCIAL = [
  { id: 'instagram', label: 'Instagram', url: (h) => `https://www.instagram.com/${h}/` },
  { id: 'facebook', label: 'Facebook', url: (h) => `https://www.facebook.com/${h}` },
  { id: 'tiktok', label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}` },
  { id: 'youtube', label: 'YouTube', url: (h) => `https://www.youtube.com/@${h}` },
  { id: 'linkedin', label: 'LinkedIn', url: (h) => `https://www.linkedin.com/company/${h}` },
  { id: 'x', label: 'X', url: (h) => `https://x.com/${h}` },
  { id: 'pinterest', label: 'Pinterest', url: (h) => `https://www.pinterest.com/${h}/` },
];

const statements = {
  get: db.prepare(`
    SELECT * FROM domain_check WHERE domain = ? AND checked_at > datetime('now', '-' || ? || ' hours')
  `),
  put: db.prepare(`
    INSERT INTO domain_check (domain, status, method) VALUES (?, ?, ?)
    ON CONFLICT (domain) DO UPDATE SET status = excluded.status, method = excluded.method, checked_at = datetime('now')
  `),
};

/** Etykiety domen z nazwy: „Leśna Świeca” → ['lesnaswieca', 'lesna-swieca']. */
export function domainLabels(name) {
  const words = normalizeName(name).toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return [];
  const labels = [words.join('')];
  if (words.length > 1) labels.push(words.join('-'));
  return labels.filter((l) => l.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l));
}

/** Nazwa konta: litery i cyfry bez spacji (platformy mają różne reguły, to wspólny mianownik). */
export function socialHandle(name) {
  return normalizeName(name).toLowerCase().replace(/ /g, '');
}

let windowStart = 0;
let lookups = 0;
function takeLookup() {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    lookups = 0;
  }
  lookups += 1;
  return lookups <= LOOKUPS_PER_MINUTE;
}

async function viaRdap(domain, tld) {
  const res = await fetch(RDAP[tld](domain), {
    headers: { Accept: 'application/rdap+json' },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return 'free';
  if (res.ok) return 'taken';
  throw new Error(`RDAP HTTP ${res.status}`);
}

async function viaDns(domain) {
  try {
    const ns = await dns.resolveNs(domain);
    return ns.length ? 'taken' : 'unknown';
  } catch (err) {
    // NXDOMAIN: domeny nie ma w DNS — zwykle wolna, ale bywa zarejestrowana bez serwerów nazw.
    if (err.code === 'ENOTFOUND') return 'free';
    if (err.code === 'ENODATA') return 'taken';
    return 'unknown';
  }
}

export async function checkDomain(domain) {
  const cached = statements.get.get(domain, CACHE_HOURS);
  if (cached) return { domain, status: cached.status, method: cached.method, cached: true };

  const tld = domain.split('.').pop();
  let status = 'unknown';
  let method = 'dns';
  if (!takeLookup()) return { domain, status, method: 'limit' };

  if (RDAP[tld]) {
    try {
      status = await viaRdap(domain, tld);
      method = 'rdap';
    } catch {
      status = await viaDns(domain);
    }
  } else {
    status = await viaDns(domain);
  }
  if (status !== 'unknown') statements.put.run(domain, status, method);
  return { domain, status, method };
}

/** Pełne sprawdzenie nazwy. `tlds` do zawężenia w testach (bez DNS). */
export async function checkName(name, { tlds = TLDS } = {}) {
  const labels = domainLabels(name);
  const domains = await Promise.all(
    labels.flatMap((label) => tlds.map((tld) => checkDomain(`${label}.${tld}`)))
  );
  const handle = socialHandle(name);
  const social = handle ? SOCIAL.map((s) => ({ id: s.id, label: s.label, handle, url: s.url(handle) })) : [];

  const matches = findByFragment(name, 20).map((t) => ({
    source: t.source,
    number: t.number,
    name: t.name,
    status: t.status,
    niceClasses: (t.nice_classes || '').split(',').filter(Boolean).map(Number),
    applicationDate: t.application_date,
    applicants: JSON.parse(t.applicants || '[]'),
    exact: t.name_norm === normalizeName(name),
  }));

  const companies = findCompanies(name, 20).map((c) => ({
    krs: c.krs,
    name: c.name,
    legalForm: c.legal_form,
    city: c.city,
    registeredOn: c.registered_on,
  }));

  return {
    name,
    normalized: normalizeName(name),
    domains,
    social,
    trademarks: { registry: trademarkCounts(), matches },
    companies: { indexed: companyCount(), matches: companies },
  };
}
