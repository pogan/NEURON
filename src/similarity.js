import { normalizeName } from './names.js';

/**
 * Podobieństwo nazw: klucze do wyszukiwania kandydatów i miary podobieństwa.
 * Wszystko działa na nazwach po normalizeName (wielkie litery, bez diakrytyków, spacje między słowami).
 */

const CYRILLIC = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'J', К: 'K', Л: 'L',
  М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'CH', Ш: 'SH',
  Щ: 'SHCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'JU', Я: 'JA', І: 'I', Ї: 'JI', Є: 'JE', Ґ: 'G',
};
const GREEK = {
  Α: 'A', Β: 'V', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'TH', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N',
  Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'CH', Ψ: 'PS', Ω: 'O',
};

// Dopiski, które nie odróżniają marek: formy prawne i ogólne słowa. Usuwane, jeśli coś po nich zostaje.
const LEGAL_PHRASES = [
  /\bSPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA\b/g, /\bSP Z O O\b/g, /\bSPOLKA AKCYJNA\b/g,
  /\bSPOLKA KOMANDYTOWA\b/g, /\bSPOLKA JAWNA\b/g, /\bSP K\b/g, /\bSP J\b/g, /\bS A$/g,
];
const FILLER_WORDS = new Set(['SA', 'LTD', 'LIMITED', 'GMBH', 'INC', 'LLC', 'GROUP', 'POLSKA', 'POLAND', 'THE']);

/** Nazwa do porównań: normalizeName + transliteracja cyrylicy i greki, bez form prawnych i ogólnych słów. */
export function simName(value) {
  let s = normalizeName(String(value ?? '').toUpperCase().replace(/[Ѐ-ӿͰ-Ͽ]/g, (ch) => CYRILLIC[ch] ?? GREEK[ch] ?? ch));
  for (const re of LEGAL_PHRASES) s = s.replace(re, ' ');
  const words = s.split(' ').filter(Boolean);
  const kept = words.filter((w) => !FILLER_WORDS.has(w));
  return (kept.length ? kept : words).join(' ');
}

/** Wariant sklejony: „NEURO LAB” = „NEUROLAB”. */
export const compact = (name) => name.replace(/ /g, '');

const collapse = (s) => s.replace(/(.)\1+/g, '$1');

/**
 * Klucz fonetyczny dla polskiej wymowy: c/k/q, w/v, ł/l (już w normalizeName), ch/h, rz/ż, y/i, x/ks,
 * ph/f, ubezdźwięcznienie na końcu wyrazu, podwójne litery jako pojedyncze.
 */
export function keyPl(name) {
  const words = name.split(' ').filter(Boolean).map((w) => {
    let s = w
      .replace(/CZ/g, '1').replace(/SZ/g, 'S').replace(/RZ/g, 'Z').replace(/CH/g, 'H').replace(/PH/g, 'F')
      .replace(/TH/g, 'T').replace(/QU/g, 'KW').replace(/CK/g, 'K').replace(/TS/g, 'C').replace(/X/g, 'KS')
      .replace(/Q/g, 'K').replace(/C/g, 'K').replace(/1/g, 'C').replace(/V/g, 'W').replace(/[YJ]/g, 'I');
    s = s.replace(/B$/, 'P').replace(/D$/, 'T').replace(/G$/, 'K').replace(/W$/, 'F').replace(/Z$/, 'S');
    return s;
  });
  return collapse(words.join(''));
}

/** Uproszczony Metaphone dla angielskiej wymowy (bez samogłosek poza pierwszą literą). */
export function keyEn(name) {
  let s = compact(name).replace(/[^A-Z]/g, '');
  if (!s) return '';
  s = s.replace(/^(KN|GN|PN|WR)/, (m) => m[1]).replace(/^X/, 'S').replace(/^WH/, 'W');
  s = s
    .replace(/DG/g, 'J').replace(/PH/g, 'F').replace(/SH/g, 'X').replace(/TH/g, '0').replace(/CH/g, 'X')
    .replace(/CK/g, 'K').replace(/GH/g, '').replace(/C(?=[EIY])/g, 'S').replace(/C/g, 'K')
    .replace(/G(?=[EIY])/g, 'J').replace(/G/g, 'K').replace(/Q/g, 'K').replace(/X/g, 'KS').replace(/Z/g, 'S')
    .replace(/V/g, 'F').replace(/D/g, 'T');
  const first = s[0];
  const rest = s.slice(1).replace(/[AEIOUHWY]/g, '');
  return collapse(first + rest);
}

