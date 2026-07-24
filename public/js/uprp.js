/* NEURON — strona UPRP e-Wyszukiwarka */

// Wersję (`?v=`) przenosimy z URL-a tego modułu na importy — inaczej przeglądarka
// mogłaby podać zabuforowaną, starszą kopię zależności.
const V = new URL(import.meta.url).search;
const {
  apiGet, apiUrl, renderJson, renderError, renderLoading, escapeHtml,
  redirectIfUnauthorized,
} = await import('./app.js' + V);
const { renderUprpRecord } = await import('./uprp-record.js' + V);

const META = JSON.parse(document.getElementById('uprpMeta').textContent);

async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (redirectIfUnauthorized(res)) throw new Error('Sesja wygasła — trwa przekierowanie do logowania.');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.details = data && data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** XML sparsowany przez fast-xml-parser: pojedynczy element nie jest tablicą. */
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Tekst z węzła XML — może być stringiem albo obiektem { '#text': … }. */
function nodeText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return nodeText(value['#text']);
  return String(value);
}

/** Daty UPRP: '2011-02-28' albo zbite '20250120'. */
function fmtUprpDate(value) {
  const s = nodeText(value);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return s || '—';
}

/* ================================================== słowniki */

let ATTRIBUTES = [];
let COLLECTIONS = [];
let PWP_TYPES = [];

const attrById = new Map();

async function loadDictionaries() {
  const [attrs, colls, types] = await Promise.allSettled([
    apiGet('/uprp/attributes'),
    apiGet('/uprp/collections'),
    apiGet('/uprp/pwp-types'),
  ]);

  if (attrs.status === 'fulfilled') {
    ATTRIBUTES = attrs.value
      .slice()
      .sort((a, b) => String(a.label).localeCompare(String(b.label), 'pl'));
    for (const a of ATTRIBUTES) attrById.set(Number(a.attributeId), a);
  }
  if (colls.status === 'fulfilled') COLLECTIONS = colls.value;
  if (types.status === 'fulfilled') PWP_TYPES = types.value;

  renderPwpTypes();
  renderCollections();
  renderDictTab();
  // Słowniki gotowe — odśwież selecty atrybutów w już dodanych wierszach
  document.querySelectorAll('#uprpCriteria .uprp-attr').forEach(fillAttributeSelect);

  const failed = [attrs, colls, types].filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.warn('[NEURON] Nie udało się pobrać części słowników UPRP:', failed[0].reason);
  }
}

function renderPwpTypes() {
  const box = document.getElementById('uprpPwpTypes');
  if (!PWP_TYPES.length) {
    box.textContent = 'słownik niedostępny';
    return;
  }
  box.innerHTML = PWP_TYPES.map(
    (t) => `
    <label class="form-check form-check-inline mb-0">
      <input class="form-check-input" type="checkbox" value="${t.id}" data-role="pwptype">
      <span class="form-check-label">${escapeHtml(t.type)}</span>
    </label>`
  ).join('');
}

function renderCollections() {
  const box = document.getElementById('uprpCollections');
  if (!COLLECTIONS.length) {
    box.textContent = 'słownik niedostępny';
    return;
  }
  box.innerHTML = COLLECTIONS.map((c) => {
    const children = toArray(c.child);
    const subs = children.length
      ? `<div class="ms-4 d-flex flex-wrap gap-2">${children
          .map(
            (s) => `
          <label class="form-check form-check-inline mb-0">
            <input class="form-check-input" type="checkbox" value="${escapeHtml(String(s.id))}"
                   data-role="subcollection" data-parent="${c.id}">
            <span class="form-check-label">${escapeHtml(s.name)}</span>
          </label>`
          )
          .join('')}</div>`
      : '';
    return `
      <div>
        <label class="form-check mb-0">
          <input class="form-check-input" type="checkbox" value="${c.id}" data-role="collection">
          <span class="form-check-label">${escapeHtml(c.name)}</span>
        </label>
        ${subs}
      </div>`;
  }).join('');

  // Zaznaczenie subkolekcji zaznacza kolekcję nadrzędną
  box.querySelectorAll('[data-role="subcollection"]').forEach((sub) => {
    sub.addEventListener('change', () => {
      if (!sub.checked) return;
      const parent = box.querySelector(`[data-role="collection"][value="${sub.dataset.parent}"]`);
      if (parent) parent.checked = true;
    });
  });
}

