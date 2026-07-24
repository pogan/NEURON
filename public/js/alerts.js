/* NEURON — strona alertów (monitoring EUIPO) */

const V = new URL(import.meta.url).search;
const { apiGet, apiUrl, renderError, escapeHtml, fmtDate, refreshAlertBadge, redirectIfUnauthorized } =
  await import('./app.js' + V);
const { renderRecordTable, formatScalar } = await import('./record-table.js' + V);

const listBox = document.getElementById('alertsList');
const form = document.getElementById('alertForm');
const apiSelect = document.getElementById('alertApi');
const patternInput = document.getElementById('alertPattern');
const nameInput = document.getElementById('alertName');
const preview = document.getElementById('alertQueryPreview');
const submitBtn = document.getElementById('alertSubmit');

const API_LABEL = { trademark: 'znaki', design: 'wzory' };

async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (redirectIfUnauthorized(res)) throw new Error('Sesja wygasła — trwa przekierowanie do logowania.');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

/* --------------------------------------------------- podgląd zapytania */

async function updatePreview() {
  const pattern = patternInput.value.trim();
  if (!pattern) {
    preview.textContent = '—';
    return;
  }
  try {
    const data = await apiGet('/alerts/preview', { api: apiSelect.value, pattern });
    preview.textContent = data.query;
    preview.classList.remove('text-danger');
  } catch (err) {
    preview.textContent = err.message;
    preview.classList.add('text-danger');
  }
}

patternInput.addEventListener('input', updatePreview);
apiSelect.addEventListener('change', updatePreview);

/* -------------------------------------------------------- lista alertów */

function alertCard(alert) {
  const card = document.createElement('div');
  card.className = 'nrn-panel nrn-alert';
  card.dataset.id = alert.id;

  const paused = !alert.active;
  const statusBadge =
    alert.last_status === 'error'
      ? `<span class="badge text-bg-danger" title="${escapeHtml(alert.last_error || '')}">błąd</span>`
      : paused
        ? '<span class="badge text-bg-secondary">wstrzymany</span>'
        : '<span class="badge text-bg-success">aktywny</span>';
  const newBadge = alert.new_count > 0
    ? `<span class="badge text-bg-danger">${alert.new_count} ${alert.new_count === 1 ? 'nowy' : 'nowych'}</span>`
    : '';

  card.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
      <div>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <strong>${escapeHtml(alert.name)}</strong>
          <span class="nrn-chip">${API_LABEL[alert.api] || alert.api}</span>
          ${statusBadge} ${newBadge}
        </div>
        <div class="small text-secondary mt-1">
          wzorzec: <code>${escapeHtml(alert.pattern)}</code>
          · rekordów: <strong>${alert.record_count}</strong>${alert.total_records > alert.record_count ? ` z ${alert.total_records} w EUIPO` : ''}
          · ostatnie sprawdzenie: ${alert.last_check_at ? escapeHtml(alert.last_check_at) + ' UTC' : 'jeszcze nie'}
        </div>
      </div>
      <div class="btn-group btn-group-sm">
        <button class="btn btn-outline-secondary" data-action="expand" title="Pokaż rekordy">
          <i class="bi bi-chevron-down"></i>
        </button>
        <button class="btn btn-outline-secondary" data-action="check" title="Sprawdź teraz">
          <i class="bi bi-arrow-repeat"></i>
        </button>
        <button class="btn btn-outline-secondary" data-action="toggle" title="${paused ? 'Wznów' : 'Wstrzymaj'}">
          <i class="bi ${paused ? 'bi-play' : 'bi-pause'}"></i>
        </button>
        <button class="btn btn-outline-danger" data-action="delete" title="Usuń alert">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>
    <div class="nrn-alert-detail mt-3 d-none"></div>`;

  card.querySelector('[data-action="expand"]').addEventListener('click', (event) =>
    toggleDetail(card, alert, event.currentTarget)
  );
  card.querySelector('[data-action="check"]').addEventListener('click', (event) =>
    checkNow(alert, event.currentTarget)
  );
  card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
    await apiPost(`/alerts/${alert.id}/toggle`);
    refresh();
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Usunąć alert „${alert.name}" wraz z historią?`)) return;
    await fetch(apiUrl(`/alerts/${alert.id}`), { method: 'DELETE' });
    refresh();
  });

  return card;
}

async function refresh() {
  try {
    const alerts = await apiGet('/alerts');
    if (!alerts.length) {
      listBox.innerHTML =
        '<div class="nrn-panel text-secondary">Brak alertów — utwórz pierwszy, podając wzorzec z wildcard.</div>';
    } else {
      listBox.replaceChildren(...alerts.map(alertCard));
    }
    refreshAlertBadge();
  } catch (err) {
    renderError(listBox, err);
  }
}

/* --------------------------------------------------- szczegóły (akordeon) */

function thumbUrlFor(api, recordId) {
  return api === 'trademark'
    ? apiUrl(`/trademarks/${encodeURIComponent(recordId)}/image/thumbnail`).toString()
    : apiUrl(`/designs/${encodeURIComponent(recordId)}/views/1/thumbnail`).toString();
}

function recordTitle(api, snapshot, recordId) {
  if (api === 'trademark') {
    return snapshot.wordMarkSpecification?.verbalElement || recordId;
  }
  return snapshot.verbalElement || recordId;
}

