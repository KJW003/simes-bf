const express = require("express");
const router = express.Router();
const {corePool} = require("../../config/db");
const { pickQueue } = require("../../jobs/dispatch");

// GET /runs
router.get("/", async (req, res) => {
  try {
    const r = await corePool.query(
      `SELECT id, type, status, payload, result, error, created_at, started_at, finished_at
       FROM runs
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /runs/test => debug endpoint; still follows queue dispatch by type
router.post("/test", async (req, res) => {
  try {
    const payload = req.body ?? {};
    const type = payload.jobType || "test";

    const ins = await corePool.query(
      `INSERT INTO runs (type, status, payload)
       VALUES ($1, 'queued', $2::jsonb)
       RETURNING id, type, status, created_at`,
      [type, JSON.stringify(payload)]
    );

    const run = ins.rows[0];
    const queue = pickQueue(type);

    await queue.add(type, { runId: run.id, payload }, { attempts: 1 });

    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