/* ================================== kreator kryteriów wyszukiwania */

const criteriaBox = document.getElementById('uprpCriteria');

function fillAttributeSelect(select) {
  const current = select.value;
  select.innerHTML =
    '<option value="">— atrybut —</option>' +
    ATTRIBUTES.map(
      (a) =>
        `<option value="${a.attributeId}">${escapeHtml(a.label)} (${escapeHtml(a.formType)})</option>`
    ).join('');
  if (current) select.value = current;
}

function addCriterionRow(preset = {}) {
  const row = document.createElement('div');
  row.className = 'nrn-criterion uprp-criterion';
  row.innerHTML = `
    <select class="form-select nrn-joiner uprp-joiner">
      ${META.logicalOperators
        .map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
        .join('')}
    </select>
    <select class="form-select uprp-attr"></select>
    <select class="form-select uprp-op">
      ${META.stringOperators
        .map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
        .join('')}
    </select>
    <div class="uprp-value d-flex gap-1">
      <input type="text" class="form-control uprp-text" placeholder="wartość">
    </div>
    <button type="button" class="btn btn-sm btn-outline-secondary uprp-remove" title="Usuń warunek">
      <i class="bi bi-x-lg"></i>
    </button>`;

  const attrSelect = row.querySelector('.uprp-attr');
  fillAttributeSelect(attrSelect);
  attrSelect.addEventListener('change', () => updateValueInputs(row));
  row.querySelector('.uprp-remove').addEventListener('click', () => row.remove());

  criteriaBox.append(row);

  if (preset.attributeId) {
    attrSelect.value = String(preset.attributeId);
    updateValueInputs(row);
    if (preset.logicalOperator) row.querySelector('.uprp-joiner').value = preset.logicalOperator;
    if (preset.stringOperator) row.querySelector('.uprp-op').value = preset.stringOperator;
    if (preset.text) row.querySelector('.uprp-text')?.setAttribute('value', preset.text);
    if (preset.from) row.querySelector('.uprp-from')?.setAttribute('value', preset.from);
    if (preset.to) row.querySelector('.uprp-to')?.setAttribute('value', preset.to);
  }
  return row;
}

/** Dopasowuje pola wartości do typu atrybutu (string / date / number / checkbox). */
function updateValueInputs(row) {
  const attr = attrById.get(Number(row.querySelector('.uprp-attr').value));
  const valueBox = row.querySelector('.uprp-value');
  const opSelect = row.querySelector('.uprp-op');
  const formType = attr?.formType || 'string';

  // `invisible` zamiast `d-none` — komórka zostaje w siatce grid i kolumny się nie przesuwają
  if (formType === 'date') {
    opSelect.classList.add('invisible');
    valueBox.innerHTML = `
      <input type="date" class="form-control uprp-from" title="od">
      <input type="date" class="form-control uprp-to" title="do">`;
  } else if (formType === 'number' || formType === 'money') {
    opSelect.classList.add('invisible');
    valueBox.innerHTML = `
      <input type="number" class="form-control uprp-from" placeholder="od">
      <input type="number" class="form-control uprp-to" placeholder="do">`;
  } else if (formType === 'checkbox') {
    opSelect.classList.add('invisible');
    valueBox.innerHTML = `
      <select class="form-select uprp-checked">
        <option value="true">tak</option>
        <option value="false">nie</option>
      </select>`;
  } else {
    opSelect.classList.remove('invisible');
    valueBox.innerHTML = `<input type="text" class="form-control uprp-text" placeholder="wartość">`;
  }
}

