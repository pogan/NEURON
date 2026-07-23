/* NEURON — logika podstron wyszukiwania (znaki towarowe / wzory) */

// Wersję (`?v=`) przenosimy z URL-a tego modułu na import, inaczej przeglądarka
// mogłaby podać zabuforowaną, starszą kopię `app.js`.
const V = new URL(import.meta.url).search;
const {
  apiGet, apiUrl, renderJson, renderError, renderLoading, escapeHtml, fmtDate,
} = await import('./app.js' + V);
const { renderRecordTable } = await import('./record-table.js' + V);

const META = JSON.parse(document.getElementById('apiMeta').textContent);
const IS_TM = META.id === 'trademark';
const COLLECTION = IS_TM ? 'trademarks' : 'designs';
const RESOURCE = IS_TM ? '/trademarks' : '/designs';

const EU_LANGS = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr',
  'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'];

/* ============================================ kreator zapytań RSQL */

const rowsBox = document.getElementById('criteriaRows');
const queryInput = document.getElementById('queryInput');
const manualToggle = document.getElementById('manualQuery');

function criterionRow() {
  const row = document.createElement('div');
  row.className = 'nrn-criterion';

  const joiner = document.createElement('select');
  joiner.className = 'form-select nrn-joiner';
  joiner.innerHTML = '<option value="and">and</option><option value="or">or</option>';

  const field = document.createElement('select');
  field.className = 'form-select nrn-field';
  field.innerHTML = META.queryFields
    .map((f) => `<option value="${f.name}">${escapeHtml(f.label)}</option>`)
    .join('');

  const op = document.createElement('select');
  op.className = 'form-select nrn-op';

  const valueWrap = document.createElement('div');
  valueWrap.className = 'nrn-value-wrap';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-sm btn-outline-secondary';
  remove.innerHTML = '<i class="bi bi-trash"></i>';
  remove.addEventListener('click', () => {
    row.remove();
    syncQuery();
  });

  function refreshOps() {
    const def = META.queryFields.find((f) => f.name === field.value);
    op.innerHTML = def.ops.map((o) => `<option value="${o}">${o}</option>`).join('');
    refreshValue();
  }

  function refreshValue() {
    const def = META.queryFields.find((f) => f.name === field.value);
    const multi = op.value === '=in=' || op.value === '=out=' || op.value === '=all=';
    let input;

    if (def.type === 'enum' && !multi) {
      input = document.createElement('select');
      input.className = 'form-select nrn-val';
      input.innerHTML = def.values.map((v) => `<option value="${v}">${v}</option>`).join('');
    } else {
      input = document.createElement('input');
      input.className = 'form-control nrn-val';
      input.type = def.type === 'date' && !multi ? 'date' : 'text';
      if (multi) {
        input.placeholder = def.type === 'enum' ? def.values.slice(0, 2).join(',') : 'wartość1,wartość2';
      } else if (def.hint) {
        input.placeholder = def.hint;
      }
    }
    input.title = def.hint || def.name;
    input.addEventListener('input', syncQuery);
    input.addEventListener('change', syncQuery);
    valueWrap.replaceChildren(input);
  }

  field.addEventListener('change', () => { refreshOps(); syncQuery(); });
  op.addEventListener('change', () => { refreshValue(); syncQuery(); });
  joiner.addEventListener('change', syncQuery);

  row.append(joiner, field, op, valueWrap, remove);
  refreshOps();
  return row;
}

/** Wartość RSQL: cudzysłowy tylko gdy potrzebne, listy w nawiasach. */
function rsqlValue(raw, op) {
  const multi = op === '=in=' || op === '=out=' || op === '=all=';
  if (multi) {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean).map(quoteIfNeeded);
    return `(${items.join(',')})`;
  }
  return quoteIfNeeded(raw.trim());
}

function quoteIfNeeded(value) {
  return /[\s"'()<>,;=!~]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function buildQuery() {
  const parts = [];
  [...rowsBox.children].forEach((row, index) => {
    const field = row.querySelector('.nrn-field').value;
    const op = row.querySelector('.nrn-op').value;
    const raw = row.querySelector('.nrn-val').value;
    if (!raw.trim()) return;
    const expr = `${field}${op}${rsqlValue(raw, op)}`;
    if (parts.length && index >= 0) {
      parts.push(row.querySelector('.nrn-joiner').value, expr);
    } else {
      parts.push(expr);
    }
  });
  return parts.join(' ');
}

function syncQuery() {
  if (manualToggle.checked) return;
  queryInput.value = buildQuery();
}

document.getElementById('addCriterion').addEventListener('click', () => {
  rowsBox.append(criterionRow());
});

document.getElementById('clearCriteria').addEventListener('click', () => {
  rowsBox.replaceChildren(criterionRow());
  syncQuery();
});

manualToggle.addEventListener('change', () => {
  queryInput.readOnly = !manualToggle.checked;
  if (!manualToggle.checked) syncQuery();
});

document.querySelectorAll('.nrn-example').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    manualToggle.checked = true;
    queryInput.readOnly = false;
    queryInput.value = link.dataset.query;
  });
});

