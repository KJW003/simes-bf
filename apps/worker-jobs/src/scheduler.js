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
    } catch (e) {
      log("scheduler", `✗ Failed to setup cleanup job: ${e.message}`);
    }
  }

  module.exports = { setupScheduler };
}
