/* NEURON — czytelne tabele rekordów UPRP (XML sparsowany do JSON) */

// Wersję (`?v=`) przenosimy z URL-a tego modułu na import zależności.
const { escapeHtml } = await import('./app.js' + new URL(import.meta.url).search);

/** Polskie etykiety najczęstszych węzłów UPRP (ST.96 oraz DTD patentowe). */
const LABELS = {
  // wspólne / znaki towarowe
  ApplicationNumber: 'Numer zgłoszenia', ApplicationDate: 'Data zgłoszenia',
  RegistrationNumber: 'Numer rejestracji', RegistrationDate: 'Data rejestracji',
  ExpiryDate: 'Data wygaśnięcia', PublicationDate: 'Data publikacji',
  MarkVerbalElementText: 'Element słowny', WordMarkSpecification: 'Znak słowny',
  MarkFeature: 'Charakter znaku', MarkCurrentStatusCode: 'Status znaku',
  MarkCurrentStatusDate: 'Data statusu', MarkKindCode: 'Rodzaj znaku',
  MarkImageDetails: 'Obraz znaku', MarkImage: 'Obraz', MarkImageURI: 'Adres obrazu',
  MarkImageFileName: 'Plik obrazu', MarkImageCategory: 'Kategoria obrazu',
  MarkImageColourClaimedText: 'Zastrzeżone kolory', MarkDescriptionText: 'Opis znaku',
  MarkRevelationDate: 'Data ujawnienia znaku', Licence: 'Licencja',
  RemDistraint: 'Zajęcie', RemCivil: 'Egzekucja cywilna', RemRegister: 'Wpisy do rejestru',
  OppositionPeriodStartDate: 'Początek okresu sprzeciwu',
  OppositionPeriodEndDate: 'Koniec okresu sprzeciwu',
  MarkDisclaimerText: 'Zastrzeżenie', TradeMarkDetails: 'Znaki towarowe', TradeMark: 'Znak towarowy',
  GoodsServicesDetails: 'Towary i usługi', GoodsServices: 'Towary i usługi',
  ClassDescriptionDetails: 'Wykaz klas', ClassDescription: 'Klasa',
  ClassNumber: 'Nr klasy', GoodsServicesDescriptionText: 'Wykaz towarów i usług',
  GoodsServicesDescription: 'Wykaz towarów i usług',
  TradeMarkTransactionBody: 'Znak towarowy', DesignTransactionBody: 'Wzór przemysłowy',
  TransactionContentDetails: 'Zawartość transakcji', TransactionData: 'Dane transakcji',
  TransactionIdentifier: 'Identyfikator transakcji', TransactionCode: 'Kod transakcji',
  RequestProducerDateTime: 'Data wygenerowania', RegistrationOfficeCode: 'Urząd rejestrujący',
  ApplicationLanguageCode: 'Język zgłoszenia', LanguageCode: 'Język', languageCode: 'Język',
  KindMark: 'Rodzaj znaku', sequenceNumber: 'Lp.', identifier: 'Identyfikator',
  ApplicantDetails: 'Zgłaszający', Applicant: 'Zgłaszający',
  RepresentativeDetails: 'Pełnomocnicy', Representative: 'Pełnomocnik',
  DesignerDetails: 'Projektanci', Designer: 'Projektant',
  InventorDetails: 'Twórcy', Inventor: 'Twórca',
  PublicationDetails: 'Publikacje', Publication: 'Publikacja',
  PublicationIdentifier: 'Numer publikacji', PublicationSection: 'Sekcja publikacji',
  ApplicantIdentifier: 'Identyfikator zgłaszającego',
  RepresentativeIdentifier: 'Identyfikator pełnomocnika',
  ApplicantSequenceNumber: 'Lp.', RepresentativeSequenceNumber: 'Lp.',
  PriorityDetails: 'Pierwszeństwa', Priority: 'Pierwszeństwo',
  ApplicantAddressBook: 'Dane adresowe', RepresentativeAddressBook: 'Dane adresowe',
  DesignerAddressBook: 'Dane adresowe', Address: 'Adres', AddressCity: 'Miejscowość',
  NamePrefix: 'Tytuł', FirstName: 'Imię', LastName: 'Nazwisko',
  OrganizationName: 'Nazwa organizacji', RepresentativeType: 'Rodzaj pełnomocnictwa',
  PublicationURI: 'Adres publikacji', ApplicationURI: 'Adres zgłoszenia',
  Contact: 'Dane kontaktowe', Name: 'Nazwa', FreeFormatName: 'Nazwa',
  FreeFormatNameDetails: 'Nazwa', FreeFormatNameLine: 'Nazwa',
  PostalAddress: 'Adres', FormattedNameAddress: 'Nazwa i adres',
  AddressCountryCode: 'Kraj', AddressCityName: 'Miasto', AddressPostcode: 'Kod pocztowy',
  AddressLineText: 'Adres', AddressStreet: 'Ulica',
  // wzory przemysłowe
  DesignDetails: 'Wzory przemysłowe', Design: 'Wzór przemysłowy',
  DesignIdentifier: 'Identyfikator wzoru', DesignCurrentStatusCode: 'Status wzoru',
  DesignRepresentationSheetDetails: 'Ilustracje', DesignRepresentationSheet: 'Ilustracja',
  View: 'Widok', ViewIdentifier: 'Nr widoku',
  IndicationProductDetails: 'Określenie produktu', IndicationProduct: 'Produkt',
  ClassificationLocarnoDetails: 'Klasyfikacja lokarneńska',
  // patenty / wzory użytkowe (DTD PL)
  'pl-patent-document': 'Dokument patentowy',
  'pl-office-specific-data': 'Dane urzędowe',
  'bibliographic-data': 'Dane bibliograficzne',
  'invention-title': 'Tytuł wynalazku', 'technical-data': 'Dane techniczne',
  'classification-ipc': 'Klasyfikacja IPC', 'main-classification': 'Klasyfikacja główna',
  'further-classification': 'Klasyfikacja dodatkowa',
  'classification-ipcr': 'Klasyfikacja IPCR', 'classifications-ipcr': 'Klasyfikacja IPCR',
  'ipc-version-indicator': 'Wersja IPC', section: 'Sekcja', class: 'Klasa',
  subclass: 'Podklasa', 'main-group': 'Grupa główna', subgroup: 'Podgrupa',
  'document-id': 'Identyfikator dokumentu', 'other-documents': 'Inne dokumenty',
  date: 'Data', edition: 'Edycja', sequence: 'Lp.', 'rep-type': 'Rodzaj pełnomocnictwa',
  assignees: 'Uprawnieni', assignee: 'Uprawniony', 'name-type': 'Rodzaj podmiotu',
  description: 'Opis', claims: 'Zastrzeżenia', claim: 'Zastrzeżenie',
  'claim-text': 'Treść zastrzeżenia', num: 'Nr',
  'gazette-reference': 'Odesłanie do biuletynu', 'gazette-num': 'Numer biuletynu',
  'dates-of-public-availability': 'Daty udostępnienia',
  'pct-or-regional-filing-data': 'Dane zgłoszenia PCT / regionalnego',
  'pct-or-regional-publishing-data': 'Dane publikacji PCT / regionalnej',
  source: 'Źródło', timestamp: 'Znacznik czasu', 'begin-date': 'Data początkowa',
  'end-date': 'Data końcowa', status: 'Status', 'status-id': 'Kod statusu',
  'status-description': 'Opis statusu', code: 'Kod', 'gazette-uri': 'Adres publikacji',
  'application-reference': 'Zgłoszenie', 'publication-reference': 'Publikacja',
  'priority-claims': 'Pierwszeństwa', 'priority-claim': 'Pierwszeństwo',
  'doc-number': 'Numer dokumentu', 'date-of-grant': 'Data udzielenia',
  'date-publ': 'Data publikacji', 'date-appli': 'Data zgłoszenia',
  extidappli: 'Numer zgłoszenia', extidpatent: 'Numer prawa wyłącznego',
  applicants: 'Zgłaszający', applicant: 'Zgłaszający',
  inventors: 'Twórcy', inventor: 'Twórca',
  agents: 'Pełnomocnicy', agent: 'Pełnomocnik',
  parties: 'Strony', addressbook: 'Dane adresowe', address: 'Adres',
  abstract: 'Skrót opisu', country: 'Kraj', kind: 'Rodzaj', lang: 'Język',
  name: 'Nazwa', orgname: 'Nazwa', 'last-name': 'Nazwisko', 'first-name': 'Imię',
  street: 'Ulica', city: 'Miejscowość', postcode: 'Kod pocztowy', p: 'Treść',
  '#text': 'Wartość',
};

