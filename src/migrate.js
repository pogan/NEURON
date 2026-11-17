/**
 * Migracje schematu SQLite oparte na `PRAGMA user_version`.
 * Każda migracja to funkcja (db) => void uruchamiana raz, w transakcji, w kolejności tablicy.
 * Nowe zmiany schematu dopisujemy NA KOŃCU tablicy — nie edytujemy już wdrożonych migracji.
 */
export function migrate(db, migrations) {
  const current = db.pragma('user_version', { simple: true });
  if (current > migrations.length) {
    throw new Error(
      `Baza ${db.name} ma schemat w wersji ${current}, a kod zna tylko ${migrations.length} migracji — starszy kod na nowszej bazie.`
    );
  }
  for (let version = current; version < migrations.length; version += 1) {
    db.transaction(() => {
      migrations[version](db);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  return db.pragma('user_version', { simple: true });
}

export function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
