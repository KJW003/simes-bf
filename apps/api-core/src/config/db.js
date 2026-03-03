const { Pool } = require("pg");
const { coreDbUrl, telemetryDbUrl } = require("./env");

let corePool = null;
let telemetryPool = null;

if (!coreDbUrl) {
  console.warn("[db] CORE_DB_URL is missing — core-db pool disabled.");
} else {
  corePool = new Pool({ connectionString: coreDbUrl });
  corePool.on("connect", () => console.log("✅ Connected to core-db"));
  corePool.on("error", (err) => console.error("❌ core-db pool error", err));
}

if (!telemetryDbUrl) {
  console.warn("[db] TELEMETRY_DB_URL is missing — telemetry-db pool disabled.");
} else {
  telemetryPool = new Pool({ connectionString: telemetryDbUrl });
  telemetryPool.on("connect", () => console.log("✅ Connected to telemetry-db"));
  telemetryPool.on("error", (err) => console.error("❌ telemetry-db pool error", err));
}

module.exports = { corePool, telemetryPool };