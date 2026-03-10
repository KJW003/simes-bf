require("./telemetry.worker");
require("./ai.worker");
require("./reports.worker");

// Setup background cleanup scheduler
const { setupScheduler } = require("./scheduler");
const log = require("./config/logger");
const { connection, db, telemetryDb } = require("./shared");

log.info("Starting scheduler setup...");
setupScheduler().catch(err => log.error({ err: err.message }, "Scheduler setup error"));

// ── Graceful shutdown ──────────────────────────────────────
function shutdown(signal) {
  log.info({ signal }, 'Shutdown signal received, closing workers…');
  const cleanup = async () => {
    try {
      if (connection) await connection.quit();
      if (db) await db.end();
      if (telemetryDb) await telemetryDb.end();
      log.info('Connections closed. Bye.');
    } catch (err) {
      log.error({ err: err.message }, 'Error during worker shutdown');
    }
    process.exit(0);
  };
  cleanup();
  setTimeout(() => { log.warn('Forced exit after timeout'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


