const express = require("express");
const router = express.Router();
const {corePool} = require("../../config/db");

/**
 * GET /results/run/:runId
 * -> retourne tous les résultats d’un run (triés par date)
 */
router.get("/results/run/:runId", async (req, res) => {
  try {
    const { runId } = req.params;

    const r = await corePool.query(
      `SELECT id, run_id, type, result, object_key, created_at
       FROM job_results
       WHERE run_id = $1
       ORDER BY created_at DESC`,
      [runId]
    );

    res.json({ ok: true, runId, results: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /results/:type?runId=...
 * -> retourne le résultat le plus récent de ce type
 *   - si runId fourni : filtre sur run_id
 */
router.get("/results/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { runId } = req.query;

    let r;
    if (runId) {
      r = await corePool.query(
        `SELECT id, run_id, type, result, object_key, created_at
         FROM job_results
         WHERE type = $1 AND run_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [type, runId]
      );
    } else {
      r = await corePool.query(
        `SELECT id, run_id, type, result, object_key, created_at
         FROM job_results
         WHERE type = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [type]
      );
    }

    if (!r.rows.length) return res.status(404).json({ ok: false, error: "result not found" });
    res.json({ ok: true, result: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;