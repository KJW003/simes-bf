const log = require("./logger");
const { Pool } = require("pg");
const { coreDbUrl, telemetryDbUrl } = require("./env");

let corePool = null;
let telemetryPool = null;

if (!coreDbUrl) {
  log.warn("[db] CORE_DB_URL is missing — core-db pool disabled.");
} else {
  corePool = new Pool({ connectionString: coreDbUrl });
  corePool.on("connect", () => log.info("Connected to core-db"));
  corePool.on("error", (err) => log.error({ err: err.message }, "core-db pool error"));
}

if (!telemetryDbUrl) {
  log.warn("[db] TELEMETRY_DB_URL is missing — telemetry-db pool disabled.");
} else {
  telemetryPool = new Pool({ connectionString: telemetryDbUrl });
  telemetryPool.on("connect", () => log.info("Connected to telemetry-db"));
  telemetryPool.on("error", (err) => log.error({ err: err.message }, "telemetry-db pool error"));
}

module.exports = { corePool, telemetryPool };
