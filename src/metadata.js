/**
 * Metadane obu API EUIPO — wyciągnięte ze specyfikacji OpenAPI 1.1.0
 * (docs/euipo/trademark-search_1.1.0.json, docs/euipo/design-search_1.1.0.json).
 * Służą do budowania formularzy i walidacji po stronie klienta.
 */

const OPS_TEXT = ['==', '!='];
const OPS_LIST = ['==', '!=', '=in=', '=out='];
const OPS_LIST_ALL = ['==', '!=', '=in=', '=out=', '=all='];
const OPS_DATE = ['==', '!=', '<', '<=', '>', '>='];

export const EU_LANGUAGES = [
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu',
  'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv',
];

const RENEWAL_STATUS = [
  'NOT_TO_BE_RENEWED', 'RENEWAL_PERIOD_TO_START', 'RENEWAL_PERIOD_OPEN',
  'RENEWAL_IN_PROCESS', 'RENEWAL_PROCESS_BLOCKED', 'RENEWAL_PERIOD_LAPSED',
  'INVALID_FOR_RENEWAL',
];

export const TRADEMARK = {
  id: 'trademark',
  label: 'Znaki towarowe',
  base: 'https://api.euipo.europa.eu/trademark-search',
  idField: 'applicationNumber',
  idLabel: 'Numer zgłoszenia',
  idPattern: '^\\d{6,11}$',
  idExample: '018295134',
  fieldsExample: '!(goodsAndServices)',
  queryFields: [
    { name: 'applicationNumber', label: 'Numer zgłoszenia', type: 'text', ops: OPS_LIST },
    { name: 'applicantReference', label: 'Referencja zgłaszającego', type: 'text', ops: OPS_TEXT },
    { name: 'applicationLanguage', label: 'Język zgłoszenia', type: 'enum', ops: OPS_TEXT, values: EU_LANGUAGES },
    { name: 'secondLanguage', label: 'Drugi język', type: 'enum', ops: OPS_TEXT, values: ['de', 'en', 'es', 'fr', 'it'] },
    { name: 'markKind', label: 'Rodzaj znaku', type: 'enum', ops: OPS_LIST, values: ['INDIVIDUAL', 'EU_COLLECTIVE', 'EU_CERTIFICATION'] },
    { name: 'markFeature', label: 'Charakter znaku', type: 'enum', ops: OPS_LIST, values: ['WORD', 'FIGURATIVE', 'SHAPE_3D', 'COLOUR', 'SOUND', 'HOLOGRAM', 'OLFACTORY', 'POSITION', 'PATTERN', 'MOTION', 'MULTIMEDIA', 'OTHER'] },
    { name: 'markBasis', label: 'Podstawa znaku', type: 'enum', ops: OPS_LIST, values: ['EU_TRADEMARK', 'INTERNATIONAL_TRADEMARK'] },
    { name: 'wordMarkSpecification.verbalElement', label: 'Element słowny', type: 'text', ops: OPS_TEXT, hint: 'Wildcard: *Dog*' },
    { name: 'applicants.identifier', label: 'Zgłaszający — ID', type: 'text', ops: OPS_LIST },
    { name: 'applicants.name', label: 'Zgłaszający — nazwa', type: 'text', ops: OPS_LIST },
    { name: 'representatives.identifier', label: 'Pełnomocnik — ID', type: 'text', ops: OPS_LIST },
    { name: 'representatives.name', label: 'Pełnomocnik — nazwa', type: 'text', ops: OPS_LIST },
    { name: 'applicationDate', label: 'Data zgłoszenia', type: 'date', ops: OPS_DATE },
    { name: 'registrationDate', label: 'Data rejestracji', type: 'date', ops: OPS_DATE },
    { name: 'designationDate', label: 'Data desygnacji', type: 'date', ops: OPS_DATE },
    { name: 'expiryDate', label: 'Data wygaśnięcia', type: 'date', ops: OPS_DATE },
    { name: 'status', label: 'Status', type: 'enum', ops: OPS_LIST, values: ['RECEIVED', 'UNDER_EXAMINATION', 'APPLICATION_PUBLISHED', 'REGISTRATION_PENDING', 'REGISTERED', 'WITHDRAWN', 'REFUSED', 'OPPOSITION_PENDING', 'APPEALED', 'CANCELLATION_PENDING', 'CANCELLED', 'SURRENDERED', 'EXPIRED', 'APPEALABLE', 'START_OF_OPPOSITION_PERIOD', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'REMOVED_FROM_REGISTER'] },
    { name: 'statusDate', label: 'Data statusu', type: 'date', ops: OPS_DATE },
    { name: 'publicationDate', label: 'Data publikacji', type: 'date', ops: OPS_DATE },
    { name: 'publicationSection', label: 'Sekcja biuletynu', type: 'text', ops: OPS_LIST_ALL, hint: 'np. C.1.3' },
    { name: 'description', label: 'Opis', type: 'text', ops: OPS_TEXT },
    { name: 'niceClasses', label: 'Klasy nicejskie', type: 'text', ops: OPS_LIST_ALL, hint: '1–45, dla =in=/=all= podaj listę: 25,28,40' },
    { name: 'tradeDistinctivenessIndicator', label: 'Wtórna zdolność odróżniająca', type: 'enum', ops: OPS_TEXT, values: ['true', 'false'] },
    { name: 'oppositionPeriodEndDate', label: 'Koniec okresu sprzeciwu', type: 'date', ops: OPS_DATE },
    { name: 'renewalStatus', label: 'Status przedłużenia', type: 'enum', ops: OPS_LIST, values: RENEWAL_STATUS },
    { name: 'fastTrackIndicator', label: 'Fast Track', type: 'enum', ops: OPS_TEXT, values: ['true', 'false'] },
    { name: 'oppositions.oppositionNumber', label: 'Numer sprzeciwu', type: 'text', ops: OPS_LIST },
    { name: 'cancellations.cancellationNumber', label: 'Numer unieważnienia', type: 'text', ops: OPS_LIST },
    { name: 'appeals.appealNumber', label: 'Numer odwołania', type: 'text', ops: OPS_LIST },
    { name: 'updateDate', label: 'Data aktualizacji', type: 'date', ops: ['<', '<=', '>', '>='] },
  ],
  sortFields: [
    'applicationNumber', 'applicationReference', 'applicationDate', 'designationDate',
    'registrationDate', 'markFeature', 'wordMarkSpecification.verbalElement',
    'updateDate', 'sectionA1PublicationDate',
  ],
  assets: [
    { key: 'image', label: 'Obraz', path: '/image', kind: 'image' },
    { key: 'thumbnail', label: 'Miniatura', path: '/image/thumbnail', kind: 'image' },
    { key: 'sound', label: 'Dźwięk', path: '/sound', kind: 'audio' },
    { key: 'video', label: 'Wideo', path: '/video', kind: 'video' },
    { key: 'model', label: 'Model 3D', path: '/model', kind: 'binary' },
  ],
  queryExamples: [
    { label: 'Zarejestrowane znaki słowne zawierające "NEURON"', value: 'wordMarkSpecification.verbalElement==*NEURON* and status==REGISTERED' },
    { label: 'Klasy nicejskie 25, 28 i 40 + element słowny "Dog"', value: 'niceClasses=all=(25,28,40) and wordMarkSpecification.verbalElement==*Dog* and status==REGISTERED' },
    { label: 'Zgłoszenia od 2023-05-04, figuratywne w klasach 25 i 26 lub słowne poza klasą 40', value: 'applicationDate>=2023-05-04 and ((markFeature==FIGURATIVE and niceClasses=all=(25,26)) or (markFeature==WORD and niceClasses=out=(40)))' },
    { label: 'Otwarty okres przedłużenia dla pełnomocnika 123', value: 'representatives.identifier==123 and renewalStatus==RENEWAL_PERIOD_OPEN' },
  ],
};

