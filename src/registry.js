import { registryDb } from './registry-db.js';
import { normalizeName } from './names.js';

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
  `),
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
  statements.upsert.run({
    ...tm,
    name_norm: normalizeName(tm.name),
    nice_classes: niceColumn(tm.nice_classes),
    applicants: JSON.stringify(tm.applicants || []),
    data: JSON.stringify(tm.data),
  });
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
