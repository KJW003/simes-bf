require("dotenv").config();
const IORedis = require("ioredis");
const { Pool } = require("pg");
const log = require("./config/logger");

// Validate required env vars
const required = ['CORE_DB_URL', 'TELEMETRY_DB_URL', 'REDIS_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  log.fatal({ missing }, 'Missing required environment variables. Exiting.');
  process.exit(1);
}

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    if (times > 5) {
      log.error("Redis unreachable after 5 retries – giving up");
      return null; // stop retrying
    }
    return Math.min(times * 500, 3000);
  },
});
connection.on("error", (err) => {
  if (err.code === "ECONNREFUSED") {
    log.error("Redis ECONNREFUSED – is Redis running?");
  }
  // ioredis handles reconnection internally; suppress unhandled spam
});

const telemetryDb = new Pool({ connectionString: process.env.TELEMETRY_DB_URL });
const db = new Pool({ connectionString: process.env.CORE_DB_URL });

async function setRunStatus(runId, status, fields = {}) {
  const { result, error, started_at, finished_at } = fields;

  await db.query(
    `UPDATE runs
     SET status = $2,
         result = COALESCE($3::jsonb, result),
         error = COALESCE($4, error),
         started_at = COALESCE($5::timestamptz, started_at),
         finished_at = COALESCE($6::timestamptz, finished_at)
     WHERE id = $1`,
    [
      runId,
      status,
      result ? JSON.stringify(result) : null,
      error ?? null,
      started_at ?? null,
      finished_at ?? null,
    ]
  );
}

async function insertJobResult(runId, type, result, objectKey = null) {
  await db.query(
    `INSERT INTO job_results (run_id, type, result, object_key)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [runId, type, JSON.stringify(result ?? {}), objectKey]
  );
}

module.exports = { connection, db, telemetryDb, setRunStatus, insertJobResult };
