require("dotenv").config();
const IORedis = require("ioredis");
const { Pool } = require("pg");

const redisDisabled =
  String(process.env.DISABLE_REDIS || "").toLowerCase() === "true";
const hasRedisUrl = Boolean(process.env.REDIS_URL);

let connection = null;

if (redisDisabled || !hasRedisUrl) {
  console.warn(
    "[worker-jobs] Redis disabled or REDIS_URL missing – workers will NOT start.\n" +
    "  Set DISABLE_REDIS=false and provide REDIS_URL to enable BullMQ workers."
  );
} else {
  connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 5) {
        console.error("[worker-jobs] Redis unreachable after 5 retries – giving up.");
        return null; // stop retrying
      }
      return Math.min(times * 500, 3000);
    },
  });
  connection.on("error", (err) => {
    if (err.code === "ECONNREFUSED") {
      console.error("[worker-jobs] Redis ECONNREFUSED – is Redis running?");
    }
    // ioredis handles reconnection internally; suppress unhandled spam
  });
}

const telemetryDb = process.env.TELEMETRY_DB_URL
  ? new Pool({ connectionString: process.env.TELEMETRY_DB_URL })
  : null;
const db = process.env.CORE_DB_URL
  ? new Pool({ connectionString: process.env.CORE_DB_URL })
  : null;

async function setRunStatus(runId, status, fields = {}) {
  if (!db) {
    console.warn("[worker-jobs] setRunStatus skipped – CORE_DB_URL not configured.");
    return;
  }
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
  if (!db) {
    console.warn("[worker-jobs] insertJobResult skipped – CORE_DB_URL not configured.");
    return;
  }
  await db.query(
    `INSERT INTO job_results (run_id, type, result, object_key)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [runId, type, JSON.stringify(result ?? {}), objectKey]
  );
}

if (!process.env.TELEMETRY_DB_URL) {
  console.warn("[worker-jobs] TELEMETRY_DB_URL missing – telemetry queries will fail.");
}

module.exports = { connection, db, telemetryDb, setRunStatus, insertJobResult };
