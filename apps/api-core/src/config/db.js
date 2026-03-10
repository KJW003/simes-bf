const { Pool } = require("pg");
const { coreDbUrl, telemetryDbUrl } = require("./env");
const log = require("./logger");

let corePool = null;
let telemetryPool = null;

if (!coreDbUrl) {
  log.warn("CORE_DB_URL is missing — core-db pool disabled");
} else {
  corePool = new Pool({
    connectionString: coreDbUrl,
    max: 20,  // Increased from 10 (default) to handle higher concurrency
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  corePool.on("connect", () => log.info("Connected to core-db"));
  corePool.on("error", (err) => log.error({ err: err.message }, "core-db pool error"));
}

if (!telemetryDbUrl) {
  log.warn("TELEMETRY_DB_URL is missing — telemetry-db pool disabled");
} else {
  telemetryPool = new Pool({
    connectionString: telemetryDbUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  telemetryPool.on("connect", () => log.info("Connected to telemetry-db"));
  telemetryPool.on("error", (err) => log.error({ err: err.message }, "telemetry-db pool error"));
}

module.exports = { corePool, telemetryPool };