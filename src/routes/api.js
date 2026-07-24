import { Router } from 'express';
import { Readable } from 'node:stream';
import { euipoRequest, getAccessToken, tokenInfo, EuipoError } from '../euipo.js';
import { queries } from '../db.js';
import { APIS } from '../metadata.js';
import { config } from '../config.js';
import { createAlert, runAlertCheck, buildAlertQuery, AlertError } from '../monitor.js';
import { uprpRouter } from './uprp.js';

export const apiRouter = Router();

apiRouter.use('/uprp', uprpRouter);

function fail(res, err) {
  if (err instanceof AlertError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (err instanceof EuipoError) {
    return res.status(err.status || 502).json({
      error: err.message,
      status: err.status,
      details: err.payload || null,
    });
  }
  console.error('[NEURON]', err);
  return res.status(500).json({ error: err.message || 'Błąd wewnętrzny' });
}

/** Wspólne parametry wyszukiwania. */
function searchParams(req) {
  const { query, fields, page, size, sort } = req.query;
  return { query, fields, page, size, sort };
}

function langOf(req) {
  return req.query.lang || req.get('X-Accept-Language') || undefined;
}

async function pipeAsset(res, api, endpoint) {
  const asset = await euipoRequest(api, endpoint, { raw: true, accept: '*/*' });
  res.setHeader('Content-Type', asset.contentType);
  if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  Readable.fromWeb(asset.stream).pipe(res);
}

/* ---------------------------------------------------------------- meta */

apiRouter.get('/meta', (_req, res) => {
  res.json(APIS);
});

apiRouter.get('/token', async (_req, res) => {
  try {
    await getAccessToken();
    res.json({
      ok: true,
      environment: config.euipo.environment,
      isSandbox: config.euipo.isSandbox,
      ...tokenInfo(),
    });
  } catch (err) {
    fail(res, err);
  }
});

/* ----------------------------------------------------------- trademarks */

apiRouter.get('/trademarks', async (req, res) => {
  try {
    const result = await euipoRequest('trademark', '/trademarks', {
      query: searchParams(req),
      acceptLanguage: langOf(req),
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.get('/trademarks/:applicationNumber', async (req, res) => {
  try {
    const result = await euipoRequest(
      'trademark',
      `/trademarks/${encodeURIComponent(req.params.applicationNumber)}`,
      { query: { fields: req.query.fields }, acceptLanguage: langOf(req) }
    );
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

for (const [route, path] of [
  ['image', '/image'],
  ['image/thumbnail', '/image/thumbnail'],
  ['sound', '/sound'],
  ['video', '/video'],
  ['model', '/model'],
]) {
  apiRouter.get(`/trademarks/:applicationNumber/${route}`, async (req, res) => {
    try {
      await pipeAsset(
        res,
        'trademark',
        `/trademarks/${encodeURIComponent(req.params.applicationNumber)}${path}`
      );
    } catch (err) {
      fail(res, err);
    }
  });
}

/* -------------------------------------------------------------- designs */

apiRouter.get('/designs', async (req, res) => {
  try {
    const result = await euipoRequest('design', '/designs', {
      query: searchParams(req),
      acceptLanguage: langOf(req),
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.get('/designs/:designNumber', async (req, res) => {
  try {
    const result = await euipoRequest(
      'design',
      `/designs/${encodeURIComponent(req.params.designNumber)}`,
      { query: { fields: req.query.fields }, acceptLanguage: langOf(req) }
    );
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.get('/designs/:designNumber/views/:order', async (req, res) => {
  try {
    await pipeAsset(
      res,
      'design',
      `/designs/${encodeURIComponent(req.params.designNumber)}/views/${encodeURIComponent(req.params.order)}`
    );
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.get('/designs/:designNumber/views/:order/thumbnail', async (req, res) => {
  try {
    await pipeAsset(
      res,
      'design',
      `/designs/${encodeURIComponent(req.params.designNumber)}/views/${encodeURIComponent(req.params.order)}/thumbnail`
    );
  } catch (err) {
    fail(res, err);
  }
});

for (const path of ['model', 'video']) {
  apiRouter.get(`/designs/:designNumber/${path}`, async (req, res) => {
    try {
      await pipeAsset(
        res,
        'design',
        `/designs/${encodeURIComponent(req.params.designNumber)}/${path}`
      );
    } catch (err) {
      fail(res, err);
    }
  });
}

/* ---------------------------------------------------------- alerty */

const env = () => config.euipo.environment;

/** Alert musi istnieć i należeć do bieżącego środowiska. */
function findAlert(req, res) {
  const alert = queries.getAlert.get(Number(req.params.id));
  if (!alert || alert.environment !== env()) {
    res.status(404).json({ error: 'Nie znaleziono alertu.' });
    return null;
  }
  return alert;
}

apiRouter.get('/alerts', (_req, res) => {
  res.json(queries.listAlerts.all(env()));
});

apiRouter.get('/alerts/summary', (_req, res) => {
  res.json({ newCount: queries.newCountTotal.get(env()).new_count });
});

apiRouter.post('/alerts', async (req, res) => {
  try {
    const { api, name, pattern } = req.body || {};
    if (api !== 'trademark' && api !== 'design') {
      throw new AlertError(400, 'Pole api musi mieć wartość trademark albo design.');
    }
    const result = await createAlert({ api, name, pattern });
    res.status(201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

/** Podgląd RSQL generowanego z wzorca (dla formularza). */
apiRouter.get('/alerts/preview', (req, res) => {
  try {
    const { api, pattern } = req.query;
    res.json({ query: buildAlertQuery(api, pattern) });
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.get('/alerts/:id', (req, res) => {
  const alert = findAlert(req, res);
  if (!alert) return;
  const records = queries.alertRecords.all(alert.id).map((row) => ({
    ...row,
    snapshot: JSON.parse(row.snapshot),
  }));
  res.json({ alert, records, checks: queries.alertChecks.all(alert.id) });
});

apiRouter.post('/alerts/:id/check', async (req, res) => {
  const alert = findAlert(req, res);
  if (!alert) return;
  try {
    const result = await runAlertCheck(alert);
    res.json({ alert: queries.getAlert.get(alert.id), ...result });
  } catch (err) {
    fail(res, err);
  }
});

apiRouter.post('/alerts/:id/ack', (req, res) => {
  const alert = findAlert(req, res);
  if (!alert) return;
  queries.ackAlertRecords.run(alert.id);
  res.json({ ok: true });
});

apiRouter.post('/alerts/:id/toggle', (req, res) => {
  const alert = findAlert(req, res);
  if (!alert) return;
  queries.toggleAlert.run(alert.id);
  res.json({ alert: queries.getAlert.get(alert.id) });
});

apiRouter.delete('/alerts/:id', (req, res) => {
  const alert = findAlert(req, res);
  if (!alert) return;
  queries.deleteAlert.run(alert.id);
  res.status(204).end();
});

/* ------------------------------------------------- historia i zapisane */

apiRouter.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(queries.recentLogs.all(limit));
});

apiRouter.get('/stats', (_req, res) => {
  res.json(queries.stats.all());
});

apiRouter.get('/saved/:api', (req, res) => {
  const rows = queries.listSaved.all(req.params.api).map((row) => ({
    ...row,
    params: JSON.parse(row.params),
  }));
  res.json(rows);
});

apiRouter.post('/saved/:api', (req, res) => {
  const { name, params } = req.body || {};
  if (!name || !params) {
    return res.status(400).json({ error: 'Wymagane pola: name, params' });
  }
  const info = queries.insertSaved.run(req.params.api, name, JSON.stringify(params));
  res.status(201).json({ id: info.lastInsertRowid });
});

apiRouter.delete('/saved/:api/:id', (req, res) => {
  queries.deleteSaved.run(Number(req.params.id));
  res.status(204).end();
});
