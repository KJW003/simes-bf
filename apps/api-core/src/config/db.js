const { Pool } = require("pg");
const { coreDbUrl, telemetryDbUrl } = require("./env");

let corePool = null;
let telemetryPool = null;

if (!coreDbUrl) {
  console.warn("[db] CORE_DB_URL is missing — core-db pool disabled.");
} else {
  corePool = new Pool({
    connectionString: coreDbUrl,
    max: 20,  // Increased from 10 (default) to handle higher concurrency
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  corePool.on("connect", () => console.log("✅ Connected to core-db"));
  corePool.on("error", (err) => console.error("❌ core-db pool error", err));
}

if (!telemetryDbUrl) {
  console.warn("[db] TELEMETRY_DB_URL is missing — telemetry-db pool disabled.");
} else {
  telemetryPool = new Pool({
    connectionString: telemetryDbUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  telemetryPool.on("connect", () => console.log("✅ Connected to telemetry-db"));
  telemetryPool.on("error", (err) => console.error("❌ telemetry-db pool error", err));
}

module.exports = { corePool, telemetryPool };