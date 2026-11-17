import { config, assertCredentials, validateConfig } from './config.js';

// Walidacja przed otwarciem baz — dlatego reszta aplikacji jest importowana dynamicznie.
const errors = validateConfig();
if (errors.length) {
  for (const message of errors) console.error(`[NEURON] Błąd konfiguracji: ${message}`);
  process.exit(1);
}
assertCredentials();

const { app, version } = await import('./app.js');
const { startScheduler } = await import('./monitor.js');
const { startJobRunner } = await import('./jobs.js');
const { ensureEuipoJobs } = await import('./sync-euipo.js');

app.listen(config.port, config.host, () => {
  console.log(`[NEURON] ${version.label} nasłuchuje na http://${config.host}:${config.port}${config.basePath}`);
  startScheduler();
  ensureEuipoJobs();
  startJobRunner();
});
