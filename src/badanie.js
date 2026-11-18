import { registryDb } from './registry-db.js';
import { getSyncState, trademarkCounts } from './registry.js';
import { nameKeys, compareNames, trigrams } from './similarity.js';
import { SIM_SOURCE } from './sync-sim.js';

/**
 * Badanie nazwy: kandydaci z indeksu podobieństwa, punktacja i werdykt w trzech poziomach.
 *
 * Ryzyko znaku = podobieństwo nazwy × branża (klasy) × status × rodzaj znaku. Werdykt wynika
 * z najwyżej ocenionego znaku, a każdy znak ma powody opisane prostym językiem.
 * Progi i wagi są robocze — do strojenia z rzecznikiem i na uwagach testerów (plan, sekcja 1).
 */

const CANDIDATES = 2000;
export const THRESHOLDS = { high: 0.85, warning: 0.75 };

export const REASONS = {
  identical: 'identyczna nazwa',
  words: 'te same słowa w innej kolejności',
  contains: 'zawiera Twoją nazwę albo jej część',
  word: 'wspólne słowo',
  sound: 'brzmi podobnie',
  spelling: 'podobna pisownia',
  sameClass: 'ta sama branża',
  relatedClass: 'pokrewna branża',
  otherClass: 'inna branża',
  pending: 'zgłoszenie w toku — może zostać zarejestrowane',
  inactive: 'nieaktywny — zwykle nie blokuje',
  figurative: 'znak graficzny z napisem',
};

/* -------------------------------------------------------------- klasy */

// Pokrewne klasy nicejskie (ręcznie, do weryfikacji z rzecznikiem): grupy, w których towary
// i usługi często się spotykają w sporach o znaki.
const RELATED_GROUPS = [
  [9, 38, 42], // oprogramowanie, telekomunikacja, usługi IT
  [14, 18, 25, 26], // moda: biżuteria, torby, odzież, pasmanteria
  [3, 5, 44], // kosmetyki, leki, usługi medyczne i kosmetyczne
  [3, 21], // kosmetyki i przybory toaletowe
  [5, 10, 44], // zdrowie
  [29, 30, 31, 43], // żywność i gastronomia
  [32, 33, 43], // napoje i gastronomia
  [16, 41], // wydawnictwa i edukacja
  [28, 41], // zabawki, sport i rozrywka
  [12, 37, 39], // pojazdy, naprawy, transport
  [11, 20, 21, 24, 27], // dom i wnętrza
  [36, 45], // finanse i usługi prawne
  [39, 43], // podróże i hotele
];
const RELATED = new Map();
for (const group of RELATED_GROUPS) {
  for (const a of group) for (const b of group) if (a !== b) {
    if (!RELATED.has(a)) RELATED.set(a, new Set());
    RELATED.get(a).add(b);
  }
}

// UPRP podaje czasem klasę „0” (brak klasyfikacji) — pomijamy ją.
export const parseClasses = (column) => (column || '').split(',').map(Number).filter((c) => c >= 1 && c <= 45);

/** Waga branży: ta sama klasa 1, pokrewna 0,6, handel (35) wobec towarów 0,4, inna 0,15. */
export function classFactor(wanted, theirs) {
  if (!wanted.length || !theirs.length) return { factor: 1, reason: null, common: [] };
  const common = wanted.filter((c) => theirs.includes(c));
  if (common.length) return { factor: 1, reason: 'sameClass', common };
  const related = wanted.filter((c) => theirs.some((t) => RELATED.get(c)?.has(t)));
  if (related.length) return { factor: 0.6, reason: 'relatedClass', common: [] };
  const goods = (list) => list.some((c) => c <= 34);
  if ((wanted.includes(35) && goods(theirs)) || (theirs.includes(35) && goods(wanted))) {
    return { factor: 0.4, reason: 'relatedClass', common: [] };
  }
  return { factor: 0.15, reason: 'otherClass', common: [] };
}

/* ------------------------------------------------------------- status */

const PENDING = new Set([
  'APPLICATION_PUBLISHED', 'OPPOSITION_PENDING', 'UNDER_EXAMINATION', 'RECEIVED', 'ACCEPTED',
  'REGISTRATION_PENDING', 'APPEALED',
  'Zgłoszenie ujawnione', 'Zgłoszenie opublikowane', 'Okres sprzeciwowy', 'Postępowanie w sprawie sprzeciwu w toku',
  'Postępowanie zgłoszeniowe w toku ( po okresie sprzeciwowym)',
]);
const INACTIVE = new Set([
  'REFUSED', 'WITHDRAWN', 'SURRENDERED', 'CANCELLED', 'EXPIRED', 'REMOVED_FROM_REGISTER',
  'Wygaśnięcie prawa ochronnego', 'Umorzenie postępowania', 'Wygaśnięcie decyzji warunkowej', 'Odmowa',
  'Unieważnienie prawa ochronnego', 'Umorzenie', 'Zgłoszenie uznane za niebyłe', 'Wygaśnięcie prawa wyłącznego (nieprawomocne)',
]);

/**
 * Stan znaku dla oceny ryzyka. Zarejestrowany po dacie wygaśnięcia traktujemy jak wygasły
 * (rejestr bywa aktualizowany z opóźnieniem).
 */
export function statusInfo(status, expiryDate, today = new Date().toISOString().slice(0, 10)) {
  if (INACTIVE.has(status) || (expiryDate && expiryDate < today)) return { state: 'inactive', factor: 0.1 };
  if (PENDING.has(status)) return { state: 'pending', factor: 0.9 };
  if (status === 'REGISTERED' || status === 'CANCELLATION_PENDING' || status === 'Udzielenie prawa') {
    return { state: 'registered', factor: 1 };
  }
  return { state: 'unknown', factor: 0.8 };
}