rowsBox.append(criterionRow());

/* ================================================ listy językowe */

for (const select of [document.getElementById('langInput'), document.getElementById('detailLang')]) {
  for (const lang of EU_LANGS) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    select.append(opt);
  }
  select.value = 'pl';
}

/* ===================================================== wyszukiwanie */

const form = document.getElementById('searchForm');
const resultBox = document.getElementById('searchResult');
const metaBox = document.getElementById('searchMeta');
const pager = document.getElementById('pager');
const pagerLabel = document.getElementById('pagerLabel');
const pageInput = document.getElementById('pageInput');

let lastPayload = null;

function currentParams() {
  const sortField = document.getElementById('sortField').value;
  return {
    query: queryInput.value.trim(),
    fields: document.getElementById('fieldsInput').value.trim(),
    page: pageInput.value,
    size: document.getElementById('sizeInput').value,
    sort: sortField ? `${sortField}:${document.getElementById('sortDir').value}` : '',
    lang: document.getElementById('langInput').value,
  };
}

async function runSearch() {
  const params = currentParams();
  renderLoading(resultBox);
  metaBox.classList.add('d-none');
  pager.classList.add('d-none');
  try {
    const payload = await apiGet(RESOURCE, params);
    lastPayload = payload;
    showMeta(payload, params);
    showResult(payload.data);
    showPager(payload.data);
  } catch (err) {
    renderError(resultBox, err);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  pageInput.value = '0';
  runSearch();
});

document.querySelectorAll('input[name="viewMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (lastPayload) showResult(lastPayload.data);
  });
});

document.getElementById('prevPage').addEventListener('click', () => {
  pageInput.value = Math.max(0, Number(pageInput.value) - 1);
  runSearch();
});

document.getElementById('nextPage').addEventListener('click', () => {
  pageInput.value = Number(pageInput.value) + 1;
  runSearch();
});

function showMeta(payload, params) {
  const rl = payload.rateLimit || {};
  metaBox.innerHTML = `
    <div><strong>${payload.data.totalElements ?? 0}</strong> wyników ·
      strona ${(payload.data.page ?? 0) + 1} z ${payload.data.totalPages ?? 1} ·
      ${payload.durationMs} ms
      ${rl.remaining ? ` · limit: ${escapeHtml(rl.remaining)}/${escapeHtml(rl.limit || '?')}` : ''}
    </div>
    <div class="mt-1"><code>${escapeHtml(payload.url)}</code></div>`;
  metaBox.classList.remove('d-none');
  metaBox.dataset.lang = params.lang || '';
}

function showPager(data) {
  if (!data || !data.totalPages) return;
  pagerLabel.textContent = `Strona ${(data.page ?? 0) + 1} z ${data.totalPages}`;
  document.getElementById('prevPage').disabled = (data.page ?? 0) <= 0;
  document.getElementById('nextPage').disabled = (data.page ?? 0) >= data.totalPages - 1;
  pager.classList.remove('d-none');
}

function showResult(data) {
  const mode = document.querySelector('input[name="viewMode"]:checked').value;
  if (mode === 'json') return renderJson(resultBox, data);

  const items = data?.[COLLECTION] || [];
  if (!items.length) {
    resultBox.innerHTML = '<p class="text-secondary mb-0">Brak wyników dla podanych kryteriów.</p>';
    return;
  }
  const box = document.createElement('div');
  box.className = 'vstack gap-2';
  items.forEach((item) => box.append(IS_TM ? trademarkCard(item) : designCard(item)));
  resultBox.replaceChildren(box);
}

