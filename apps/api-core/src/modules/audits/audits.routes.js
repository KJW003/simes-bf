const express = require("express");
const router = express.Router();
const { corePool: db } = require("../../config/db");
const { pickQueue, JobTypes } = require("../../jobs/dispatch");
const { requireRole, verifyTerrainAccess } = require("../../shared/auth-middleware");
const log = require("../../config/logger");

// ── Helper: create run + enqueue job (same pattern as jobs.routes.js)
async function createAuditRunAndEnqueue(payload) {
  const ins = await db.query(
    `INSERT INTO runs (type, status, payload)
     VALUES ($1, 'queued', $2::jsonb)
     RETURNING id, type, status, created_at`,
    [JobTypes.ENERGY_AUDIT, JSON.stringify(payload)]
  );
  const run = ins.rows[0];
  const queue = pickQueue(JobTypes.ENERGY_AUDIT);
  await queue.add(JobTypes.ENERGY_AUDIT, { runId: run.id, payload }, { attempts: 2 });
  return run;
}

// ── POST /audits — trigger a new energy audit computation
router.post(
  "/audits",
  requireRole("platform_super_admin", "org_admin"),
  verifyTerrainAccess("body.terrain_id"),
  async (req, res) => {
    try {
      const { terrain_id } = req.body;
      if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });

      const now = new Date();
      const periodTo = now.toISOString();
      const periodFrom = new Date(now.getTime() - 24 * 3600_000).toISOString();

      // Create the audit report record (pending)
      const { rows } = await db.query(
        `INSERT INTO energy_audit_reports (terrain_id, period_from, period_to, status, requested_by)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING id`,
        [terrain_id, periodFrom, periodTo, req.userId]
      );
      const auditId = rows[0].id;

      // Create run + enqueue
      const run = await createAuditRunAndEnqueue({
        terrain_id,
        audit_report_id: auditId,
        period_from: periodFrom,
        period_to: periodTo,
      });

      // Link run to audit report
      await db.query(
        `UPDATE energy_audit_reports SET run_id = $1 WHERE id = $2`,
        [run.id, auditId]
      );

      res.status(201).json({ ok: true, audit_id: auditId, run });
    } catch (e) {
      log.error({ err: e.message }, "[audits] create error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── GET /audits — list audit reports with optional filters
router.get("/audits", async (req, res) => {
  try {
    const { terrain_id, status, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (terrain_id) { conditions.push(`a.terrain_id = $${idx++}`); params.push(terrain_id); }
    if (status) { conditions.push(`a.status = $${idx++}`); params.push(status); }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const limitVal = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetVal = Math.max(Number(offset) || 0, 0);

    const { rows } = await db.query(`
      SELECT a.id, a.terrain_id, a.run_id,
             a.period_from, a.period_to,
             a.efficiency_score, a.score_label,
             a.status, a.error,
             a.kpi,
             a.created_at, a.computed_at,
             t.name AS terrain_name
      FROM energy_audit_reports a
      LEFT JOIN terrains t ON t.id = a.terrain_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limitVal, offsetVal]);

    const countRes = await db.query(
      `SELECT count(*)::int FROM energy_audit_reports a ${where}`,
      params
    );

    res.json({ ok: true, audits: rows, total: countRes.rows[0].count });
  } catch (e) {
    log.error({ err: e.message }, "[audits] list error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /audits/latest/:terrainId — most recent completed audit for a terrain
router.get(
  "/audits/latest/:terrainId",
  verifyTerrainAccess("params.terrainId"),
  async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT a.*, t.name AS terrain_name
        FROM energy_audit_reports a
        LEFT JOIN terrains t ON t.id = a.terrain_id
        WHERE a.terrain_id = $1 AND a.status = 'ready'
        ORDER BY a.computed_at DESC
        LIMIT 1
      `, [req.params.terrainId]);

      if (!rows.length) return res.status(404).json({ ok: false, error: "No completed audit found" });
      res.json({ ok: true, audit: rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── GET /audits/:id — single audit report detail
router.get("/audits/:id", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.*, t.name AS terrain_name
      FROM energy_audit_reports a
      LEFT JOIN terrains t ON t.id = a.terrain_id
      WHERE a.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ ok: false, error: "Audit report not found" });
    res.json({ ok: true, audit: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /audits/:id — delete an audit report (admin only)
router.delete(
  "/audits/:id",
  requireRole("platform_super_admin"),
  async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM energy_audit_reports WHERE id = $1`,
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ ok: false, error: "Audit report not found" });
      res.json({ ok: true, deleted: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

module.exports = router;