/** Szkielet spółgłoskowy (dla krótkich nazw): „KODAK” → „KDK”. */
export const skeleton = (name) => collapse(compact(name).replace(/[AEIOUY]/g, ''));

/** Odległość Damerau-Levenshteina (wariant OSA). */
export function damerau(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Podobieństwo 0–1 z odległości edycyjnej. */
export function editSimilarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - damerau(a, b) / max : 1;
}

export function jaroWinkler(a, b) {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j += 1) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches += 1;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i += 1) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Wszystkie klucze nazwy naraz (do indeksu i do zapytania). */
export function nameKeys(raw) {
  const name = simName(raw);
  return { name, compact: compact(name), pl: keyPl(name), en: keyEn(name), skeleton: skeleton(name) };
}

/** Trigramy tekstu (do zapytania OR w indeksie FTS5 trigram). */
export function trigrams(s) {
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i += 1) out.add(s.slice(i, i + 3));
  return [...out];
}

/**
 * Podobieństwo dwóch nazw z uzasadnieniem.
 * @returns {{ score: number, reasons: string[] }} score 0–1; reasons: kody powodów (patrz REASONS w badanie.js)
 */
export function compareNames(q, c) {
  if (!q.compact || !c.compact) return { score: 0, reasons: [] };
  if (q.compact === c.compact) return { score: 1, reasons: ['identical'] };

  // Jaro-Winkler mocno nagradza wspólny początek, więc liczy się z wagą 0,85 (inaczej „MARKOSKOP” ≈ „MARKOVIO”).
  const spelling = Math.max(jaroWinkler(q.compact, c.compact) * 0.85, editSimilarity(q.compact, c.compact));
  const sound = Math.max(
    q.pl && c.pl ? (q.pl === c.pl ? 0.97 : editSimilarity(q.pl, c.pl) * 0.95) : 0,
    // Angielski klucz gubi samogłoski, więc sam nie wystarcza przy różnej pisowni („SPRAWDZ NAZWE” ≈ „SPORTSENSE”).
    q.en.length >= 3 && q.en === c.en && editSimilarity(q.compact, c.compact) >= 0.6 ? 0.85 : 0,
  );
  // Te same słowa w innej kolejności: „MLECZNA DROGA” i „DROGA MLECZNA”.
  const sortedWords = (n) => n.name.split(' ').sort().join(' ');
  const sameWords = q.name.includes(' ') && sortedWords(q) === sortedWords(c) ? 0.92 : 0;

  // Zawieranie: cała nazwa jako osobne słowo albo fragment dłuższej nazwy (tylko od 4 znaków).
  let contains = 0;
  const [shorter, longer] = q.compact.length <= c.compact.length ? [q, c] : [c, q];
  if (shorter.compact.length >= 4 && longer.compact.includes(shorter.compact)) {
    // Całe słowa („TWOJA MLECZNA DROGA”) liczą się mocniej niż fragment wyrazu („ARKOS” w „MARKOSKOP”).
    const asWord = ` ${longer.name} `.includes(` ${shorter.name} `);
    const ratio = shorter.compact.length / longer.compact.length;
    contains = asWord ? 0.85 + 0.1 * ratio : 0.6 + 0.2 * ratio;
  } else {
    const qWords = q.name.split(' ').filter((w) => w.length >= 4);
    const cWords = new Set(c.name.split(' '));
    // Jedno wspólne słowo (np. „ŚWIECA” w klasie świec) bywa opisowe — samo nie daje ostrzeżenia.
    if (qWords.some((w) => cWords.has(w))) contains = 0.6;
  }

  const score = Math.min(0.99, Math.max(spelling, sound, contains, sameWords));
  const reasons = [];
  if (sameWords && sameWords === score) reasons.push('words');
  if (contains > 0.6 && contains === score) reasons.push('contains');
  if (contains === 0.6 && contains === score) reasons.push('word');
  if (sound >= 0.85 && sound >= spelling) reasons.push('sound');
  if (spelling >= 0.75) reasons.push('spelling');
  if (!reasons.length) reasons.push(score === contains ? 'word' : score === sound ? 'sound' : 'spelling');
  return { score, reasons };
}
