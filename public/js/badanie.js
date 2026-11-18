import { apiGet, escapeHtml, renderError, renderLoading } from './app.js';

const { industries, classNames } = JSON.parse(document.getElementById('industriesData').textContent);

const form = document.getElementById('examForm');
const nameInput = document.getElementById('examName');
const whatInput = document.getElementById('examWhat');
const tilesBox = document.getElementById('examTiles');
const classesInput = document.getElementById('examClasses');
const proBox = document.getElementById('proClasses');
const proSwitch = document.getElementById('proMode');
const summary = document.getElementById('examSummary');
const submit = document.getElementById('examSubmit');
const result = document.getElementById('examResult');

const PRO_KEY = 'neuron-pro-mode';
const selected = new Set();
let touchedTiles = false;
let lastData = null;

/* ---------------------------------------------------------- pomocnicze */

/** Litera po literze bez znaków diakrytycznych, małymi literami — długość tekstu się nie zmienia. */
const fold = (text) => [...String(text)].map((ch) => (ch === 'ł' || ch === 'Ł' ? 'l' : ch.normalize('NFD')[0].toLowerCase())).join('');

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* bez pamięci przeglądarki */ } },
};

const isPro = () => proSwitch.checked;

function parseClassInput(text) {
  return [...new Set(String(text).split(/[\s,;]+/).map(Number).filter((c) => Number.isInteger(c) && c >= 1 && c <= 45))];
}

/** Klasy do wyszukiwania: wpisane ręcznie (tryb profesjonalny) albo z zaznaczonych branż. */
function chosenClasses() {
  if (isPro()) {
    const typed = parseClassInput(classesInput.value);
    if (typed.length) return typed;
  }
  const out = new Set();
  for (const ind of industries) if (selected.has(ind.id)) ind.classes.forEach((c) => out.add(c));
  return [...out].sort((a, b) => a - b);
}

const className = (c) => (isPro() ? `${c} — ${classNames[c]}` : classNames[c] || `klasa ${c}`);

/* --------------------------------------------------------------- kafelki */

function renderTiles(suggested = new Set()) {
  tilesBox.innerHTML = industries.map((ind) => `
    <button type="button" class="nrn-tile${suggested.has(ind.id) ? ' is-suggested' : ''}" data-id="${ind.id}"
            aria-pressed="${selected.has(ind.id)}">${escapeHtml(ind.label)}</button>`).join('');
  updateSummary();
}

function suggestFromText(text) {
  const t = ` ${fold(text)} `;
  return new Set(industries.filter((ind) => ind.keywords.some((k) => t.includes(k))).map((ind) => ind.id));
}

function updateSummary() {
  const classes = chosenClasses();
  summary.innerHTML = classes.length
    ? `Szukamy w: ${escapeHtml(classes.map(className).join(', '))}`
    : 'Bez branży porównamy nazwę ze wszystkimi znakami.';
}

tilesBox.addEventListener('click', (event) => {
  const tile = event.target.closest('.nrn-tile');
  if (!tile) return;
  touchedTiles = true;
  const { id } = tile.dataset;
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  tile.setAttribute('aria-pressed', String(selected.has(id)));
  updateSummary();
});

whatInput.addEventListener('input', () => {
  const suggested = suggestFromText(whatInput.value);
  // Dopóki użytkownik sam nie klikał kafelków, podpowiedzi od razu je zaznaczają.
  if (!touchedTiles) {
    selected.clear();
    suggested.forEach((id) => selected.add(id));
  }
  renderTiles(suggested);
});

classesInput.addEventListener('input', updateSummary);

/* ----------------------------------------------------- tryb profesjonalny */

function applyPro() {
  proBox.classList.toggle('d-none', !isPro());
  store.set(PRO_KEY, isPro() ? '1' : '0');
  updateSummary();
  if (lastData) render(lastData);
}

proSwitch.checked = store.get(PRO_KEY) === '1';
proSwitch.addEventListener('change', applyPro);

/* ----------------------------------------------------------------- wynik */

const VERDICT_ICON = { low: '●', warning: '▲', high: '■' };
const SCOPE = { euipo: 'Cała UE', uprp: 'Polska' };

