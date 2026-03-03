const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult } = require("./shared");

if (!connection) {
  console.warn("[reports-worker] Skipped – no Redis connection.");
  return;
}

new Worker(
  "reports",
  async (job) => {
    const { runId } = job.data;
    await setRunStatus(runId, "running", { started_at: new Date().toISOString() });

    await new Promise((r) => setTimeout(r, 900));
    
    const result = { queue: "reports", name: job.name };
    
   try {
  await insertJobResult(runId, job.name, result);
  console.log("✅ job_results inserted", { runId, type: job.name });
} catch (e) {
  console.error("❌ job_results insert failed", { runId, type: job.name, err: e.message });
} 
    await setRunStatus(runId, "success", {
      finished_at: new Date().toISOString(),
      result,
    });
    return { ok: true };
  },
  { connection }
);

console.log("worker listening: reports");
