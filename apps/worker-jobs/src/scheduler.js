const { Queue } = require("bullmq");
const { connection } = require("./shared");

if (!connection) {
  console.warn("[scheduler] Redis not available – repeatable jobs disabled.");
  module.exports = { setupScheduler: async () => {} };
} else {
  const telemetryQueue = new Queue("telemetry", { connection });

  async function setupScheduler() {
    try {
      // Remove old cleanup jobs if they exist
      const existingJobs = await telemetryQueue.getRepeatableCount();
      if (existingJobs > 0) {
        const jobs = await telemetryQueue.getRepeatableJobs();
        for (const job of jobs) {
          if (job.name === "telemetry.cleanup_unmapped_messages") {
            await telemetryQueue.removeRepeatableByKey(job.key);
            console.log("[scheduler] Removed old cleanup job");
          }
        }
      }

      // Add repeatable job: run cleanup every 5 minutes
      await telemetryQueue.add(
        "telemetry.cleanup_unmapped_messages",
        { limit: 500 }, // Process max 500 messages per run
        {
          repeat: {
            pattern: "*/5 * * * *", // Every 5 minutes (cron pattern)
          },
          removeOnComplete: true, // Remove job after completion
          removeOnFail: false,    // Keep failed jobs for inspection
          attempts: 1,
        }
      );

      console.log("[scheduler] ✓ Cleanup job scheduled: runs every 5 minutes");
    } catch (e) {
      console.error("[scheduler] Failed to setup cleanup job:", e.message);
    }
  }

  module.exports = { setupScheduler };
}
