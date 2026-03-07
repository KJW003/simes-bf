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
      const jobs = await telemetryQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.name === "telemetry.cleanup_unmapped_messages") {
          await telemetryQueue.removeRepeatableByKey(job.key);
          console.log("[scheduler] Removed old cleanup job:", job.key);
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

      console.log("[scheduler] ✓ Cleanup job scheduled: runs every 2 minutes");
    } catch (e) {
      console.error("[scheduler] Failed to setup cleanup job:", e.message);
    }
  }

  module.exports = { setupScheduler };
}
