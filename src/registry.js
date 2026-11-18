import { registryDb } from './registry-db.js';
import { normalizeName } from './names.js';
import { nameKeys } from './similarity.js';

/**
 * Zapis i odczyt lokalnej kopii rejestrów (tabele trademark i sync_state w registry.sqlite).
 */

const statements = {
  upsert: registryDb.prepare(`
    INSERT INTO trademark (source, number, name, name_norm, mark_feature, mark_kind, status, nice_classes,
                           applicants, application_date, registration_date, expiry_date, data)
    VALUES (@source, @number, @name, @name_norm, @mark_feature, @mark_kind, @status, @nice_classes,
            @applicants, @application_date, @registration_date, @expiry_date, @data)
    ON CONFLICT (source, number) DO UPDATE SET
      name = excluded.name, name_norm = excluded.name_norm, mark_feature = excluded.mark_feature,
      mark_kind = excluded.mark_kind, status = excluded.status, nice_classes = excluded.nice_classes,
      applicants = excluded.applicants, application_date = excluded.application_date,
      registration_date = excluded.registration_date, expiry_date = excluded.expiry_date,
      data = excluded.data, synced_at = datetime('now')
    RETURNING id
  `),
  simDelete: registryDb.prepare(`DELETE FROM trademark_sim WHERE rowid = ?`),
  simInsert: registryDb.prepare(`INSERT INTO trademark_sim (rowid, compact, pl, en) VALUES (?, ?, ?, ?)`),
  getState: registryDb.prepare(`SELECT * FROM sync_state WHERE source = ?`),
  setState: registryDb.prepare(`
    INSERT INTO sync_state (source, phase, cursor, records, last_sync_at, last_error, updated_at)
    VALUES (@source, @phase, @cursor, @records, @last_sync_at, @last_error, datetime('now'))
    ON CONFLICT (source) DO UPDATE SET
      phase = excluded.phase, cursor = excluded.cursor, records = excluded.records,
      last_sync_at = excluded.last_sync_at, last_error = excluded.last_error, updated_at = datetime('now')
  `),
  count: registryDb.prepare(`SELECT source, COUNT(*) AS n FROM trademark GROUP BY source`),
  fragment: registryDb.prepare(`
    SELECT t.* FROM trademark_fts f JOIN trademark t ON t.id = f.rowid
    WHERE trademark_fts MATCH ? ORDER BY length(t.name_norm), t.application_date DESC LIMIT ?
  `),
  exact: registryDb.prepare(`
    SELECT * FROM trademark WHERE name_norm = ? ORDER BY application_date DESC LIMIT ?
  `),
};

