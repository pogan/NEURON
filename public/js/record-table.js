/* NEURON — czytelna tabela rekordu EUIPO (współdzielona: wyszukiwarki i alerty) */

// Wersję (`?v=`) przenosimy z URL-a tego modułu na import zależności.
const { escapeHtml } = await import('./app.js' + new URL(import.meta.url).search);

/** Polskie etykiety pól obu API; brakujące nazwy rozbijamy z camelCase. */
const LABELS = {
  applicationNumber: 'Numer zgłoszenia', designNumber: 'Numer wzoru',
  applicantReference: 'Referencja zgłaszającego', applicationLanguage: 'Język zgłoszenia',
  secondLanguage: 'Drugi język', markKind: 'Rodzaj znaku', markFeature: 'Charakter znaku',
  markBasis: 'Podstawa znaku', wordMarkSpecification: 'Element słowny', verbalElement: 'Element słowny',
  markImage: 'Obraz znaku', markSound: 'Dźwięk', markVideo: 'Wideo', markModel: 'Model 3D',
  imageFormat: 'Format obrazu', soundFormat: 'Format dźwięku', videoFormat: 'Format wideo',
  modelFormat: 'Format modelu', viennaClasses: 'Klasy wiedeńskie',
  applicants: 'Zgłaszający', representatives: 'Pełnomocnicy', designers: 'Projektanci',
  applicationDate: 'Data zgłoszenia', receiptDate: 'Data wpływu', registrationDate: 'Data rejestracji',
  designationDate: 'Data desygnacji', publicationDate: 'Data publikacji', expiryDate: 'Data wygaśnięcia',
  effectiveDate: 'Data skuteczności', statusDate: 'Data statusu', status: 'Status',
  renewalStatus: 'Status przedłużenia', description: 'Opis', disclaimer: 'Zastrzeżenie',
  goodsAndServices: 'Towary i usługi', niceClasses: 'Klasy nicejskie', classNumber: 'Klasa',
  terms: 'Terminy', language: 'Język', languageCode: 'Język',
  locarnoClasses: 'Klasy lokarneńskie', locarnoClassification: 'Klasyfikacja lokarneńska',
  productIndications: 'Wskazania produktu', indications: 'Wskazania',
  views: 'Widoki', order: 'Nr', model: 'Model 3D', models: 'Modele 3D', videos: 'Wideo',
  designRepresentationMeans: 'Sposób przedstawienia',
  priorities: 'Pierwszeństwa', seniorities: 'Starszeństwa', exhibitionPriorities: 'Pierwszeństwa wystawowe',
  oppositions: 'Sprzeciwy', cancellations: 'Unieważnienia', appeals: 'Odwołania',
  records: 'Wpisy do rejestru', publications: 'Publikacje', decisions: 'Decyzje',
  inspectionRequests: 'Wnioski o wgląd', internationalApplications: 'Zgłoszenia międzynarodowe',
  oppositionPeriodStartDate: 'Początek okresu sprzeciwu', oppositionPeriodEndDate: 'Koniec okresu sprzeciwu',
  tradeDistinctivenessIndicator: 'Wtórna zdolność odróżniająca',
  fastTrackIndicator: 'Fast Track', fastTrackOnReceptionIndicator: 'Fast Track przy wpływie',
  publicationDefermentIndicator: 'Odroczenie publikacji', defermentExpirationDate: 'Koniec odroczenia',
  name: 'Nazwa', identifier: 'Identyfikator', office: 'Urząd', country: 'Kraj',
  bulletinNumber: 'Biuletyn', publicationSection: 'Sekcja', recordNumber: 'Numer wpisu',
  recordKind: 'Rodzaj wpisu', partialIndicator: 'Częściowe', kind: 'Rodzaj',
  oppositionNumber: 'Numer sprzeciwu', cancellationNumber: 'Numer unieważnienia',
  appealNumber: 'Numer odwołania', subclass: 'Podklasa', classNumbers: 'Klasy',
};

/** Wartości słownikowe warte przetłumaczenia — reszta zostaje w oryginale. */
const VALUES = {
  WORD: 'słowny', FIGURATIVE: 'graficzny', SHAPE_3D: 'przestrzenny', COLOUR: 'kolorystyczny',
  SOUND: 'dźwiękowy', HOLOGRAM: 'hologram', OLFACTORY: 'zapachowy', POSITION: 'pozycyjny',
  PATTERN: 'wzór', MOTION: 'ruchomy', MULTIMEDIA: 'multimedialny', OTHER: 'inny',
  INDIVIDUAL: 'indywidualny', EU_COLLECTIVE: 'wspólny UE', EU_CERTIFICATION: 'certyfikujący UE',
  EU_TRADEMARK: 'znak UE', INTERNATIONAL_TRADEMARK: 'znak międzynarodowy',
  REGISTERED: 'zarejestrowany', EXPIRED: 'wygasły', WITHDRAWN: 'wycofany', REFUSED: 'odrzucony',
  CANCELLED: 'unieważniony', SURRENDERED: 'zrzeczony', RECEIVED: 'przyjęty',
  UNDER_EXAMINATION: 'w trakcie badania', APPLICATION_PUBLISHED: 'zgłoszenie opublikowane',
  REGISTRATION_PENDING: 'rejestracja w toku', OPPOSITION_PENDING: 'sprzeciw w toku',
  CANCELLATION_PENDING: 'unieważnienie w toku', APPEALED: 'odwołanie', APPEALABLE: 'podlega odwołaniu',
  REMOVED_FROM_REGISTER: 'usunięty z rejestru', ACCEPTED: 'przyjęty', ACCEPTANCE_PENDING: 'oczekuje na przyjęcie',
  START_OF_OPPOSITION_PERIOD: 'początek okresu sprzeciwu',
  REGISTERED_AND_FULLY_PUBLISHED: 'zarejestrowany i opublikowany',
  REGISTERED_AND_SUBJECT_TO_DEFERMENT: 'zarejestrowany, publikacja odroczona',
  DESIGN_DECLARED_INVALID: 'unieważniony', INVALIDITY_PROCEDURE_PENDING: 'postępowanie o unieważnienie',
  LACK_OF_EFFECTS: 'brak skutków', SPLIT: 'podzielony',
  NOT_TO_BE_RENEWED: 'bez przedłużenia', RENEWAL_PERIOD_OPEN: 'okres przedłużenia otwarty',
  RENEWAL_PERIOD_TO_START: 'okres przedłużenia przed startem', RENEWAL_IN_PROCESS: 'przedłużenie w toku',
  RENEWAL_PROCESS_BLOCKED: 'przedłużenie zablokowane', RENEWAL_PERIOD_LAPSED: 'okres przedłużenia minął',
  INVALID_FOR_RENEWAL: 'nie podlega przedłużeniu',
  STATIC: 'statyczny', VIDEO: 'wideo',
};