function accordionItem(alert, record, index) {
  const snap = record.snapshot;
  const title = recordTitle(alert.api, snap, record.record_id);
  const headId = `al${alert.id}h${index}`;
  const bodyId = `al${alert.id}b${index}`;

  const item = document.createElement('div');
  item.className = 'accordion-item';
  item.innerHTML = `
    <h2 class="accordion-header" id="${headId}">
      <button class="accordion-button collapsed gap-2" type="button"
              data-bs-toggle="collapse" data-bs-target="#${bodyId}">
        <img class="nrn-alert-thumb" src="${thumbUrlFor(alert.api, record.record_id)}"
             alt="" loading="lazy"
             onerror="this.classList.add('nrn-thumb-missing');this.removeAttribute('src')">
        <span class="flex-grow-1 min-w-0">
          <span class="fw-semibold">${escapeHtml(title)}</span>
          <span class="d-block small text-secondary">
            ${escapeHtml(record.record_id)}
            · zgłoszenie ${fmtDate(snap.applicationDate)}
            · ${snap.status ? formatScalar(snap.status) : '—'}
          </span>
        </span>
        ${record.is_new ? '<span class="badge text-bg-danger me-2">NOWY</span>' : ''}
      </button>
    </h2>
    <div id="${bodyId}" class="accordion-collapse collapse" data-bs-parent="#alertAcc${alert.id}">
      <div class="accordion-body"></div>
    </div>`;

  // Tabela rekordu renderowana leniwie przy pierwszym rozwinięciu
  const collapseEl = item.querySelector('.accordion-collapse');
  collapseEl.addEventListener('show.bs.collapse', () => {
    const body = collapseEl.querySelector('.accordion-body');
    if (!body.dataset.rendered) {
      renderRecordTable(body, snap);
      body.dataset.rendered = '1';
    }
  }, { once: true });

  return item;
}

async function toggleDetail(card, alert, button) {
  const box = card.querySelector('.nrn-alert-detail');
  if (!box.classList.contains('d-none')) {
    box.classList.add('d-none');
    button.innerHTML = '<i class="bi bi-chevron-down"></i>';
    return;
  }
  button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  try {
    const data = await apiGet(`/alerts/${alert.id}`);
    box.innerHTML = '';

    if (data.alert.last_status === 'error') {
      box.insertAdjacentHTML('beforeend', `<div class="alert alert-danger small py-2">
        <i class="bi bi-exclamation-triangle me-1"></i>${escapeHtml(data.alert.last_error || 'Błąd sprawdzania')}
      </div>`);
    }

    const newCount = data.records.filter((r) => r.is_new).length;
    if (newCount) {
      const ack = document.createElement('div');
      ack.className = 'd-flex justify-content-end mb-2';
      ack.innerHTML = `<button class="btn btn-sm btn-outline-secondary">
        <i class="bi bi-check2-all me-1"></i>Oznacz ${newCount} ${newCount === 1 ? 'nowy wpis' : 'nowe wpisy'} jako przeczytane
      </button>`;
      ack.querySelector('button').addEventListener('click', async () => {
        await apiPost(`/alerts/${alert.id}/ack`);
        refresh();
      });
      box.append(ack);
    }

    if (!data.records.length) {
      box.insertAdjacentHTML('beforeend', '<p class="text-secondary small mb-0">Brak rekordów pasujących do wzorca — alert czeka na pierwsze zgłoszenie.</p>');
    } else {
      const acc = document.createElement('div');
      acc.className = 'accordion';
      acc.id = `alertAcc${alert.id}`;
      data.records.forEach((record, index) => acc.append(accordionItem(alert, record, index)));
      box.append(acc);
    }

    if (data.checks.length) {
      const last = data.checks
        .slice(0, 5)
        .map((c) => `${c.checked_at} — ${c.status === 'ok' ? `${c.found_total} rekordów, nowych: ${c.new_count}` : escapeHtml(c.error || 'błąd')}`)
        .join('<br>');
      box.insertAdjacentHTML('beforeend', `<div class="small text-secondary mt-3 border-top pt-2">
        <strong>Ostatnie sprawdzenia (UTC):</strong><br>${last}</div>`);
    }

    box.classList.remove('d-none');
    button.innerHTML = '<i class="bi bi-chevron-up"></i>';
  } catch (err) {
    renderError(box, err);
    box.classList.remove('d-none');
    button.innerHTML = '<i class="bi bi-chevron-down"></i>';
  }
}

async function checkNow(alert, button) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  try {
    const result = await apiPost(`/alerts/${alert.id}/check`);
    if (result.newRecords.length) {
      alertToast(`Alert „${alert.name}": wykryto ${result.newRecords.length} nowych wpisów!`, 'danger');
    } else {
      alertToast(`Alert „${alert.name}": brak nowych wpisów (${result.found} rekordów).`, 'success');
    }
  } catch (err) {
    alertToast(`Błąd sprawdzania: ${err.message}`, 'danger');
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    refresh();
  }
}

/* --------------------------------------------------------------- toast */

function alertToast(message, kind) {
  const el = document.createElement('div');
  el.className = `alert alert-${kind} nrn-toast shadow`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

/* ------------------------------------------------------------ tworzenie */

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Pobieram stan początkowy…';
  try {
    const result = await apiPost('/alerts', {
      api: apiSelect.value,
      pattern: patternInput.value,
      name: nameInput.value,
    });
    const total = result.found ?? result.alert.total_records ?? 0;
    alertToast(
      result.error
        ? `Alert utworzony, ale seed się nie powiódł: ${result.error}`
        : `Alert utworzony — stan początkowy: ${total} rekordów${result.truncated ? ' (przycięty do 1000 najnowszych)' : ''}.`,
      result.error ? 'warning' : 'success'
    );
    form.reset();
    preview.textContent = '—';
    refresh();
  } catch (err) {
    alertToast(err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-bell-fill me-1"></i> Utwórz alert i pobierz stan początkowy';
  }
});

refresh();