/** Buduje body żądania POST /deterministic-search zgodnie z dokumentacją. */
function buildSearchBody() {
  const rows = [...criteriaBox.querySelectorAll('.uprp-criterion')];
  const attributes = [];

  rows.forEach((row, index) => {
    const attr = attrById.get(Number(row.querySelector('.uprp-attr').value));
    if (!attr) return;
    const text = row.querySelector('.uprp-text')?.value.trim() || null;
    const from = row.querySelector('.uprp-from')?.value || null;
    const to = row.querySelector('.uprp-to')?.value || null;
    const checkedEl = row.querySelector('.uprp-checked');
    if (!text && !from && !to && !checkedEl) return;

    attributes.push({
      attributeId: Number(attr.attributeId),
      formType: attr.formType,
      attributeName: attr.attributeName,
      order: attributes.length,
      logicalOperator: attributes.length === 0 ? null : row.querySelector('.uprp-joiner').value,
      stringOperator: row.querySelector('.uprp-op').value,
      text,
      checked: checkedEl ? checkedEl.value === 'true' : null,
      from,
      to,
    });
  });

  const picked = (role) =>
    [...document.querySelectorAll(`[data-role="${role}"]:checked`)].map((el) => el.value);

  return {
    attributes,
    includeDiacritical: document.getElementById('uprpDiacritical').checked,
    pwpTypes: picked('pwptype').map(Number),
    collections: picked('collection').map(Number),
    subCollections: picked('subcollection'),
  };
}

/* ============================= prezentacja list wyników (XML → JSON) */

/** Wyciąga elementy z ArrayOfPwpXml niezależnie od rodzaju rekordów w _embedded. */
function extractItems(parsed) {
  const root = parsed?.root;
  if (!root) return { meta: null, items: [] };
  // Wyniki stronicowane mają licznik; bibliographics-results zwraca same rekordy.
  const meta =
    root.total !== undefined
      ? {
          page: Number(root.page ?? 1),
          pages: Number(root.pages ?? 1),
          total: Number(root.total ?? 0),
          limit: Number(root.limit ?? 0),
        }
      : null;
  const items = [];
  // Rekordy siedzą w <_embedded> (wyszukiwanie, zmiany) albo wprost pod <root> (BUP/WUP).
  const container = root._embedded && typeof root._embedded === 'object' ? root._embedded : root;
  for (const key of ['root', 'Transaction', 'pl-patent-document']) {
    for (const entry of toArray(container[key])) {
      if (entry === null || typeof entry !== 'object') continue;
      // wpisy typu <root><pl-patent-document> są zagnieżdżone o poziom głębiej
      items.push(key === 'root' ? entry : { [key]: entry });
    }
  }
  return { meta, items };
}

/** Skrócony opis pojedynczego rekordu — patent/wzór albo znak towarowy. */
function summarizeItem(item) {
  const doc = item['pl-patent-document'];
  if (doc) {
    const office = doc['pl-office-specific-data'] || {};
    const biblio = doc['bibliographic-data'] || {};
    const title = toArray(biblio['invention-title']).map(nodeText).filter(Boolean)[0];
    return {
      title: nodeText(office.extidappli) || nodeText(doc['@doc-number']) || 'pl-patent-document',
      chips: [
        nodeText(office.extidpatent),
        doc['@kind'] ? `kod ${nodeText(doc['@kind'])}` : '',
        office['date-of-grant'] ? `udzielono ${fmtUprpDate(office['date-of-grant'])}` : '',
        doc['@date-publ'] ? `publikacja ${fmtUprpDate(doc['@date-publ'])}` : '',
        nodeText(biblio['classification-ipc']?.['main-classification']),
      ].filter(Boolean),
      subtitle: title || '',
      image: null,
    };
  }

  // Znaki towarowe (TradeMarkTransactionBody) i wzory przemysłowe (DesignTransactionBody)
  // różnią się ścieżką, ale oba mają węzeł z ApplicationNumber — szukamy go rekurencyjnie.
  const rec = findNodeWith(item, 'ApplicationNumber');
  if (rec) {
    const verbal =
      nodeText(rec.WordMarkSpecification?.MarkVerbalElementText) ||
      nodeText(toArray(rec.IndicationProductDetails?.IndicationProduct)[0]);
    return {
      title: nodeText(rec.ApplicationNumber),
      chips: [
        nodeText(rec.RegistrationNumber) || nodeText(rec.DesignIdentifier),
        nodeText(rec.MarkFeature),
        nodeText(rec.MarkCurrentStatusCode) || nodeText(rec.DesignCurrentStatusCode),
        rec.ApplicationDate ? `zgłoszono ${fmtUprpDate(rec.ApplicationDate)}` : '',
      ].filter(Boolean),
      subtitle: verbal,
      // starsze rekordy: <MarkImage>URL</MarkImage>, nowsze: <MarkImage><MarkImageURI>URL</MarkImageURI>…
      image:
        nodeText(rec.MarkImageDetails?.MarkImage?.MarkImageURI) ||
        nodeText(rec.MarkImageDetails?.MarkImage) ||
        nodeText(
          toArray(
            findNodeWith(rec.DesignRepresentationSheetDetails, 'View')?.View
          )[0]
        ) ||
        null,
    };
  }

  const key = Object.keys(item)[0];
  return { title: key || 'rekord', chips: [], subtitle: '', image: null };
}

