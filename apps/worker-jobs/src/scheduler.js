const { Queue } = require("bullmq");
const { connection } = require("./shared");
const log = require("./config/logger");

if (!connection) {
  log.warn("Redis not available \u2013 repeatable jobs disabled");
  module.exports = { setupScheduler: async () => {} };
} else {
  const telemetryQueue = new Queue("telemetry", { connection });  const aiQueue = new Queue("ai", { connection });
  async function setupScheduler() {
    try {
      log.info('Initializing cleanup job scheduler');

      // Remove old cleanup jobs if they exist
      const jobs = await telemetryQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.name === "telemetry.cleanup_unmapped_messages") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old cleanup job');
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

      log.info("✓ Cleanup job scheduled: runs every 2 minutes");

      // ── Stale device monitoring: every 5 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_stale_devices") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old stale-check job');
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

      log.info("✓ Stale device check scheduled: runs every 5 minutes (warn=30m, crit=60m)");

      // ── Aggregation gap check: every 15 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_aggregation_gaps") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old agg-gap job');
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

      log.info("✓ Aggregation gap check scheduled: runs every 15 minutes");

      // ── Telemetry aggregation: every hour (last 2h window) ──
      for (const job of jobs) {
        if (job.name === "telemetry.aggregate") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old aggregate job');
        }
      }

      await telemetryQueue.add(
        "telemetry.aggregate",
        { payload: { includeDaily: false } },
        {
          repeat: { pattern: "5 * * * *" }, // Every hour at :05
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 2,
        }
      );

      log.info("✓ Telemetry aggregation scheduled: every hour at :05");

      // ── Queue health check: every 10 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.check_queue_health") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old queue-health job');
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

      log.info("✓ Queue health check scheduled: runs every 10 minutes");

      // ── Pipeline heartbeat: every 10 minutes ──
      for (const job of jobs) {
        if (job.name === "telemetry.pipeline_heartbeat") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old heartbeat job');
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

      log.info("✓ Pipeline heartbeat scheduled: runs every 10 minutes");

      // ── Power peaks computation: daily at 02:00 ──
      for (const job of jobs) {
        if (job.name === "telemetry.compute_power_peaks") {
          await telemetryQueue.removeRepeatableByKey(job.key);
        }
      }

      await telemetryQueue.add(
        "telemetry.compute_power_peaks",
        { payload: {} },
        {
          repeat: { pattern: "0 2 * * *" }, // Daily at 02:00
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 2,
        }
      );

      log.info("✓ Power peaks computation scheduled: daily at 02:00");

      // ── ML forecast retraining: daily at 03:00 ──
      for (const job of jobs) {
        if (job.name === "ai.retrain_forecasts") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old retrain job');
        }
      }

      // Check aiQueue for old retrain jobs too
      const aiJobs = await aiQueue.getRepeatableJobs();
      for (const job of aiJobs) {
        if (job.name === "ai.retrain_forecasts") {
          await aiQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old ai retrain job');
        }
      }

      await aiQueue.add(
        "ai.retrain_forecasts",
        { payload: {} },
        {
          repeat: { pattern: "0 3 * * *" }, // Daily at 03:00
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 2,
        }
      );

      log.info("✓ ML forecast retraining scheduled: daily at 03:00");

      // ── AI anomaly detection: daily at 04:00 ──
      const aiJobsCheck = await aiQueue.getRepeatableJobs();
      for (const job of aiJobsCheck) {
        if (job.name === "ai.detect_anomalies") {
          await aiQueue.removeRepeatableByKey(job.key);
        }
      }

      await aiQueue.add(
        "ai.detect_anomalies",
        { payload: {} },
        {
          repeat: { pattern: "0 4 * * *" }, // Daily at 04:00
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 2,
        }
      );

      log.info("✓ AI anomaly detection scheduled: daily at 04:00");

      // ── Disk recovery (trash cleanup + VACUUM): weekly Sunday at 01:00 ──
      for (const job of jobs) {
        if (job.name === "telemetry.disk_recovery") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old disk-recovery job');
        }
      }

      await telemetryQueue.add(
        "telemetry.disk_recovery",
        { payload: { trash_max_age_days: 7 } },
        {
          repeat: { pattern: "0 1 * * 0" }, // Sunday at 01:00
          removeOnComplete: 5,
          removeOnFail: 10,
          attempts: 1,
        }
      );

      log.info("✓ Disk recovery scheduled: weekly Sunday at 01:00");

      // ── Monthly invoice update: every day at midnight (user local time) ──
      // Note: We run at 00:05 UTC daily to update all terrains' current-month invoices
      // with data collected through yesterday (1-day latency)
      for (const job of jobs) {
        if (job.name === "ai.update_monthly_invoices") {
          await aiQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old invoice update job');
        }
      }

      await aiQueue.add(
        "ai.update_monthly_invoices",
        { payload: { mode: 'auto', timezone: 'Africa/Ouagadougou' } },
        {
          repeat: { pattern: "5 0 * * *" }, // Every day at 00:05 UTC (= 00:05 UTC, adjust for BF time)
          removeOnComplete: 30,  // Keep last 30 successful completions
          removeOnFail: 60,      // Keep last 60 failed attempts for debugging
          attempts: 2,
        }
      );

      log.info("✓ Monthly invoice update scheduled: every day at 00:05 UTC (01:05 BF time)");

      // ── Daily aggregation: midnight UTC to finalize yesterday's complete day ──
      for (const job of jobs) {
        if (job.name === "telemetry.aggregate_daily") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          log.info({ key: job.key }, 'Removed old daily aggregation job');
        }
      }

      await telemetryQueue.add(
        "telemetry.aggregate_daily",
        { payload: {} },
        {
          repeat: { pattern: "0 0 * * *" }, // Daily at 00:00 UTC
          removeOnComplete: 30,
          removeOnFail: 60,
          attempts: 2,
        }
      );

      log.info("✓ Daily aggregation scheduled: midnight UTC (01:00 BF time)");

    } catch (e) {
      log.error(`✗ Failed to setup scheduler: ${e.message}`);
    }
  }

  module.exports = { setupScheduler };
}
