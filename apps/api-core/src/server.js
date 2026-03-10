const app = require('./app');
const { port } = require('./config/env');
const { corePool, telemetryPool } = require('./config/db');
const log = require('./config/logger');

const server = app.listen(port, () => {
  log.info({ port }, 'API Core running');
});

// ── Graceful shutdown ──────────────────────────────────────
function shutdown(signal) {
  log.info({ signal }, 'Shutdown signal received, draining…');
  server.close(async () => {
    try {
      if (corePool) await corePool.end();
      if (telemetryPool) await telemetryPool.end();
      log.info('Pools closed. Bye.');
    } catch (err) {
      log.error({ err: err.message }, 'Error during pool shutdown');
    }
    process.exit(0);
  });
  // Force exit after 10s if drain stalls
  setTimeout(() => { log.warn('Forced exit after timeout'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