/** Rodzaj znaku: słowny 1, graficzny z napisem 0,85 (EUIPO: FIGURATIVE; UPRP: bez „Word”). */
export function featureFactor(feature) {
  if (!feature || /word/i.test(feature)) return 1;
  return 0.85;
}

/* ---------------------------------------------------------- kandydaci */

const ftsQuery = registryDb.prepare(`
  SELECT rowid AS id FROM trademark_sim WHERE trademark_sim MATCH ? ORDER BY rank LIMIT ?
`);
const shortQuery = registryDb.prepare(`
  SELECT id FROM trademark WHERE name_norm = ? LIMIT ?
`);

const orTerms = (column, text) => {
  const grams = trigrams(text);
  return grams.length ? `${column} : (${grams.map((g) => `"${g}"`).join(' OR ')})` : null;
};

/** Identyfikatory znaków podobnych do nazwy (trigramy nazwy sklejonej i kluczy fonetycznych). */
export function candidateIds(keys, limit = CANDIDATES) {
  const parts = [orTerms('compact', keys.compact), orTerms('pl', keys.pl), orTerms('en', keys.en)].filter(Boolean);
  const ids = new Set();
  if (parts.length) for (const r of ftsQuery.all(parts.join(' OR '), limit)) ids.add(r.id);
  if (keys.compact.length < 3) for (const r of shortQuery.all(keys.name, limit)) ids.add(r.id);
  return [...ids];
}

function loadTrademarks(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    out.push(...registryDb.prepare(`
      SELECT id, source, number, name, mark_feature, status, nice_classes, applicants,
             application_date, registration_date, expiry_date
      FROM trademark WHERE id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk));
  }
  return out;
}

/* --------------------------------------------------------------- wynik */

const VERDICTS = {
  high: {
    label: 'Wysokie ryzyko',
    text: 'Bardzo podobna nazwa jest już chroniona w Twojej branży. Używanie jej może skończyć się sporem.',
  },
  warning: {
    label: 'Uwaga',
    text: 'Są podobne nazwy. Warto przemyśleć nazwę lub skonsultować ją przed zgłoszeniem.',
  },
  low: {
    label: 'Niskie ryzyko',
    text: 'Nie widzimy poważnych przeszkód. To dobry znak, ale nie gwarancja.',
  },
};

export function verdictFor(topRisk) {
  const level = topRisk >= THRESHOLDS.high ? 'high' : topRisk >= THRESHOLDS.warning ? 'warning' : 'low';
  return { level, ...VERDICTS[level] };
}

/** Ocena jednego znaku wobec badanej nazwy. */
export function scoreTrademark(keys, classes, tm, today) {
  const name = compareNames(keys, nameKeys(tm.name));
  const theirClasses = parseClasses(tm.nice_classes);
  const cls = classFactor(classes, theirClasses);
  const st = statusInfo(tm.status, tm.expiry_date, today);
  const feature = featureFactor(tm.mark_feature);
  const risk = name.score * cls.factor * st.factor * feature;

  const reasons = [...name.reasons];
  if (cls.reason) reasons.push(cls.reason);
  if (st.state === 'pending' || st.state === 'inactive') reasons.push(st.state);
  if (feature < 1) reasons.push('figurative');

  return {
    source: tm.source,
    number: tm.number,
    name: tm.name,
    status: tm.status,
    state: st.state,
    markFeature: tm.mark_feature,
    niceClasses: theirClasses,
    commonClasses: cls.common,
    applicants: JSON.parse(tm.applicants || '[]'),
    applicationDate: tm.application_date,
    expiryDate: tm.expiry_date,
    nameScore: Math.round(name.score * 100) / 100,
    risk: Math.round(risk * 100) / 100,
    reasons: reasons.map((code) => ({ code, text: REASONS[code] })),
  };
}

/**
 * Badanie nazwy w lokalnej kopii rejestrów.
 * @param {string} rawName
 * @param {{ classes?: number[], limit?: number, today?: string }} opts
 */
export function examineName(rawName, { classes = [], limit = 30, today } = {}) {
  const keys = nameKeys(rawName);
  if (!keys.compact) return null;
  const wanted = [...new Set(classes.map(Number).filter((c) => Number.isInteger(c) && c >= 1 && c <= 45))];

  const ids = candidateIds(keys);
  const scored = loadTrademarks(ids)
    .filter((tm) => tm.name)
    .map((tm) => scoreTrademark(keys, wanted, tm, today))
    .filter((m) => m.nameScore >= 0.6)
    .sort((a, b) => b.risk - a.risk || b.nameScore - a.nameScore);

  const top = scored[0]?.risk ?? 0;
  const sim = getSyncState(SIM_SOURCE);
  return {
    name: rawName,
    normalized: keys.name,
    classes: wanted,
    verdict: { ...verdictFor(top), topRisk: top, classesGiven: wanted.length > 0 },
    groups: {
      main: scored.filter((m) => m.state !== 'inactive' && m.risk >= 0.3).length,
      inactive: scored.filter((m) => m.state === 'inactive').length,
    },
    matches: scored.slice(0, limit),
    coverage: {
      registry: trademarkCounts(),
      candidates: ids.length,
      similar: scored.length,
      indexComplete: sim?.phase === 'done',
    },
  };
}