/** Kody statusów i cech, które warto opisać po polsku. */
const VALUES = {
  Word: 'słowny', Figurative: 'graficzny', Combined: 'słowno-graficzny',
  Stylized: 'stylizowany', Sound: 'dźwiękowy', Colour: 'kolorystyczny',
  'Three dimensional': 'przestrzenny', Registered: 'zarejestrowany',
  Filed: 'zgłoszony', Expired: 'wygasły', Withdrawn: 'wycofany', Refused: 'odmowa',
  Ended: 'zakończony', Invalid: 'unieważniony', Pending: 'w toku',
};

const isScalar = (v) => v === null || typeof v !== 'object';
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === null || v === undefined || v === '';

/**
 * Sprowadza drzewo z fast-xml-parser do postaci nadającej się do tabel:
 * atrybuty `@x` tracą prefiks, węzły z samym `#text` stają się wartością,
 * puste gałęzie znikają.
 */
function normalize(node) {
  if (Array.isArray(node)) {
    const items = node.map(normalize).filter((v) => !isEmpty(v));
    return items.length ? items : null;
  }
  if (!isPlainObject(node)) return isEmpty(node) ? null : node;

  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === '#text') return normalize(node['#text']);

  const out = {};
  for (const [rawKey, rawValue] of Object.entries(node)) {
    const value = normalize(rawValue);
    if (isEmpty(value)) continue;
    // `@attr` → `attr`, ale nie nadpisujemy elementu o tej samej nazwie
    const key = rawKey.startsWith('@') && node[rawKey.slice(1)] === undefined
      ? rawKey.slice(1)
      : rawKey;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Etykieta węzła: słownik, a w razie braku — czytelna wersja nazwy XML. */
function label(key) {
  if (LABELS[key]) return LABELS[key];
  const bare = key.replace(/^[@#]/, '').replace(/^[a-z0-9]+:/i, '');
  if (LABELS[bare]) return LABELS[bare];
  return bare
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Daty UPRP bywają zbite (`20250120`) albo w ISO (`2025-01-20`). */
function fmtDate(value) {
  if (/^\d{8}$/.test(value)) return `${value.slice(6)}.${value.slice(4, 6)}.${value.slice(0, 4)}`;
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
}

const isDateKey = (key) => /date|data|expiry|termin/i.test(key);

function formatScalar(value, key = '') {
  if (isEmpty(value)) return '—';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  const text = String(value);
  if (isDateKey(key) && (/^\d{8}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text))) {
    return escapeHtml(fmtDate(text));
  }
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeHtml(text)}" target="_blank" rel="noopener" class="text-break">${escapeHtml(text)}</a>`;
  }
  if (VALUES[text]) {
    return `${escapeHtml(VALUES[text])} <span class="text-secondary small">(${escapeHtml(text)})</span>`;
  }
  return escapeHtml(text);
}

const scalarish = (v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

function formatCell(value, key = '') {
  if (isScalar(value)) return formatScalar(value, key);
  if (Array.isArray(value)) return value.map((v) => formatCell(v, key)).join(', ');
  return inlineSummary(value);
}

/** Zagnieżdżony obiekt w komórce tabeli — jedna linia `klucz: wartość`. */
function inlineSummary(value, depth = 0) {
  if (isScalar(value)) return formatScalar(value);
  if (Array.isArray(value)) return value.map((v) => inlineSummary(v, depth)).join('; ');
  if (depth > 3) return '<span class="text-secondary">…</span>';
  // węzeł tekstowy z atrybutami (np. opis z kodem języka) — treść na pierwszym planie
  if (value['#text'] !== undefined) {
    const rest = Object.entries(value)
      .filter(([k]) => k !== '#text')
      .map(([k, v]) => `${escapeHtml(label(k))}: ${isScalar(v) ? formatScalar(v, k) : inlineSummary(v, depth + 1)}`)
      .join(' · ');
    return `${formatScalar(value['#text'])}${rest ? ` <span class="text-secondary small">(${rest})</span>` : ''}`;
  }
  return Object.entries(value)
    .map(([k, v]) => `<span class="text-secondary">${escapeHtml(label(k))}:</span> ${
      isScalar(v) ? formatScalar(v, k) : inlineSummary(v, depth + 1)}`)
    .join(' · ');
}

/** Tabela klucz → wartość. */
function scalarTable(entries) {
  const rows = entries
    .map(([key, value]) =>
      `<tr><th scope="row">${escapeHtml(label(key))}</th><td>${formatCell(value, key)}</td></tr>`)
    .join('');
  return `<div class="table-responsive"><table class="table table-sm nrn-record-table mb-0">
    <tbody>${rows}</tbody></table></div>`;
}

/** Lista jednorodnych obiektów → tabela z kolumnami z sumy kluczy. */
function objectArrayTable(items) {
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const head = columns.map((c) => `<th>${escapeHtml(label(c))}</th>`).join('');
  const body = items
    .map((item) => `<tr>${columns
      .map((c) => `<td>${item[c] === undefined ? '—' : formatCell(item[c], c)}</td>`)
      .join('')}</tr>`)
    .join('');
  return `<div class="table-responsive"><table class="table table-sm nrn-record-table mb-0">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function section(title, count, html, nested) {
  const badge = count > 1 ? ` <span class="nrn-chip">${count}</span>` : '';
  return `<section class="nrn-record-section${nested ? ' nrn-record-nested' : ''}">
    <h3 class="nrn-record-heading">${escapeHtml(title)}${badge}</h3>
    ${html}
  </section>`;
}

/**
 * XML lubi opakowania w rodzaju `inventors > inventor > addressbook`.
 * Zdejmujemy jednoelementowe warstwy, zostawiając etykietę tej najbardziej zewnętrznej.
 */
function unwrapValue(value) {
  let v = value;
  while (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (keys.length !== 1 || isScalar(v[keys[0]])) break;
    v = v[keys[0]];
  }
  return v;
}

const unwrap = (key, value) => [key, unwrapValue(value)];

/** Obiekt nadaje się na wiersz tabeli, gdy jego pola są proste albo płytkie. */
function tableable(item) {
  return isPlainObject(item)
    && Object.keys(item).length <= 8
    && Object.values(item).every(
      (v) => scalarish(v) || (isPlainObject(v) && Object.values(v).every(scalarish))
    );
}

const MAX_DEPTH = 6;

/** Obiekt → tabela danych podstawowych + sekcje dla gałęzi złożonych. */
function renderObject(record, depth) {
  const scalars = [];
  const parts = [];

  for (const [rawKey, rawValue] of Object.entries(record)) {
    const [key, value] = unwrap(rawKey, rawValue);

    // gałęzie proste, węzły tekstowe z atrybutami (i wszystko poniżej limitu
    // zagnieżdżenia) trafiają do tabeli klucz → wartość
    if (scalarish(value) || depth >= MAX_DEPTH || (isPlainObject(value) && value['#text'] !== undefined)) {
      scalars.push([key, value]);
      continue;
    }

    if (Array.isArray(value)) {
      const items = value.map(unwrapValue);
      const plain = items.filter(isScalar);
      const objects = items.filter(isPlainObject);
      if (plain.length) scalars.push([key, plain]);
      if (!objects.length) continue;

      // jednorodna lista prostych obiektów czyta się najlepiej jako tabela z kolumnami
      let html;
      if (objects.every(tableable)) html = objectArrayTable(objects);
      else if (objects.length === 1) html = renderObject(objects[0], depth + 1);
      else {
        html = objects
          .map((entry, i) => section(`${label(key)} ${i + 1}`, 0, renderObject(entry, depth + 1), true))
          .join('');
      }
      parts.push(section(label(key), objects.length, html, depth > 0));
      continue;
    }

    // obiekt z jednym polem skalarnym to w istocie wartość — nie zasługuje na sekcję
    const inner = Object.keys(value);
    if (inner.length === 1 && isScalar(value[inner[0]])) {
      scalars.push([inner[0] === '#text' ? key : inner[0], value[inner[0]]]);
      continue;
    }

    parts.push(section(label(key), 0, renderObject(value, depth + 1), depth > 0));
  }

  return (scalars.length ? scalarTable(scalars) : '') + parts.join('');
}

/** Renderuje rekord UPRP jako zestaw tabel; zwraca `false`, gdy nie ma czego pokazać. */
function renderUprpRecord(container, record) {
  const data = normalize(record);
  if (data === null) {
    container.innerHTML = '<p class="text-secondary mb-0 small">Brak danych do wyświetlenia.</p>';
    return false;
  }
  if (isScalar(data)) {
    container.innerHTML = `<p class="mb-0">${formatScalar(data)}</p>`;
    return true;
  }
  const unwrapped = unwrapValue(data);
  container.innerHTML = Array.isArray(unwrapped)
    ? unwrapped
      .map((entry, i) => section(`Rekord ${i + 1}`, 0, renderObject(unwrapValue(entry), 1), true))
      .join('')
    : renderObject(unwrapped, 0);
  return true;
}

export { renderUprpRecord, normalize, label, formatScalar, LABELS };