function card(id, thumbUrl, iconClass, title, subtitle, chips) {
  const el = document.createElement('div');
  el.className = 'nrn-hit';
  el.innerHTML = `
    ${thumbUrl
      ? `<img class="nrn-hit-thumb" src="${thumbUrl}" alt="" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'nrn-hit-thumb',innerHTML:'<i class=\\'bi ${iconClass}\\'></i>'}))">`
      : `<div class="nrn-hit-thumb"><i class="bi ${iconClass}"></i></div>`}
    <div class="flex-grow-1 min-w-0">
      <div class="nrn-hit-title">${title}</div>
      <div class="small text-secondary mb-1">${subtitle}</div>
      <div>${chips}</div>
    </div>
    <i class="bi bi-chevron-right text-secondary"></i>`;
  el.addEventListener('click', () => openDetail(id));
  return el;
}

function trademarkCard(tm) {
  const verbal = tm.wordMarkSpecification?.verbalElement || '(znak bez elementu słownego)';
  const hasImage = tm.markFeature && tm.markFeature !== 'WORD';
  const thumb = hasImage
    ? apiUrl(`/trademarks/${encodeURIComponent(tm.applicationNumber)}/image/thumbnail`).toString()
    : null;
  const chips = [
    tm.status, tm.markFeature, tm.markKind,
    tm.niceClasses?.length ? `NCL ${tm.niceClasses.join(', ')}` : null,
  ].filter(Boolean).map((c) => `<span class="nrn-chip">${escapeHtml(c)}</span>`).join('');
  const applicant = tm.applicants?.[0]?.name || tm.applicants?.[0]?.fullName || '—';
  return card(
    tm.applicationNumber, thumb, 'bi-tag',
    escapeHtml(verbal),
    `${escapeHtml(tm.applicationNumber)} · zgłoszenie ${fmtDate(tm.applicationDate)} · ${escapeHtml(applicant)}`,
    chips
  );
}

function designCard(dn) {
  const thumb = apiUrl(`/designs/${encodeURIComponent(dn.designNumber)}/views/1/thumbnail`).toString();
  const chips = [
    dn.status, dn.designRepresentationMeans,
    dn.locarnoClasses?.length ? `LOC ${dn.locarnoClasses.join(', ')}` : null,
  ].filter(Boolean).map((c) => `<span class="nrn-chip">${escapeHtml(c)}</span>`).join('');
  const indication = dn.locarnoClassification?.[0]?.description
    || dn.locarnoClassification?.[0]?.subclassDescription
    || dn.designNumber;
  const applicant = dn.applicants?.[0]?.name || dn.applicants?.[0]?.fullName || '—';
  return card(
    dn.designNumber, thumb, 'bi-bounding-box',
    escapeHtml(indication),
    `${escapeHtml(dn.designNumber)} · zgłoszenie ${fmtDate(dn.applicationDate)} · ${escapeHtml(applicant)}`,
    chips
  );
}

/* ======================================================= szczegóły */

const detailForm = document.getElementById('detailForm');
const detailResult = document.getElementById('detailResult');
const detailTable = document.getElementById('detailTable');
const copyDetail = document.getElementById('copyDetail');
let detailPayload = null;

async function loadDetail(id) {
  renderLoading(detailTable);
  copyDetail.classList.add('d-none');
  try {
    const payload = await apiGet(`${RESOURCE}/${encodeURIComponent(id)}`, {
      fields: document.getElementById('detailFields').value.trim(),
      lang: document.getElementById('detailLang').value,
    });
    detailPayload = payload.data;
    renderRecordTable(detailTable, payload.data);
    renderJson(detailResult, payload.data);
    copyDetail.classList.remove('d-none');
    loadDetailAssets(id, payload.data);
  } catch (err) {
    renderError(detailTable, err);
    renderJson(detailResult, err.details ?? null);
    clearDetailAssets('Nie pobrano rekordu — brak informacji o zasobach.');
  }
}

/* ------------------------------- automatyczne pobieranie zasobów rekordu */

const detailAssets = document.getElementById('detailAssets');
const detailAssetsSummary = document.getElementById('detailAssetsSummary');
let assetObjectUrls = [];
let assetsToken = 0;

function clearDetailAssets(message) {
  assetObjectUrls.forEach(URL.revokeObjectURL);
  assetObjectUrls = [];
  detailAssetsSummary.textContent = '';
  detailAssets.innerHTML = `<p class="text-secondary mb-0 small">${escapeHtml(message)}</p>`;
}

/**
 * Lista zasobów do sprawdzenia dla danego rekordu.
 * Rekord szczegółowy sam deklaruje, co posiada (markImage/markSound/… oraz views[]),
 * więc oznaczamy z góry te, których na pewno nie ma — bez zbędnych żądań.
 * Gdy pole zostało odfiltrowane parametrem `fields`, i tak próbujemy pobrać.
 */
function plannedAssets(id, record) {
  const enc = encodeURIComponent(id);
  // Gdy użytkownik zawęził odpowiedź parametrem `fields`, rekord może nie zawierać
  // deklaracji mediów mimo ich istnienia — wtedy sprawdzamy każdy zasób osobno.
  const filtered = Boolean(document.getElementById('detailFields').value.trim());

  if (IS_TM) {
    const present = (key, extra = true) => (filtered ? true : Boolean(record?.[key]) && extra);
    return [
      { label: 'Obraz znaku', kind: 'image', path: `/trademarks/${enc}/image`,
        expected: present('markImage', record?.markFeature !== 'WORD'),
        format: record?.markImage?.imageFormat },
      { label: 'Miniatura', kind: 'image', path: `/trademarks/${enc}/image/thumbnail`,
        expected: present('markImage', record?.markFeature !== 'WORD') },
      { label: 'Dźwięk', kind: 'audio', path: `/trademarks/${enc}/sound`,
        expected: present('markSound'), format: record?.markSound?.soundFormat },
      { label: 'Wideo', kind: 'video', path: `/trademarks/${enc}/video`,
        expected: present('markVideo'), format: record?.markVideo?.videoFormat },
      { label: 'Model 3D', kind: 'binary', path: `/trademarks/${enc}/model`,
        expected: present('markModel'), format: record?.markModel?.modelFormat },
    ];
  }

  // Wzory: liczba widoków wynika z rekordu; bez niego sprawdzamy pierwszy widok.
  const views = Array.isArray(record?.views) && record.views.length
    ? record.views
    : [{ order: 1 }];
  const items = views.map((view) => ({
    label: `Widok ${view.order}`,
    kind: 'image',
    path: `/designs/${enc}/views/${view.order}`,
    expected: true,
    format: view.imageFormat,
  }));
  items.push(
    { label: 'Model 3D', kind: 'binary', path: `/designs/${enc}/model`,
      expected: filtered || Boolean(record?.model || record?.models?.length) },
    { label: 'Wideo', kind: 'video', path: `/designs/${enc}/video`,
      expected: filtered || Boolean(record?.videos?.length) }
  );
  return items;
}

function assetTile(asset) {
  const tile = document.createElement('div');
  tile.className = 'nrn-asset';
  tile.innerHTML = `
    <div class="nrn-asset-head">
      <span class="fw-medium">${escapeHtml(asset.label)}</span>
      ${asset.format ? `<span class="nrn-chip">${escapeHtml(asset.format)}</span>` : ''}
    </div>
    <div class="nrn-asset-body">
      <span class="spinner-border spinner-border-sm text-secondary"></span>
    </div>`;
  return tile;
}

function assetMissing(tile, reason) {
  tile.classList.add('nrn-asset-empty');
  tile.querySelector('.nrn-asset-body').innerHTML =
    `<span class="text-secondary small"><i class="bi bi-slash-circle me-1"></i>${escapeHtml(reason)}</span>`;
}

async function fetchAsset(tile, asset, token) {
  const body = tile.querySelector('.nrn-asset-body');
  try {
    const res = await fetch(apiUrl(asset.path));
    if (token !== assetsToken) return false;

    if (res.status === 404) {
      assetMissing(tile, 'Brak zasobu');
      return false;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      tile.classList.add('nrn-asset-empty');
      body.innerHTML = `<span class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>${
        escapeHtml(data.error || `HTTP ${res.status}`)}</span>`;
      return false;
    }

    const type = res.headers.get('Content-Type') || '';
    const blob = await res.blob();
    if (token !== assetsToken) return false;

    if (!blob.size) {
      assetMissing(tile, 'Brak zasobu');
      return false;
    }

    const objectUrl = URL.createObjectURL(blob);
    assetObjectUrls.push(objectUrl);

    let preview;
    if (type.startsWith('image/')) {
      preview = `<a href="${objectUrl}" target="_blank" rel="noopener"><img src="${objectUrl}" alt="${escapeHtml(asset.label)}"></a>`;
    } else if (type.startsWith('video/')) {
      preview = `<video src="${objectUrl}" controls></video>`;
    } else if (type.startsWith('audio/')) {
      preview = `<audio src="${objectUrl}" controls class="w-100"></audio>`;
    } else {
      preview = `<div class="text-secondary small"><i class="bi bi-file-earmark-binary me-1"></i>${escapeHtml(type || 'plik binarny')}</div>`;
    }

    const name = `${asset.path.split('/').filter(Boolean).slice(1).join('-')}`;
    body.innerHTML = `
      ${preview}
      <div class="nrn-asset-foot">
        ${(blob.size / 1024).toFixed(1)} kB
        <a href="${objectUrl}" download="${escapeHtml(name)}"><i class="bi bi-download"></i></a>
      </div>`;
    return true;
  } catch (err) {
    if (token !== assetsToken) return false;
    tile.classList.add('nrn-asset-empty');
    body.innerHTML = `<span class="text-danger small">${escapeHtml(err.message)}</span>`;
    return false;
  }
}

async function loadDetailAssets(id, record) {
  assetObjectUrls.forEach(URL.revokeObjectURL);
  assetObjectUrls = [];
  const token = ++assetsToken;

  const planned = plannedAssets(id, record);
  const grid = document.createElement('div');
  grid.className = 'nrn-asset-grid';

  const pending = [];
  for (const asset of planned) {
    const tile = assetTile(asset);
    grid.append(tile);
    if (asset.expected) {
      pending.push({ tile, asset });
    } else {
      assetMissing(tile, 'Brak zasobu');
    }
  }

  detailAssets.replaceChildren(grid);
  detailAssetsSummary.textContent = pending.length
    ? `pobieram ${pending.length} z ${planned.length}…`
    : 'rekord nie zawiera żadnych zasobów';

  // Pobieranie w partiach po 3, żeby nie przekroczyć limitów EUIPO.
  let found = 0;
  for (let i = 0; i < pending.length; i += 3) {
    if (token !== assetsToken) return;
    const batch = pending.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(({ tile, asset }) => fetchAsset(tile, asset, token))
    );
    found += results.filter(Boolean).length;
  }

  if (token !== assetsToken) return;
  detailAssetsSummary.textContent = found
    ? `dostępne: ${found} z ${planned.length}`
    : 'brak dostępnych zasobów';
}

detailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadDetail(document.getElementById('detailId').value.trim());
});

copyDetail.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(detailPayload, null, 2));
  copyDetail.innerHTML = '<i class="bi bi-check2"></i> Skopiowano';
  setTimeout(() => { copyDetail.innerHTML = '<i class="bi bi-clipboard"></i> Kopiuj JSON'; }, 1500);
});

function openDetail(id) {
  document.getElementById('detailId').value = id;
  document.querySelector('[data-bs-target="#tab-detail"]').click();
  loadDetail(id);
}

/* ============================================== zapisane zapytania */

const savedList = document.getElementById('savedList');

async function refreshSaved() {
  try {
    const rows = await apiGet(`/saved/${META.id}`);
    if (!rows.length) {
      savedList.innerHTML = 'Brak zapisanych zapytań.';
      return;
    }
    savedList.replaceChildren(...rows.map((row) => {
      const item = document.createElement('div');
      item.className = 'd-flex justify-content-between align-items-center gap-2';
      item.innerHTML = `
        <a href="#" class="text-truncate" title="${escapeHtml(row.params.query || '')}">${escapeHtml(row.name)}</a>
        <button class="btn btn-sm btn-link text-danger p-0"><i class="bi bi-x-lg"></i></button>`;
      item.querySelector('a').addEventListener('click', (event) => {
        event.preventDefault();
        applyParams(row.params);
      });
      item.querySelector('button').addEventListener('click', async () => {
        await fetch(apiUrl(`/saved/${META.id}/${row.id}`), { method: 'DELETE' });
        refreshSaved();
      });
      return item;
    }));
  } catch {
    savedList.innerHTML = 'Nie udało się wczytać listy.';
  }
}

function applyParams(params) {
  manualToggle.checked = true;
  queryInput.readOnly = false;
  queryInput.value = params.query || '';
  document.getElementById('fieldsInput').value = params.fields || '';
  document.getElementById('sizeInput').value = params.size || 10;
  pageInput.value = 0;
  if (params.sort) {
    const [field, dir] = params.sort.split(':');
    document.getElementById('sortField').value = field;
    document.getElementById('sortDir').value = dir || 'asc';
  }
  if (params.lang !== undefined) document.getElementById('langInput').value = params.lang;
  runSearch();
}

document.getElementById('saveQuery').addEventListener('click', async () => {
  const params = currentParams();
  if (!params.query) {
    alert('Najpierw zbuduj zapytanie.');
    return;
  }
  const name = prompt('Nazwa zapytania:', params.query.slice(0, 60));
  if (!name) return;
  await fetch(apiUrl(`/saved/${META.id}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
  });
  refreshSaved();
});

refreshSaved();
