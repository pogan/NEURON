import path from 'node:path';
import express from 'express';
import { config, assertCredentials, assetVersion, ROOT } from './config.js';
import { apiRouter } from './routes/api.js';
import { APIS } from './metadata.js';
import { UPRP } from './uprp-meta.js';
import { queries } from './db.js';
import { startScheduler } from './monitor.js';
import { installAuthGate, authEnabled } from './auth.js';

assertCredentials();

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
// Poprawne req.protocol / X-Forwarded-Proto za NGINX — decyduje o fladze Secure w ciasteczku sesji.
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// Liczona przy starcie — w razie edycji plików wystarczy restart aplikacji (PM2 restart).
const ASSET_V = assetVersion();

const router = express.Router();

// `no-cache` nie wyłącza cache — pozwala go użyć dopiero po rewalidacji (zwykle 304).
// Bez tego przeglądarka trzyma stary CSS/JS aż do wygaśnięcia i nie widzi wdrożonych zmian.
router.use(
  '/static',
  express.static(path.join(ROOT, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

// Poza bramą — sonda dla PM2/monitoringu nie może wymagać logowania.
router.get('/healthz', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), environment: config.euipo.environment })
);

// Od tego miejsca wszystko wymaga sesji (modal z hasłem).
installAuthGate(router, { base: config.basePath, assetVersion: ASSET_V });

router.use('/api', apiRouter);

const nav = [
  { href: '/', icon: 'bi-house', label: 'Start' },
  { href: '/trademarks', icon: 'bi-tag', label: 'Znaki towarowe' },
  { href: '/designs', icon: 'bi-bounding-box', label: 'Wzory' },
  { href: '/uprp', icon: 'bi-bank', label: 'UPRP' },
  { href: '/alerts', icon: 'bi-bell', label: 'Alerty' },
  { href: '/history', icon: 'bi-clock-history', label: 'Historia' },
];

function render(res, view, locals = {}) {
  res.render(view, {
    base: config.basePath,
    nav,
    env: config.euipo.environment,
    v: ASSET_V,
    auth: authEnabled,
    ...locals,
  });
}

router.get('/', (_req, res) => {
  render(res, 'index', {
    page: '/',
    title: 'Start',
    apiHost: config.euipo.apiHost,
    tokenUrl: config.euipo.tokenUrl,
  });
});

router.get('/trademarks', (_req, res) => {
  render(res, 'search', {
    page: '/trademarks',
    title: 'Znaki towarowe',
    api: APIS.trademark,
    apiJson: JSON.stringify(APIS.trademark),
  });
});

router.get('/designs', (_req, res) => {
  render(res, 'search', {
    page: '/designs',
    title: 'Wzory przemysłowe',
    api: APIS.design,
    apiJson: JSON.stringify(APIS.design),
  });
});

router.get('/uprp', (_req, res) => {
  render(res, 'uprp', {
    page: '/uprp',
    title: 'UPRP e-Wyszukiwarka',
    api: UPRP,
    apiJson: JSON.stringify(UPRP),
  });
});

router.get('/alerts', (_req, res) => {
  render(res, 'alerts', { page: '/alerts', title: 'Alerty' });
});

router.get('/history', (_req, res) => {
  render(res, 'history', {
    page: '/history',
    title: 'Historia zapytań',
    logs: queries.recentLogs.all(100),
    stats: queries.stats.all(),
  });
});

app.use(config.basePath || '/', router);

app.use((_req, res) => {
  res.status(404).render('error', {
    base: config.basePath,
    nav,
    env: config.euipo.environment,
    v: ASSET_V,
    auth: authEnabled,
    page: '',
    title: 'Nie znaleziono',
    code: 404,
    message: 'Taka strona nie istnieje.',
  });
});

app.use((err, _req, res, _next) => {
  console.error('[NEURON]', err);
  res.status(500).render('error', {
    base: config.basePath,
    nav,
    env: config.euipo.environment,
    v: ASSET_V,
    auth: authEnabled,
    page: '',
    title: 'Błąd',
    code: 500,
    message: err.message || 'Błąd wewnętrzny serwera.',
  });
});

app.listen(config.port, config.host, () => {
  console.log(`[NEURON] nasłuchuje na http://${config.host}:${config.port}${config.basePath}`);
  startScheduler();
});
