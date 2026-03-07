const { Queue } = require("bullmq");
const { connection } = require("./shared");
const fs = require("fs");
const path = require("path");

// ─── File logging ──────────────────────────────────────────
const LOG_DIR = "/app/logs";
const LOG_FILE = path.join(LOG_DIR, "scheduler.log");

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (e) {
    // Log dir creation failed
  }
}

function log(prefix, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${prefix}: ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n", { flag: "a" });
  } catch (e) {
    // File logging failed, console is already logged
  }
}

ensureLogDir();

if (!connection) {
  log("scheduler", "⚠ Redis not available – repeatable jobs disabled.");
  module.exports = { setupScheduler: async () => {} };
} else {
  const telemetryQueue = new Queue("telemetry", { connection });

  async function setupScheduler() {
    try {
      log("scheduler", "Initializing cleanup job scheduler...");

      // Remove old cleanup jobs if they exist
      const jobs = await telemetryQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.name === "telemetry.cleanup_unmapped_messages") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log("scheduler", `Removed old cleanup job: ${job.key}`);
        }
      }

      // Add repeatable job: run cleanup every 2 minutes
      await telemetryQueue.add(
        "telemetry.cleanup_unmapped_messages",
        { payload: { limit: 500 } },
        {
          repeat: {
            pattern: "*/2 * * * *", // Every 2 minutes
          },
          removeOnComplete: 10,
          removeOnFail: 20,
          attempts: 1,
        }
      );

      log("scheduler", "✓ Cleanup job scheduled: runs every 2 minutes");

      // ── Stale device monitoring: every 5 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_stale_devices") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log("scheduler", `Removed old stale-check job: ${job.key}`);
        }
      }

      await telemetryQueue.add(
        "telemetry.check_stale_devices",
        { payload: { warn_minutes: 30, critical_minutes: 60 } },
        {
          repeat: {
            pattern: "*/5 * * * *", // Every 5 minutes
          },
          removeOnComplete: 10,
          removeOnFail: 20,
          attempts: 1,
        }
      );

      log("scheduler", "✓ Stale device check scheduled: runs every 5 minutes (warn=30m, crit=60m)");

      // ── Aggregation gap check: every 15 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_aggregation_gaps") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log("scheduler", `Removed old agg-gap job: ${job.key}`);
        }
      }

      await telemetryQueue.add(
        "telemetry.check_aggregation_gaps",
        { payload: { lookback_hours: 6 } },
        {
          repeat: { pattern: "*/15 * * * *" },
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 1,
        }
      );

      log("scheduler", "✓ Aggregation gap check scheduled: runs every 15 minutes");

      // ── Queue health check: every 10 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_queue_health") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log("scheduler", `Removed old queue-health job: ${job.key}`);
        }
      }

      await telemetryQueue.add(
        "telemetry.check_queue_health",
        { payload: { failed_threshold: 20, stuck_threshold_min: 15 } },
        {
          repeat: { pattern: "*/10 * * * *" },
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 1,
        }
      );

      log("scheduler", "✓ Queue health check scheduled: runs every 10 minutes");

      // ── Pipeline heartbeat: every 10 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.pipeline_heartbeat") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log("scheduler", `Removed old heartbeat job: ${job.key}`);
        }
      }

      await telemetryQueue.add(
        "telemetry.pipeline_heartbeat",
        { payload: {} },
        {
          repeat: { pattern: "*/10 * * * *" },
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 1,
        }
      );

      log("scheduler", "✓ Pipeline heartbeat scheduled: runs every 10 minutes");
    } catch (e) {
      log("scheduler", `✗ Failed to setup cleanup job: ${e.message}`);
    }
  }

  module.exports = { setupScheduler };
}