const NEXT_STEPS = {
  low: 'Możesz działać dalej: kup domenę i zgłoś znak, zanim zrobi to ktoś inny. Przed dużymi wydatkami (etykiety, reklama) warto pokazać wynik rzecznikowi patentowemu.',
  warning: 'Przejrzyj znaki poniżej. Jeśli działają w Twojej branży, zmień nazwę albo skonsultuj ją z rzecznikiem patentowym przed zgłoszeniem.',
  high: 'Rozważ inną nazwę. Jeśli bardzo zależy Ci na tej, porozmawiaj z rzecznikiem patentowym, zanim zaczniesz jej używać.',
};

function statusText(m) {
  if (m.state === 'inactive') return 'Wygasł albo odrzucony — zwykle nie blokuje';
  if (m.state === 'pending') return 'Zgłoszenie w toku';
  if (m.state === 'registered') return m.expiryDate ? `Chroniony do ${m.expiryDate.slice(0, 4)}` : 'Chroniony';
  return m.status || 'Status nieznany';
}

/** Podświetla w nazwie znaku słowa badanej nazwy (od 3 liter), bez względu na wielkość liter i ogonki. */
function highlight(name, query) {
  const folded = fold(name);
  const marks = new Array(name.length).fill(false);
  for (const word of fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)) {
    let i = folded.indexOf(word);
    while (i !== -1) {
      for (let k = i; k < i + word.length; k += 1) marks[k] = true;
      i = folded.indexOf(word, i + 1);
    }
  }
  let out = '';
  let open = false;
  [...name].forEach((ch, i) => {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeHtml(ch);
  });
  return open ? `${out}</mark>` : out;
}

function recordLink(m) {
  if (m.source === 'euipo') return `https://euipo.europa.eu/eSearch/#details/trademarks/${encodeURIComponent(m.number)}`;
  return 'https://ewyszukiwarka.pue.uprp.gov.pl/';
}

function matchHtml(m, query, openDetails) {
  const owner = m.applicants[0];
  const branze = [...m.commonClasses, ...m.niceClasses.filter((c) => !m.commonClasses.includes(c))];
  const shown = branze.slice(0, 3).map(className).join(', ') + (branze.length > 3 ? ` i ${branze.length - 3} innych` : '');
  return `<li class="nrn-match mb-2">
    <div class="d-flex justify-content-between gap-2 flex-wrap">
      <strong class="fs-6">${highlight(m.name, query)}</strong>
      <span class="small text-secondary">${escapeHtml(SCOPE[m.source] || m.source)}</span>
    </div>
    <div class="small text-secondary mb-1">
      ${escapeHtml(statusText(m))}${owner?.name ? ` · ${escapeHtml(owner.name)}${owner.country ? ` (${escapeHtml(owner.country)})` : ''}` : ''}
    </div>
    <div>${m.reasons.map((r) => `<span class="nrn-reason">${escapeHtml(r.text)}</span>`).join('')}</div>
    ${shown ? `<div class="small mt-2">Branże: ${escapeHtml(shown)}</div>` : ''}
    <details class="small mt-2"${openDetails ? ' open' : ''}><summary>Szczegóły</summary>
      <dl class="row mb-0 mt-1">
        <dt class="col-sm-4">Numer zgłoszenia</dt><dd class="col-sm-8 font-mono">${escapeHtml(m.number)}</dd>
        <dt class="col-sm-4">Klasy nicejskie</dt><dd class="col-sm-8">${escapeHtml(m.niceClasses.join(', ') || '—')}</dd>
        <dt class="col-sm-4">Status w rejestrze</dt><dd class="col-sm-8">${escapeHtml(m.status || '—')}</dd>
        <dt class="col-sm-4">Rodzaj znaku</dt><dd class="col-sm-8">${escapeHtml(m.markFeature || '—')}</dd>
        <dt class="col-sm-4">Data zgłoszenia</dt><dd class="col-sm-8">${escapeHtml(m.applicationDate || '—')}</dd>
        <dt class="col-sm-4">Ochrona do</dt><dd class="col-sm-8">${escapeHtml(m.expiryDate || '—')}</dd>
        <dt class="col-sm-4">Ocena</dt><dd class="col-sm-8">nazwa ${m.nameScore.toFixed(2)} · ryzyko ${m.risk.toFixed(2)}</dd>
      </dl>
      <a href="${recordLink(m)}" target="_blank" rel="noopener noreferrer">
        Zobacz w rejestrze ${m.source === 'euipo' ? 'EUIPO' : 'UPRP'} <i class="bi bi-box-arrow-up-right small"></i></a>
    </details>
  </li>`;
}