/** Lista klas nicejskich w formacie kolumny nice_classes: ',25,35,'. */
export function niceColumn(classes) {
  const list = [...new Set((classes || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  return list.length ? `,${list.join(',')},` : null;
}

/** @param {object} tm znak w formacie wspólnym dla rejestrów (patrz euipoToTrademark) */
export function upsertTrademark(tm) {
  const { id } = statements.upsert.get({
    ...tm,
    name_norm: normalizeName(tm.name),
    nice_classes: niceColumn(tm.nice_classes),
    applicants: JSON.stringify(tm.applicants || []),
    data: JSON.stringify(tm.data),
  });
  indexSimilarity(id, tm.name);
}

/** Wpis znaku w indeksie podobieństwa (znaki bez elementu słownego pomijamy). */
export function indexSimilarity(id, name) {
  statements.simDelete.run(id);
  const keys = nameKeys(name);
  if (keys.compact) statements.simInsert.run(id, keys.compact, keys.pl, keys.en);
}

export const upsertTrademarks = registryDb.transaction((list) => {
  for (const tm of list) upsertTrademark(tm);
});

/** Rekord listy wyników EUIPO trademark-search → wspólny format. */
export function euipoToTrademark(item) {
  return {
    source: 'euipo',
    number: item.applicationNumber,
    name: item.wordMarkSpecification?.verbalElement ?? null,
    mark_feature: item.markFeature ?? null,
    mark_kind: item.markKind ?? null,
    status: item.status ?? null,
    nice_classes: item.niceClasses || [],
    applicants: (item.applicants || []).map((a) => ({ name: a.name ?? null, country: a.office ?? null })),
    application_date: item.applicationDate ?? null,
    registration_date: item.registrationDate ?? null,
    expiry_date: item.expiryDate ?? null,
    data: item,
  };
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v && typeof v === 'object' ? v['#text'] : v) ?? null;

/**
 * Znak UPRP w formacie WIPO ST.66 (element <TradeMark> po parseXml z uprp.js) → wspólny format.
 * Bez opisów towarów i usług — zajmują większość rekordu, a pełny rekord da się pobrać z /pwp/{numer}.
 */
export function uprpToTrademark(tm) {
  const classes = asArray(tm.GoodsServicesDetails?.GoodsServices?.ClassDescriptionDetails?.ClassDescription);
  const applicants = asArray(tm.ApplicantDetails?.Applicant).map((a) => {
    const fna = a.ApplicantAddressBook?.FormattedNameAddress;
    const lines = asArray(fna?.Name?.FreeFormatName?.FreeFormatNameDetails?.FreeFormatNameLine).map(text);
    return { name: lines.filter(Boolean).join(' ') || null, country: fna?.Address?.AddressCountryCode ?? null };
  });
  const data = {
    ...tm,
    GoodsServicesDetails: undefined,
    niceClasses: classes.map((c) => Number(c.ClassNumber)).filter(Number.isInteger),
  };
  return {
    source: 'uprp',
    number: tm.ApplicationNumber,
    name: text(asArray(tm.WordMarkSpecification?.MarkVerbalElementText)[0]),
    mark_feature: tm.MarkFeature ?? null,
    mark_kind: tm.KindMark ?? null,
    status: tm.MarkCurrentStatusCode ?? null,
    nice_classes: data.niceClasses,
    applicants,
    application_date: tm.ApplicationDate ?? null,
    registration_date: tm.RegistrationDate ?? null,
    expiry_date: tm.ExpiryDate ?? null,
    data,
  };
}

/** Znaki z odpowiedzi UPRP (wyniki wyszukiwania albo dziennik zmian, w którym są też patenty i wzory). */
export function uprpTrademarksFrom(parsed) {
  return asArray(parsed?.root?._embedded?.Transaction)
    .map((t) => t?.TradeMarkTransactionBody?.TransactionContentDetails?.TransactionData?.TradeMarkDetails?.TradeMark)
    .filter((tm) => tm?.ApplicationNumber)
    .map(uprpToTrademark);
}

export function getSyncState(source) {
  const row = statements.getState.get(source);
  return row ? { ...row, cursor: row.cursor ? JSON.parse(row.cursor) : null } : null;
}

export function setSyncState(source, { phase = 'idle', cursor = null, records = 0, lastSyncAt = null, lastError = null }) {
  statements.setState.run({
    source,
    phase,
    cursor: cursor === null ? null : JSON.stringify(cursor),
    records,
    last_sync_at: lastSyncAt,
    last_error: lastError,
  });
}

export function trademarkCounts() {
  return Object.fromEntries(statements.count.all().map((r) => [r.source, r.n]));
}

/**
 * Znaki zawierające fragment nazwy (indeks trigramowy, min. 3 znaki po normalizacji)
 * albo — dla krótszych — o identycznej nazwie.
 */
export function findByFragment(name, limit = 50) {
  const norm = normalizeName(name);
  if (!norm) return [];
  if (norm.length < 3) return statements.exact.all(norm, limit);
  // Fraza w cudzysłowie: trigramy muszą wystąpić w tej kolejności (dopasowanie podciągu).
  return statements.fragment.all(`"${norm.replaceAll('"', '')}"`, limit);
}

/* ---------------------------------------------------------------- KRS */

const companyStatements = {
  upsert: registryDb.prepare(`
    INSERT INTO company (krs, register, name, name_norm, legal_form, nip, regon, city, registered_on, last_entry_on, removed)
    VALUES (@krs, @register, @name, @name_norm, @legal_form, @nip, @regon, @city, @registered_on, @last_entry_on, 0)
    ON CONFLICT (krs) DO UPDATE SET
      register = excluded.register, name = excluded.name, name_norm = excluded.name_norm,
      legal_form = excluded.legal_form, nip = excluded.nip, regon = excluded.regon, city = excluded.city,
      registered_on = excluded.registered_on, last_entry_on = excluded.last_entry_on, removed = 0,
      synced_at = datetime('now')
  `),
  removed: registryDb.prepare(`UPDATE company SET removed = 1, synced_at = datetime('now') WHERE krs = ?`),
  count: registryDb.prepare(`SELECT COUNT(*) AS n FROM company WHERE removed = 0`),
  fragment: registryDb.prepare(`
    SELECT c.* FROM company_fts f JOIN company c ON c.id = f.rowid
    WHERE company_fts MATCH ? AND c.removed = 0 ORDER BY length(c.name_norm) LIMIT ?
  `),
  exact: registryDb.prepare(`SELECT * FROM company WHERE name_norm = ? AND removed = 0 LIMIT ?`),
};

/** „08.10.2026” → „2026-10-08”. */
const isoDate = (pl) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(pl || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Odpis aktualny z API KRS (JSON) → wiersz tabeli company. null, gdy odpis nie ma nazwy.
 * Oddziały przedsiębiorców zagranicznych mają dane w danePodmiotuZagranicznego.
 */
export function krsToCompany(odpis) {
  const head = odpis.naglowekA;
  const d1 = odpis.dane?.dzial1 || {};
  const subject = d1.danePodmiotu || d1.danePodmiotuZagranicznego || {};
  if (!subject.nazwa) return null;
  const seat = d1.siedzibaIAdres || d1.siedzibaIAdresPodmiotuZagranicznego;
  return {
    krs: head.numerKRS,
    register: head.rejestr === 'RejS' ? 'S' : 'P',
    name: subject.nazwa,
    legal_form: subject.formaPrawna ?? null,
    nip: subject.identyfikatory?.nip ?? null,
    regon: subject.identyfikatory?.regon ?? null,
    city: seat?.siedziba?.miejscowosc ?? null,
    registered_on: isoDate(head.dataRejestracjiWKRS),
    last_entry_on: isoDate(head.dataOstatniegoWpisu),
  };
}

export function upsertCompany(company) {
  companyStatements.upsert.run({ ...company, name_norm: normalizeName(company.name) });
}

export function markCompanyRemoved(krs) {
  companyStatements.removed.run(krs);
}

export function companyCount() {
  return companyStatements.count.get().n;
}

/** Podmioty z KRS, których nazwa zawiera fragment (jak findByFragment dla znaków). */
export function findCompanies(name, limit = 20) {
  const norm = normalizeName(name);
  if (!norm) return [];
  if (norm.length < 3) return companyStatements.exact.all(norm, limit);
  return companyStatements.fragment.all(`"${norm.replaceAll('"', '')}"`, limit);
}
