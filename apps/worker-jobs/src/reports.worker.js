const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult } = require("./shared");
const log = require("./config/logger");

if (!connection) {
  log.warn("reports-worker skipped – no Redis connection");
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
  log.info({ runId, type: job.name }, 'job_results inserted');
} catch (e) {
  log.error({ runId, type: job.name, err: e.message }, 'job_results insert failed');
} 
    await setRunStatus(runId, "success", {
      finished_at: new Date().toISOString(),
      result,
    });
    return { ok: true };
  },
  { connection }
);

log.info("worker listening: reports");