/** Pierwszy węzeł drzewa (obiekt/tablica) zawierający podany klucz. */
function findNodeWith(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return null;
  if (!Array.isArray(node) && node[key] !== undefined) return node;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const hit = findNodeWith(value, key, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Pojedynczy wynik: nagłówek do kliknięcia + szczegóły w tabelach. */
function itemGroup(item, onToggle) {
  const s = summarizeItem(item);
  const group = document.createElement('div');
  group.className = 'nrn-hit-group';
  group.innerHTML = `
    <div class="nrn-hit" role="button" tabindex="0" aria-expanded="false">
      ${s.image
        ? `<img class="nrn-hit-thumb" src="${escapeHtml(s.image)}" alt="" loading="lazy"
               onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'nrn-hit-thumb',innerHTML:'<i class=\\'bi bi-file-earmark\\'></i>'}))">`
        : '<div class="nrn-hit-thumb"><i class="bi bi-file-earmark"></i></div>'}
      <div class="flex-grow-1 min-w-0">
        <div class="nrn-hit-title font-mono">${escapeHtml(s.title)}</div>
        ${s.subtitle ? `<div class="small text-secondary mb-1">${escapeHtml(s.subtitle)}</div>` : ''}
        <div>${s.chips.map((c) => `<span class="nrn-chip">${escapeHtml(c)}</span>`).join('')}</div>
      </div>
      <i class="bi bi-chevron-down text-secondary nrn-chevron"></i>
    </div>
    <div class="nrn-hit-detail d-none">
      <div class="nrn-detail-block nrn-detail-record"></div>
      <div class="nrn-detail-block">
        <button class="btn btn-sm btn-outline-secondary nrn-json-toggle" type="button" aria-expanded="false">
          <i class="bi bi-braces me-1"></i>Surowa odpowiedź JSON
          <i class="bi bi-chevron-down ms-1 nrn-chevron"></i>
        </button>
        <div class="nrn-json-wrap nrn-result d-none mt-2"></div>
      </div>
    </div>`;

  const hit = group.querySelector('.nrn-hit');
  const detail = group.querySelector('.nrn-hit-detail');
  const jsonToggle = group.querySelector('.nrn-json-toggle');
  const jsonWrap = group.querySelector('.nrn-json-wrap');

  jsonToggle.addEventListener('click', () => {
    const hidden = jsonWrap.classList.toggle('d-none');
    jsonToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    if (!hidden && !jsonWrap.dataset.loaded) {
      jsonWrap.dataset.loaded = '1';
      renderJson(jsonWrap, item);
    }
  });

  const toggle = () => {
    const open = group.classList.toggle('open');
    hit.setAttribute('aria-expanded', String(open));
    detail.classList.toggle('d-none', !open);
    if (open && !detail.dataset.loaded) {
      detail.dataset.loaded = '1';
      renderUprpRecord(group.querySelector('.nrn-detail-record'), item);
    }
    onToggle();
  };

  hit.addEventListener('click', toggle);
  hit.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
  return group;
}

/** Lista wyników z rozwijanymi szczegółami; `collapseBtn` zwija wszystkie naraz. */
function renderItemList(container, items, collapseBtn) {
  collapseBtn?.classList.add('d-none');
  if (!items.length) {
    container.innerHTML = '<p class="text-secondary mb-0">Brak wyników.</p>';
    return;
  }
  const box = document.createElement('div');
  box.className = 'vstack gap-2';

  const syncCollapseBtn = () => {
    if (!collapseBtn) return;
    collapseBtn.classList.toggle('d-none', !box.querySelector('.nrn-hit-group.open'));
  };

  items.forEach((item) => box.append(itemGroup(item, syncCollapseBtn)));
  container.replaceChildren(box);
}

function collapseAll(container, collapseBtn) {
  container.querySelectorAll('.nrn-hit-group.open').forEach((group) => {
    group.classList.remove('open');
    group.querySelector('.nrn-hit').setAttribute('aria-expanded', 'false');
    group.querySelector('.nrn-hit-detail').classList.add('d-none');
  });
  collapseBtn.classList.add('d-none');
}

function showMeta(el, result, meta) {
  el.classList.remove('d-none');
  const parts = [];
  if (meta) {
    parts.push(`<strong>${meta.total}</strong> wyników`, `strona ${meta.page} z ${meta.pages}`);
  }
  parts.push(`${result.durationMs} ms`, `<code>${escapeHtml(result.url || '')}</code>`);
  el.innerHTML = parts.join(' · ');
}

/* ======================================= zakładka: wyszukiwanie */

const searchState = { criteriaId: null, page: 1, lastResult: null, lastMeta: null, lastItems: [] };

const searchResult = document.getElementById('uprpSearchResult');
const searchMeta = document.getElementById('uprpSearchMeta');
const pager = document.getElementById('uprpPager');
const searchCollapse = document.getElementById('uprpCollapseAll');

function currentSearchView() {
  return document.querySelector('input[name="uprpSearchView"]:checked')?.value || 'list';
}

function renderSearchResult() {
  const { lastResult, lastMeta, lastItems } = searchState;
  if (!lastResult) return;
  if (currentSearchView() === 'json') {
    searchCollapse.classList.add('d-none');
    renderJson(searchResult, lastResult.data ?? lastResult.xml);
  } else {
    renderItemList(searchResult, lastItems, searchCollapse);
  }
  showMeta(searchMeta, lastResult, lastMeta);
  if (lastMeta && lastMeta.pages > 1) {
    pager.classList.remove('d-none');
    document.getElementById('uprpPagerLabel').textContent = `strona ${lastMeta.page} z ${lastMeta.pages}`;
    document.getElementById('uprpPrevPage').disabled = lastMeta.page <= 1;
    document.getElementById('uprpNextPage').disabled = lastMeta.page >= lastMeta.pages;
  } else {
    pager.classList.add('d-none');
  }
}

async function loadSearchPage(page) {
  if (!searchState.criteriaId) return;
  renderLoading(searchResult, 'Pobieram wyniki z UPRP…');
  try {
    const limit = Number(document.getElementById('uprpLimit').value) || 10;
    const result = await apiGet(`/uprp/search-results/${searchState.criteriaId}`, { page, limit });
    const { meta, items } = extractItems(result.data);
    Object.assign(searchState, { page, lastResult: result, lastMeta: meta, lastItems: items });
    renderSearchResult();
  } catch (err) {
    renderError(searchResult, err);
  }
}

document.getElementById('uprpSearchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = buildSearchBody();
  if (!body.attributes.length) {
    renderError(searchResult, new Error('Dodaj co najmniej jeden warunek z wartością.'));
    return;
  }
  renderLoading(searchResult, 'Rejestruję kryteria w UPRP…');
  searchMeta.classList.add('d-none');
  pager.classList.add('d-none');
  try {
    const { criteriaId } = await apiPost('/uprp/search', body);
    searchState.criteriaId = criteriaId;
    await loadSearchPage(1);
  } catch (err) {
    renderError(searchResult, err);
  }
});

document.getElementById('uprpAddCriterion').addEventListener('click', () => addCriterionRow());
document.getElementById('uprpClearCriteria').addEventListener('click', () => {
  criteriaBox.innerHTML = '';
  addCriterionRow();
});
searchCollapse.addEventListener('click', () => collapseAll(searchResult, searchCollapse));
document.getElementById('uprpPrevPage').addEventListener('click', () => loadSearchPage(searchState.page - 1));
document.getElementById('uprpNextPage').addEventListener('click', () => loadSearchPage(searchState.page + 1));
document.querySelectorAll('input[name="uprpSearchView"]').forEach((el) => {
  el.addEventListener('change', renderSearchResult);
});

document.querySelectorAll('.uprp-example').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const ex = META.searchExamples[Number(link.dataset.example)];
    if (!ex) return;
    criteriaBox.innerHTML = '';
    ex.criteria.forEach((c) => addCriterionRow(c));
    document.querySelectorAll('[data-role="pwptype"]').forEach((el) => {
      el.checked = (ex.pwpTypes || []).includes(Number(el.value));
    });
  });
});

/* ======================================= zakładka: rekord PWP */

const pwpSummary = document.getElementById('uprpPwpSummary');
const pwpTable = document.getElementById('uprpPwpTable');
const pwpResult = document.getElementById('uprpPwpResult');
const pwpXmlBtn = document.getElementById('uprpPwpXmlBtn');
const pwpJsonToggle = document.getElementById('uprpPwpJsonToggle');
let pwpLastXml = null;

pwpJsonToggle.addEventListener('click', () => {
  const hidden = pwpResult.classList.toggle('d-none');
  pwpJsonToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
});

document.getElementById('uprpPwpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const number = document.getElementById('uprpPwpNumber').value.trim();
  if (!number) return;
  renderLoading(pwpSummary, 'Pobieram rekord z UPRP…');
  pwpTable.innerHTML = '';
  pwpResult.innerHTML = '';
  pwpXmlBtn.classList.add('d-none');
  try {
    const result = await apiGet(`/uprp/pwp/${encodeURIComponent(number)}`);
    pwpLastXml = result.xml;
    // Rekord bywa opakowany w <root> (patenty/wzory) albo zaczyna się od <Transaction> (znaki)
    let item = result.data && typeof result.data === 'object' ? result.data : {};
    if (item.root && typeof item.root === 'object') item = item.root;
    const s = summarizeItem(item);
    pwpSummary.innerHTML = `
      <div class="d-flex gap-3">
        ${
          s.image
            ? `<img class="nrn-hit-thumb" src="${escapeHtml(s.image)}" alt=""
                   onerror="this.style.visibility='hidden'">`
            : ''
        }
        <div>
          <div class="nrn-hit-title font-mono">${escapeHtml(s.title !== 'rekord' ? s.title : number)}</div>
          ${s.subtitle ? `<div class="mb-1">${escapeHtml(s.subtitle)}</div>` : ''}
          <div>${s.chips.map((c) => `<span class="nrn-chip">${escapeHtml(c)}</span>`).join('')}</div>
          <div class="small text-secondary mt-2">${result.durationMs} ms · <code>${escapeHtml(result.url)}</code></div>
        </div>
      </div>`;
    renderUprpRecord(pwpTable, item);
    renderJson(pwpResult, result.data ?? result.xml);
    if (pwpLastXml) pwpXmlBtn.classList.remove('d-none');
  } catch (err) {
    renderError(pwpSummary, err);
    pwpTable.innerHTML = '';
  }
});

pwpXmlBtn.addEventListener('click', () => {
  if (!pwpLastXml) return;
  const blob = new Blob([pwpLastXml], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `uprp-${document.getElementById('uprpPwpNumber').value.trim() || 'pwp'}.xml`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.querySelectorAll('.uprp-pwp-example').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('uprpPwpNumber').value = link.dataset.number;
  });
});

/* ================================== zakładka: zmienione od dnia */

const changedState = { page: 1 };
const changedResult = document.getElementById('uprpChangedResult');
const changedMeta = document.getElementById('uprpChangedMeta');
const changedPager = document.getElementById('uprpChangedPager');
const changedCollapse = document.getElementById('uprpChangedCollapse');

changedCollapse.addEventListener('click', () => collapseAll(changedResult, changedCollapse));

async function loadChangedPage(page) {
  const since = document.getElementById('uprpChangedDate').value;
  if (!since) return;
  renderLoading(changedResult, 'Pobieram listę zmian z UPRP…');
  try {
    const limit = Number(document.getElementById('uprpChangedLimit').value) || 10;
    const result = await apiGet(`/uprp/changed-since/${since}`, { page, limit });
    const { meta, items } = extractItems(result.data);
    changedState.page = page;
    renderItemList(changedResult, items, changedCollapse);
    showMeta(changedMeta, result, meta);
    if (meta && meta.pages > 1) {
      changedPager.classList.remove('d-none');
      document.getElementById('uprpChangedLabel').textContent = `strona ${meta.page} z ${meta.pages}`;
      document.getElementById('uprpChangedPrev').disabled = meta.page <= 1;
      document.getElementById('uprpChangedNext').disabled = meta.page >= meta.pages;
    } else {
      changedPager.classList.add('d-none');
    }
  } catch (err) {
    renderError(changedResult, err);
  }
}

document.getElementById('uprpChangedForm').addEventListener('submit', (e) => {
  e.preventDefault();
  loadChangedPage(1);
});
document.getElementById('uprpChangedPrev').addEventListener('click', () => loadChangedPage(changedState.page - 1));
document.getElementById('uprpChangedNext').addEventListener('click', () => loadChangedPage(changedState.page + 1));

/* ========================================= zakładka: BUP / WUP */

const bibResult = document.getElementById('uprpBibResult');
const bibMeta = document.getElementById('uprpBibMeta');
const bibCollapse = document.getElementById('uprpBibCollapse');

bibCollapse.addEventListener('click', () => collapseAll(bibResult, bibCollapse));

function bibParams() {
  return {
    publisher: document.getElementById('uprpBibPublisher').value,
    pwp_type: document.getElementById('uprpBibType').value,
    nr_pub: document.getElementById('uprpBibNr').value.trim(),
    date_start: document.getElementById('uprpBibStart').value,
    date_end: document.getElementById('uprpBibEnd').value,
  };
}

document.getElementById('uprpBibForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  renderLoading(bibResult, 'Pobieram dane bibliograficzne z UPRP…');
  bibMeta.classList.add('d-none');
  try {
    const result = await apiGet('/uprp/bibliographics', bibParams());
    const { meta, items } = extractItems(result.data);
    if (items.length) {
      renderItemList(bibResult, items, bibCollapse);
    } else {
      // Odpowiedź bez rozpoznanych rekordów: pokazujemy ją jako tabelę całego drzewa
      bibCollapse.classList.add('d-none');
      if (!renderUprpRecord(bibResult, result.data)) renderJson(bibResult, result.data ?? result.xml);
    }
    showMeta(bibMeta, result, meta);
  } catch (err) {
    renderError(bibResult, err);
  }
});

document.getElementById('uprpBibXml').addEventListener('click', () => {
  const url = apiUrl('/uprp/bibliographics', { ...bibParams(), format: 'xml' });
  window.open(url, '_blank');
});

/* ============================================ zakładka: słowniki */

function renderDictTab() {
  const typesBox = document.getElementById('uprpDictTypes');
  typesBox.innerHTML = PWP_TYPES.length
    ? `<table class="table table-sm nrn-record-table"><tbody>${PWP_TYPES.map(
        (t) => `<tr><th scope="row">${t.id}</th><td>${escapeHtml(t.type)}</td></tr>`
      ).join('')}</tbody></table>`
    : 'słownik niedostępny';

  const collBox = document.getElementById('uprpDictCollections');
  collBox.innerHTML = COLLECTIONS.length
    ? `<table class="table table-sm nrn-record-table"><tbody>${COLLECTIONS.map((c) => {
        const subs = toArray(c.child).map((s) => s.name).join(', ');
        return `<tr><th scope="row">${c.id}</th><td>${escapeHtml(c.name)}${
          subs ? `<div class="text-secondary small">${escapeHtml(subs)}</div>` : ''
        }</td></tr>`;
      }).join('')}</tbody></table>`
    : 'słownik niedostępny';

  renderAttrTable('');
}

function renderAttrTable(filter) {
  const box = document.getElementById('uprpDictAttributes');
  const needle = filter.toLowerCase();
  const rows = ATTRIBUTES.filter(
    (a) =>
      !needle ||
      String(a.label).toLowerCase().includes(needle) ||
      String(a.attributeName).toLowerCase().includes(needle)
  );
  box.innerHTML = rows.length
    ? `<table class="table table-sm nrn-record-table">
        <thead><tr><th>ID</th><th>Etykieta</th><th>attributeName</th><th>formType</th></tr></thead>
        <tbody>${rows
          .map(
            (a) => `<tr>
              <td>${a.attributeId}</td>
              <td>${escapeHtml(a.label)}</td>
              <td class="font-mono">${escapeHtml(a.attributeName)}</td>
              <td>${escapeHtml(a.formType)}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table>`
    : 'brak atrybutów pasujących do filtra';
}

document.getElementById('uprpDictFilter').addEventListener('input', (e) => {
  renderAttrTable(e.target.value.trim());
});

/* ---------------------------------------------------------- start */

addCriterionRow();
loadDictionaries();
