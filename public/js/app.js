/* NEURON — wspólne funkcje frontendu */

const BASE = window.NEURON_BASE || '';

/** Ścieżka do lokalnego API proxy. */
export function apiUrl(path, params) {
  const url = new URL(BASE + '/api' + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return url;
}

/**
 * Wygasła sesja bramy hasła — API zwraca 401 zamiast danych.
 * Przerzucamy przeglądarkę na modal logowania z powrotem na bieżącą stronę.
 */
export function redirectIfUnauthorized(res) {
  if (res.status !== 401) return false;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`${BASE}/login?next=${next}`);
  return true;
}

export async function apiGet(path, params) {
  const res = await fetch(apiUrl(path, params), {
    headers: { Accept: 'application/json' },
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

/** Kolorowanie JSON bez zewnętrznych bibliotek. */
export function highlightJson(value) {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return json
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'n';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'k' : 's';
        else if (/true|false|null/.test(match)) cls = 'b';
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

export function renderJson(container, value) {
  container.innerHTML = `<pre class="nrn-json">${highlightJson(value)}</pre>`;
}

export function renderError(container, err) {
  const detail = err.details ? `<pre class="nrn-json mt-2">${highlightJson(err.details)}</pre>` : '';
  container.innerHTML = `
    <div class="alert alert-danger mb-0">
      <i class="bi bi-exclamation-octagon me-1"></i>
      <strong>${err.status ? 'HTTP ' + err.status : 'Błąd'}</strong> — ${escapeHtml(err.message)}
      ${detail}
    </div>`;
}

export function renderLoading(container, text = 'Pobieram dane z EUIPO…') {
  container.innerHTML = `
    <div class="d-flex align-items-center gap-2 text-secondary">
      <span class="spinner-border spinner-border-sm"></span> ${escapeHtml(text)}
    </div>`;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function fmtDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/* --------------------------------------------------- motyw + token */

const THEME_KEY = 'neuron-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-bs-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

async function checkToken() {
  const el = document.getElementById('tokenStatus');
  const stat = document.getElementById('statToken');
  try {
    const info = await apiGet('/token');
    const label = `ważny ${Math.round(info.expiresInSeconds / 60)} min`;
    if (el) {
      el.classList.add('ok');
      el.querySelector('span').textContent = label;
    }
    if (stat) stat.textContent = 'aktywny';
  } catch (err) {
    if (el) {
      el.classList.add('err');
      el.querySelector('span').textContent = 'brak autoryzacji';
      el.title = err.message;
    }
    if (stat) {
      stat.textContent = 'błąd';
      stat.classList.add('text-danger');
    }
  }
}

checkToken();

/** Kafelek stanu tokenu UPRP — tylko na stronie startowej. */
async function checkUprpToken() {
  const stat = document.getElementById('statUprpToken');
  if (!stat) return;
  try {
    const info = await apiGet('/uprp/token');
    stat.textContent = `aktywny (${Math.round(info.expiresInSeconds / 3600)} h)`;
  } catch (err) {
    stat.textContent = 'błąd';
    stat.classList.add('text-danger');
    stat.title = err.message;
  }
}

checkUprpToken();

/* -------------------------------------- badge nowych wpisów przy „Alerty" */

export async function refreshAlertBadge() {
  const link = document.querySelector(`.navbar .nav-link[href$="/alerts"]`);
  if (!link) return;
  try {
    const { newCount } = await apiGet('/alerts/summary');
    let badge = link.querySelector('.nrn-nav-badge');
    if (newCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge text-bg-danger nrn-nav-badge ms-1';
        link.append(badge);
      }
      badge.textContent = newCount;
    } else if (badge) {
      badge.remove();
    }
  } catch {
    /* brak autoryzacji / serwer nie odpowiada — badge po prostu się nie pokaże */
  }
}

refreshAlertBadge();

window.NEURON = { apiGet, apiUrl, renderJson, renderError, renderLoading, escapeHtml, fmtDate };
