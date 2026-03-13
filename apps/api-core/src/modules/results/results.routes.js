const express = require("express");
const router = express.Router();
const {corePool} = require("../../config/db");

/**
 * GET /results/run/:runId
 * -> retourne tous les résultats d'un run (triés par date)
 * SECURITY: Verify the run belongs to user's organization
 */
router.get("/results/run/:runId", async (req, res) => {
  try {
    const { runId } = req.params;

    // First verify user has access to this run's terrain
    const runCheck = await corePool.query(
      `SELECT r.id, r.payload
       FROM runs r
       WHERE r.id = $1
       LIMIT 1`,
      [runId]
    );

    if (!runCheck.rows.length) {
      return res.status(404).json({ ok: false, error: "run not found" });
    }

    const run = runCheck.rows[0];
    const terrainId = run.payload?.terrain_id;

    if (!terrainId) {
      return res.status(400).json({ ok: false, error: "run does not have terrain identifier" });
    }

    // Verify user has access to this terrain
    if (req.userRole !== "platform_super_admin") {
      const accessCheck = await corePool.query(
        `SELECT t.id FROM terrains t
         JOIN sites s ON s.id = t.site_id
         JOIN users u ON u.organization_id = s.organization_id
         WHERE t.id = $1 AND u.id = $2
         LIMIT 1`,
        [terrainId, req.userId]
      );

      if (!accessCheck.rows.length) {
        return res.status(403).json({ ok: false, error: "Access denied: you do not have permission to access this run" });
      }
    }

    // Now fetch the results
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
 *   - si runId fourni : filtre sur run_id (with access check)
 *   - SECURITY: facture type requires runId parameter (no global fallback)
 */
router.get("/results/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { runId } = req.query;

    // SECURITY FIX: Facture type requires explicit runId
    if (type === "facture" && !runId) {
      return res.status(400).json({ 
        ok: false, 
        error: "facture results require runId parameter. Global facture retrieval is not allowed for security reasons." 
      });
    }

    let r;
    if (runId) {
      // Verify access to the run first
      const runCheck = await corePool.query(
        `SELECT r.id, r.payload
         FROM runs r
         WHERE r.id = $1
         LIMIT 1`,
        [runId]
      );

      if (!runCheck.rows.length) {
        return res.status(404).json({ ok: false, error: "run not found" });
      }

      const run = runCheck.rows[0];
      const terrainId = run.payload?.terrain_id;

      if (!terrainId) {
        return res.status(400).json({ ok: false, error: "run does not have terrain identifier" });
      }

      // Verify user has access to this terrain
      if (req.userRole !== "platform_super_admin") {
        const accessCheck = await corePool.query(
          `SELECT t.id FROM terrains t
           JOIN sites s ON s.id = t.site_id
           JOIN users u ON u.organization_id = s.organization_id
           WHERE t.id = $1 AND u.id = $2
           LIMIT 1`,
          [terrainId, req.userId]
        );

        if (!accessCheck.rows.length) {
          return res.status(403).json({ ok: false, error: "Access denied: you do not have permission to access this run" });
        }
      }

      r = await corePool.query(
        `SELECT id, run_id, type, result, object_key, created_at
         FROM job_results
         WHERE type = $1 AND run_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [type, runId]
      );
    } else {
      // For non-facture types, return latest globally
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
