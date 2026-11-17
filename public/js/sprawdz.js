import { apiGet, escapeHtml, fmtDate, renderError, renderLoading } from './app.js';

const form = document.getElementById('checkForm');
const input = document.getElementById('checkName');
const submit = document.getElementById('checkSubmit');
const result = document.getElementById('checkResult');

const DOMAIN_STATUS = {
  free: { label: 'wolna', cls: 'text-bg-success', icon: 'bi-check-circle' },
  taken: { label: 'zajęta', cls: 'text-bg-secondary', icon: 'bi-x-circle' },
  unknown: { label: 'nie wiadomo', cls: 'text-bg-warning', icon: 'bi-question-circle' },
};

const REGISTRY = { euipo: 'Cała UE (EUIPO)', uprp: 'Polska (UPRP)' };

function domainsHtml(domains) {
  if (!domains.length) return '<p class="text-secondary mb-0">Z tej nazwy nie da się utworzyć adresu domeny.</p>';
  const rows = domains.map((d) => {
    const s = DOMAIN_STATUS[d.status] || DOMAIN_STATUS.unknown;
    const approx = d.method === 'dns' && d.status !== 'unknown'
      ? ' <span class="small text-secondary">(orientacyjnie)</span>' : '';
    return `<li class="d-flex justify-content-between align-items-center py-2 border-bottom">
      <span class="font-mono">${escapeHtml(d.domain)}</span>
      <span><span class="badge ${s.cls}"><i class="bi ${s.icon} me-1"></i>${s.label}</span>${approx}</span>
    </li>`;
  });
  return `<ul class="list-unstyled mb-0">${rows.join('')}</ul>`;
}

function socialHtml(social) {
  if (!social.length) return '';
  const links = social.map((s) => `<li class="py-2 border-bottom">
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(s.label)}: <span class="font-mono">${escapeHtml(s.handle)}</span>
        <i class="bi bi-box-arrow-up-right small ms-1"></i></a>
    </li>`);
  return `<ul class="list-unstyled mb-2">${links.join('')}</ul>
    <p class="small text-secondary mb-0">Platformy nie pozwalają sprawdzać tego automatycznie.
    Otwórz link: jeśli pokaże się profil, nazwa jest zajęta.</p>`;
}

function trademarksHtml({ registry, matches }) {
  const total = Object.values(registry).reduce((a, b) => a + b, 0);
  const coverage = total
    ? `Przeszukano ${total.toLocaleString('pl-PL')} znaków w lokalnej kopii rejestrów
       (${Object.entries(registry).map(([k, n]) => `${REGISTRY[k] || k}: ${n.toLocaleString('pl-PL')}`).join(', ')}).
       Kopia jest jeszcze uzupełniana.`
    : 'Lokalna kopia rejestrów jest jeszcze pusta — import trwa.';

  if (!matches.length) {
    return `<p class="mb-2">Nie znaleźliśmy znaków zawierających tę nazwę.</p>
      <p class="small text-secondary mb-0">${coverage} To nie znaczy, że nie ma znaków podobnych
      brzmieniowo — tego dotyczy pełne badanie nazwy.</p>`;
  }
  const items = matches.map((m) => `<li class="py-2 border-bottom">
      <div class="d-flex justify-content-between gap-2 flex-wrap">
        <strong>${escapeHtml(m.name || '(bez nazwy)')}</strong>
        ${m.exact ? '<span class="badge text-bg-danger">identyczna nazwa</span>' : ''}
      </div>
      <div class="small text-secondary">
        ${escapeHtml(REGISTRY[m.source] || m.source)} · ${escapeHtml(m.status || 'status nieznany')}
        · zgłoszono ${escapeHtml(fmtDate(m.applicationDate) || '—')}
        ${m.applicants[0]?.name ? `· ${escapeHtml(m.applicants[0].name)}` : ''}
      </div>
      <details class="small mt-1"><summary>Szczegóły</summary>
        Numer zgłoszenia: <span class="font-mono">${escapeHtml(m.number)}</span><br>
        Klasy nicejskie: ${m.niceClasses.length ? escapeHtml(m.niceClasses.join(', ')) : '—'}
      </details>
    </li>`);
  return `<ul class="list-unstyled mb-2">${items.join('')}</ul>
    <p class="small text-secondary mb-0">${coverage}</p>`;
}

function render(data) {
  result.innerHTML = `
    <div class="row g-4">
      <div class="col-lg-6">
        <section class="nrn-panel h-100">
          <h2 class="h5 mb-3"><i class="bi bi-shield-check me-1"></i>Znaki towarowe</h2>
          ${trademarksHtml(data.trademarks)}
          <div class="alert alert-info small mt-3 mb-0">
            Wolna domena to nie wszystko. Czy nazwa nie narusza cudzego znaku w UE albo w Polsce,
            pokaże pełne badanie nazwy (wkrótce).
          </div>
        </section>
      </div>
      <div class="col-lg-6 vstack gap-4">
        <section class="nrn-panel">
          <h2 class="h5 mb-3"><i class="bi bi-globe me-1"></i>Domeny</h2>
          ${domainsHtml(data.domains)}
        </section>
        <section class="nrn-panel">
          <h2 class="h5 mb-3"><i class="bi bi-people me-1"></i>Konta w social mediach</h2>
          ${socialHtml(data.social)}
        </section>
      </div>
    </div>`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = input.value.trim();
  if (!name) return;
  submit.disabled = true;
  renderLoading(result, 'Sprawdzam domeny i rejestry…');
  try {
    render(await apiGet('/check', { name }));
    history.replaceState(null, '', `?nazwa=${encodeURIComponent(name)}`);
  } catch (err) {
    renderError(result, err);
  } finally {
    submit.disabled = false;
  }
});

const initial = new URLSearchParams(location.search).get('nazwa');
if (initial) {
  input.value = initial;
  form.requestSubmit();
}