function groupHtml(title, list, query, { collapsed, openDetails }) {
  if (!list.length) return '';
  const items = `<ul class="list-unstyled mb-0 mt-2">${list.map((m) => matchHtml(m, query, openDetails)).join('')}</ul>`;
  if (!collapsed) return `<section class="mb-4"><h2 class="h5">${title} <span class="text-secondary">(${list.length})</span></h2>${items}</section>`;
  return `<details class="nrn-group mb-3"><summary class="h6 mb-0">${title} <span class="text-secondary">(${list.length})</span></summary>${items}</details>`;
}

function render(data) {
  lastData = data;
  const { verdict, matches, coverage } = data;
  const openDetails = isPro() || result.dataset.allOpen === '1';
  const byGroup = (g) => matches.filter((m) => m.group === g);
  const total = Object.values(coverage.registry).reduce((a, b) => a + b, 0);
  const regs = Object.entries(coverage.registry)
    .map(([k, n]) => `${k === 'euipo' ? 'UE' : 'Polska'}: ${n.toLocaleString('pl-PL')}`).join(', ');

  result.innerHTML = `
    <div class="nrn-verdict nrn-verdict-${verdict.level} mb-4">
      <div class="h4 mb-1 nrn-verdict-label"><span aria-hidden="true">${VERDICT_ICON[verdict.level]}</span> ${escapeHtml(verdict.label)}</div>
      <p class="mb-2">${escapeHtml(verdict.text)}</p>
      ${verdict.classesGiven ? '' : '<p class="small mb-2">Nie wybrałeś branży, więc porównaliśmy nazwę ze znakami ze wszystkich branż.</p>'}
      <p class="small text-secondary mb-0">
        Sprawdziliśmy ${total.toLocaleString('pl-PL')} znaków (${escapeHtml(regs)}).
        ${coverage.indexComplete ? '' : 'Kopia rejestrów jest jeszcze uzupełniana.'}
      </p>
    </div>
    <div class="d-flex justify-content-end mb-2">
      <button type="button" class="btn btn-sm btn-outline-secondary" id="toggleDetails">
        ${openDetails ? 'Zwiń wszystkie szczegóły' : 'Pokaż wszystkie szczegóły'}
      </button>
    </div>
    ${groupHtml('Najważniejsze', byGroup('main'), data.name, { collapsed: false, openDetails })}
    ${groupHtml('Inne branże', byGroup('other'), data.name, { collapsed: true, openDetails })}
    ${groupHtml('Nieaktywne', byGroup('inactive'), data.name, { collapsed: true, openDetails })}
    ${matches.length ? '' : `<p>Nie znaleźliśmy podobnych znaków. Sprawdziliśmy ${total.toLocaleString('pl-PL')} rekordów.</p>`}
    <section class="nrn-panel mt-4">
      <h2 class="h5">Co dalej?</h2>
      <p class="mb-0">${escapeHtml(NEXT_STEPS[verdict.level])}</p>
    </section>`;

  document.getElementById('toggleDetails').addEventListener('click', () => {
    result.dataset.allOpen = openDetails ? '0' : '1';
    render(lastData);
  });
}

/* --------------------------------------------------------------- wysyłka */

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  const classes = chosenClasses();
  submit.disabled = true;
  renderLoading(result, 'Przeszukujemy rejestr Unii Europejskiej i polski Urząd Patentowy…');
  try {
    render(await apiGet('/badanie', { name, classes: classes.join(',') }));
    const params = new URLSearchParams({ nazwa: name });
    if (classes.length) params.set('klasy', classes.join(','));
    history.replaceState(null, '', `?${params}`);
  } catch (err) {
    renderError(result, err);
  } finally {
    submit.disabled = false;
  }
});

/* ------------------------------------------------------------------ start */

renderTiles();
applyPro();
const initial = new URLSearchParams(location.search);
if (initial.get('klasy')) {
  const classes = parseClassInput(initial.get('klasy'));
  // Branże, których wszystkie klasy są w adresie; reszta trafia do pola klas (tryb profesjonalny).
  for (const ind of industries) if (ind.classes.every((c) => classes.includes(c))) selected.add(ind.id);
  classesInput.value = classes.join(', ');
  touchedTiles = true;
  renderTiles();
}
if (initial.get('nazwa')) {
  nameInput.value = initial.get('nazwa');
  form.requestSubmit();
}