function label(key) {
  if (LABELS[key]) return LABELS[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Znacznik dla wartości, które są już gotowym HTML-em — nie escapujemy ich ponownie. */
const asHtml = (html) => ({ __html: html });

function formatScalar(value) {
  if (value && value.__html !== undefined) return value.__html || '—';
  if (Array.isArray(value)) return value.map(formatScalar).join(', ') || '—';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (isDate(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }
  if (typeof value === 'string' && VALUES[value]) {
    return `${VALUES[value]} <span class="text-secondary small">(${escapeHtml(value)})</span>`;
  }
  return escapeHtml(value);
}

const isScalar = (v) => v === null || typeof v !== 'object';

/** Obiekt o jednym polu skalarnym spłaszczamy do samej wartości (np. wordMarkSpecification). */
function flattenSingle(value) {
  if (value && !Array.isArray(value) && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && isScalar(value[keys[0]])) return value[keys[0]];
  }
  return value;
}

function scalarTable(entries) {
  const rows = entries.map(([key, value]) =>
    `<tr><th scope="row">${escapeHtml(label(key))}</th><td>${formatScalar(value)}</td></tr>`
  ).join('');
  return `<table class="table table-sm nrn-record-table mb-0"><tbody>${rows}</tbody></table>`;
}

/** Tablica obiektów → tabela z kolumnami z sumy kluczy. */
function objectArrayTable(items) {
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const head = columns.map((c) => `<th>${escapeHtml(label(c))}</th>`).join('');
  const body = items.map((item) => {
    const cells = columns.map((c) => {
      const value = flattenSingle(item[c]);
      if (isScalar(value)) return `<td>${formatScalar(value)}</td>`;
      if (Array.isArray(value)) {
        if (value.every(isScalar)) return `<td>${value.map(formatScalar).join(', ') || '—'}</td>`;
        // np. goodsAndServices → description[{language, terms}]
        return `<td>${value.map((entry) => nestedSummary(entry)).join('<br>')}</td>`;
      }
      return `<td>${nestedSummary(value)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="table-responsive"><table class="table table-sm nrn-record-table mb-0">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Skrótowe przedstawienie zagnieżdżonego obiektu w komórce tabeli. */
function nestedSummary(value) {
  if (isScalar(value)) return formatScalar(value);
  if (Array.isArray(value)) return value.map(nestedSummary).join(', ');
  return Object.entries(value)
    .map(([k, v]) => {
      const inner = Array.isArray(v) && v.every(isScalar)
        ? v.map(formatScalar).join(', ')
        : nestedSummary(v);
      return `<span class="text-secondary">${escapeHtml(label(k))}:</span> ${inner}`;
    })
    .join(' · ');
}

function section(title, count, html) {
  const badge = count ? ` <span class="nrn-chip">${count}</span>` : '';
  return `<section class="nrn-record-section">
    <h3 class="nrn-record-heading">${escapeHtml(title)}${badge}</h3>
    ${html}
  </section>`;
}

function renderRecordTable(container, record) {
  if (!record || typeof record !== 'object') {
    container.innerHTML = '<p class="text-secondary mb-0">Brak danych.</p>';
    return;
  }

  const scalars = [];
  const sections = [];

  for (const [key, raw] of Object.entries(record)) {
    const value = flattenSingle(raw);

    if (isScalar(value)) {
      scalars.push([key, value]);
      continue;
    }

    if (Array.isArray(value)) {
      if (!value.length) {
        scalars.push([key, null]);
      } else if (value.every(isScalar)) {
        scalars.push([key, value]);
      } else {
        sections.push(section(label(key), value.length, objectArrayTable(value)));
      }
      continue;
    }

    // zwykły obiekt → tabela klucz/wartość ze spłaszczonymi wartościami
    const entries = Object.entries(value).map(([k, v]) => [
      k,
      isScalar(v) || (Array.isArray(v) && v.every(isScalar)) ? v : asHtml(nestedSummary(v)),
    ]);
    sections.push(section(label(key), 0, scalarTable(entries)));
  }

  container.innerHTML =
    (scalars.length ? section('Dane podstawowe', 0, scalarTable(scalars)) : '') +
    sections.join('');
}

export { renderRecordTable, LABELS, VALUES, label, formatScalar };
