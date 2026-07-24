import { Router } from 'express';
import { uprpRequest, getUprpToken, uprpTokenInfo, UprpError } from '../uprp.js';
import { UPRP } from '../uprp-meta.js';

export const uprpRouter = Router();

function fail(res, err) {
  if (err instanceof UprpError) {
    return res.status(err.status || 502).json({
      error: err.message,
      status: err.status,
      details: err.payload || null,
    });
  }
  console.error('[NEURON]', err);
  return res.status(500).json({ error: err.message || 'Błąd wewnętrzny' });
}

/* ---------------------------------------------------------------- meta */

uprpRouter.get('/meta', (_req, res) => {
  res.json(UPRP);
});

uprpRouter.get('/token', async (_req, res) => {
  try {
    await getUprpToken();
    res.json({ ok: true, ...uprpTokenInfo() });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------------------------------------- słowniki (cache 6 h) */

const DICT_TTL = 6 * 3600_000;
const dictCache = new Map(); // endpoint -> { data, fetchedAt }

async function dictionary(res, endpoint, fallback = null) {
  const cached = dictCache.get(endpoint);
  if (cached && Date.now() - cached.fetchedAt < DICT_TTL) {
    return res.json(cached.data);
  }
  try {
    const { data } = await uprpRequest(endpoint);
    dictCache.set(endpoint, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    if (cached) return res.json(cached.data);
    if (fallback) return res.json(fallback);
    fail(res, err);
  }
}

uprpRouter.get('/attributes', (_req, res) => dictionary(res, '/attributes'));
uprpRouter.get('/collections', (_req, res) => dictionary(res, '/collections'));
uprpRouter.get('/pwp-types', (_req, res) => dictionary(res, '/pwp-types', UPRP.pwpTypesFallback));

/* ------------------------------------------------------------ dane PWP */

uprpRouter.get('/pwp/:pwpNumber', async (req, res) => {
  try {
    const result = await uprpRequest(`/pwp/${encodeURIComponent(req.params.pwpNumber)}`);
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

uprpRouter.get('/changed-since/:since', async (req, res) => {
  try {
    const result = await uprpRequest(
      `/pwps-changed-since/${encodeURIComponent(req.params.since)}`,
      { query: { page: req.query.page, limit: req.query.limit } }
    );
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------- wyszukiwanie zaawansowane */

/** Rejestruje kryteria i zwraca criteriaId do stronicowania wyników. */
uprpRouter.post('/search', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.attributes) || body.attributes.length === 0) {
      return res.status(400).json({ error: 'Podaj co najmniej jeden warunek wyszukiwania.' });
    }
    const { data } = await uprpRequest('/deterministic-search', { method: 'POST', body });
    const criteriaId = typeof data === 'string' ? data : data?.criteriaId;
    if (!criteriaId) {
      return res.status(502).json({ error: 'UPRP nie zwrócił identyfikatora kryteriów.', details: data });
    }
    res.json({ criteriaId });
  } catch (err) {
    fail(res, err);
  }
});

uprpRouter.get('/search-results/:criteriaId', async (req, res) => {
  try {
    const result = await uprpRequest(
      `/search-results/${encodeURIComponent(req.params.criteriaId)}`,
      { query: { page: req.query.page, limit: req.query.limit } }
    );
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

/* --------------------------------------------- publikacje BUP / WUP */

uprpRouter.get('/bibliographics', async (req, res) => {
  try {
    const { publisher, pwp_type, nr_pub, date_start, date_end, format } = req.query;
    if (!publisher || !pwp_type) {
      return res.status(400).json({ error: 'Wymagane parametry: publisher, pwp_type.' });
    }
    const result = await uprpRequest('/search-bibliographics-results', {
      query: { publisher, pwp_type, nr_pub, date_start, date_end },
    });
    if (format === 'xml') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="uprp-${publisher}-${(nr_pub || 'wyniki').replace(/[^\w.-]/g, '_')}.xml"`
      );
      return res.send(result.xml || '');
    }
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});
