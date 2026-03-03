const express = require("express");
const {corePool} = require("../../config/db");
const { pickQueue, JobTypes } = require("../../jobs/dispatch");

const router = express.Router();

async function createRunAndEnqueue(type, payload) {
  const safePayload = payload ?? {};
  const ins = await corePool.query(
    `INSERT INTO runs (type, status, payload)
     VALUES ($1, 'queued', $2::jsonb)
     RETURNING id, type, status, created_at`,
    [type, JSON.stringify(safePayload)]
  );

  const run = ins.rows[0];
  const queue = pickQueue(type);

  await queue.add(type, { runId: run.id, payload: safePayload }, { attempts: 1 });

  return run;
}

router.post("/jobs/forecast", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.FORECAST, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/facture", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.FACTURE, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/audit-pv", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.AUDIT_PV, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/roi", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.ROI, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/report", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.REPORT, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/aggregate", async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.AGGREGATE, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
module.exports = router;