export const DESIGN = {
  id: 'design',
  label: 'Wzory przemysłowe',
  base: 'https://api.euipo.europa.eu/design-search',
  idField: 'designNumber',
  idLabel: 'Numer wzoru',
  idPattern: '^\\d{9}-\\d{4}$',
  idExample: '000000013-0001',
  fieldsExample: '!(indications)',
  queryFields: [
    { name: 'designNumber', label: 'Numer wzoru', type: 'text', ops: ['==', '!=', '=in='], hint: 'format 000000013-0001' },
    { name: 'applicantReference', label: 'Referencja zgłaszającego', type: 'text', ops: OPS_TEXT },
    { name: 'verbalElement', label: 'Element słowny', type: 'text', ops: OPS_TEXT, hint: 'Wildcard: *lampa*' },
    { name: 'locarnoClasses', label: 'Klasy lokarneńskie', type: 'text', ops: OPS_LIST_ALL, hint: 'np. 14.04' },
    { name: 'productIndications', label: 'Wskazanie produktu', type: 'text', ops: OPS_LIST_ALL },
    { name: 'applicants.identifier', label: 'Zgłaszający — ID', type: 'text', ops: OPS_LIST },
    { name: 'applicants.name', label: 'Zgłaszający — nazwa', type: 'text', ops: OPS_LIST },
    { name: 'representatives.identifier', label: 'Pełnomocnik — ID', type: 'text', ops: OPS_LIST },
    { name: 'representatives.name', label: 'Pełnomocnik — nazwa', type: 'text', ops: OPS_LIST },
    { name: 'designers.identifier', label: 'Projektant — ID', type: 'text', ops: OPS_LIST },
    { name: 'designers.name', label: 'Projektant — nazwa', type: 'text', ops: OPS_LIST },
    { name: 'applicationDate', label: 'Data zgłoszenia', type: 'date', ops: OPS_DATE },
    { name: 'registrationDate', label: 'Data rejestracji', type: 'date', ops: OPS_DATE },
    { name: 'expiryDate', label: 'Data wygaśnięcia', type: 'date', ops: OPS_DATE },
    { name: 'status', label: 'Status', type: 'enum', ops: OPS_LIST, values: ['REGISTERED_AND_FULLY_PUBLISHED', 'REGISTERED_AND_SUBJECT_TO_DEFERMENT', 'LACK_OF_EFFECTS', 'SURRENDERED', 'INVALIDITY_PROCEDURE_PENDING', 'DESIGN_DECLARED_INVALID', 'EXPIRED', 'REGISTRATION_PENDING', 'REGISTERED', 'RECEIVED', 'UNDER_EXAMINATION', 'APPEALED', 'WITHDRAWN', 'APPEALABLE', 'SPLIT', 'REFUSED'] },
    { name: 'designRepresentationMeans', label: 'Sposób przedstawienia', type: 'enum', ops: OPS_LIST, values: ['STATIC', '3D', 'VIDEO'] },
    { name: 'renewalStatus', label: 'Status przedłużenia', type: 'enum', ops: OPS_LIST, values: RENEWAL_STATUS },
  ],
  sortFields: ['designNumber', 'applicantReference', 'applicationDate', 'registrationDate', 'expiryDate'],
  assets: [
    { key: 'view', label: 'Widok (order 1–10)', path: '/views/{order}', kind: 'image', needsOrder: true },
    { key: 'viewThumbnail', label: 'Miniatura widoku', path: '/views/{order}/thumbnail', kind: 'image', needsOrder: true },
    { key: 'model', label: 'Model 3D', path: '/model', kind: 'binary' },
    { key: 'video', label: 'Wideo', path: '/video', kind: 'video' },
  ],
  queryExamples: [
    { label: 'Wzory pełnomocnika 28009, zarejestrowane i opublikowane', value: 'representatives.identifier==28009 and status==REGISTERED_AND_FULLY_PUBLISHED' },
    { label: 'Klasa lokarneńska 14.04, zarejestrowane i opublikowane', value: 'locarnoClasses==14.04 and status==REGISTERED_AND_FULLY_PUBLISHED' },
    { label: 'Zgłoszone od 2023-05-04', value: 'applicationDate>=2023-05-04' },
    { label: 'Wzory 3D z elementem słownym', value: 'designRepresentationMeans==3D and verbalElement==*lamp*' },
  ],
};

import { config } from './config.js';

/** Metadane z adresem bazowym aktualnego środowiska (produkcja / sandbox). */
export const APIS = {
  trademark: { ...TRADEMARK, base: config.euipo.trademarkBase, environment: config.euipo.environment },
  design: { ...DESIGN, base: config.euipo.designBase, environment: config.euipo.environment },
};
