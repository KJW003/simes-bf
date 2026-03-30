const express = require("express");
const router = express.Router();
const { corePool: db } = require("../../config/db");
const { requireAuth, requireRole, verifyTerrainAccess } = require("../../shared/auth-middleware");
const { validate } = require("../../shared/validate");
const { createPvSystemSchema, updatePvSystemSchema, assignPointToPvSystemSchema } = require("../../shared/schemas");
const log = require("../../config/logger");

// ── POST /pv/systems — create a PV system
router.post(
  "/pv/systems",
  requireRole("platform_super_admin", "org_admin"),
  verifyTerrainAccess("body.terrain_id"),
  validate(createPvSystemSchema),
  async (req, res) => {
    try {
      const { terrain_id, name, description, location, installed_capacity_kwc, installation_date, expected_tilt_degrees, expected_orientation } = req.body;

      const r = await db.query(
        `INSERT INTO pv_systems (terrain_id, name, description, location, installed_capacity_kwc, installation_date, expected_tilt_degrees, expected_orientation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, terrain_id, name, description, location, installed_capacity_kwc, installation_date, expected_tilt_degrees, expected_orientation, created_at`,
        [terrain_id, name, description ?? null, location ?? null, installed_capacity_kwc ?? null, installation_date ?? null, expected_tilt_degrees ?? null, expected_orientation ?? null]
      );

      res.status(201).json({ ok: true, system: r.rows[0] });
    } catch (e) {
      log.error({ err: e.message }, "[pv] create system error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── GET /pv/systems — list PV systems for a terrain
router.get("/pv/systems", async (req, res) => {
  try {
    const { terrain_id } = req.query;
    if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });

    const r = await db.query(
      `SELECT ps.id, ps.terrain_id, ps.name, ps.description, ps.location,
              ps.installed_capacity_kwc, ps.installation_date,
              ps.expected_tilt_degrees, ps.expected_orientation,
              ps.created_at, ps.updated_at,
              COUNT(DISTINCT mp.id) AS point_count,
              COUNT(DISTINCT CASE WHEN mp.status = 'active' THEN mp.id END) AS active_point_count
       FROM pv_systems ps
       LEFT JOIN measurement_points mp ON mp.pv_system_id = ps.id
       WHERE ps.terrain_id = $1
       GROUP BY ps.id
       ORDER BY ps.created_at DESC`,
      [terrain_id]
    );

    res.json({ ok: true, systems: r.rows });
  } catch (e) {
    log.error({ err: e.message }, "[pv] list systems error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /pv/systems/:id — get a PV system with points
router.get("/pv/systems/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Get system
    const sysRes = await db.query(
      `SELECT ps.id, ps.terrain_id, ps.name, ps.description, ps.location,
              ps.installed_capacity_kwc, ps.installation_date,
              ps.expected_tilt_degrees, ps.expected_orientation,
              ps.created_at, ps.updated_at
       FROM pv_systems ps
       WHERE ps.id = $1`,
      [id]
    );

    if (!sysRes.rows.length) return res.status(404).json({ ok: false, error: "PV system not found" });
    const system = sysRes.rows[0];

    // Get associated points
    const ptsRes = await db.query(
      `SELECT id, name, device, measure_category, status, created_at
       FROM measurement_points
       WHERE pv_system_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    system.points = ptsRes.rows;
    res.json({ ok: true, system });
  } catch (e) {
    log.error({ err: e.message }, "[pv] get system error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PUT /pv/systems/:id — update a PV system
router.put(
  "/pv/systems/:id",
  requireRole("platform_super_admin", "org_admin"),
  validate(updatePvSystemSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, location, installed_capacity_kwc, installation_date, expected_tilt_degrees, expected_orientation } = req.body;

      const updates = [];
      const values = [id];
      let idx = 2;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
      if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
      if (location !== undefined) { updates.push(`location = $${idx++}`); values.push(location); }
      if (installed_capacity_kwc !== undefined) { updates.push(`installed_capacity_kwc = $${idx++}`); values.push(installed_capacity_kwc); }
      if (installation_date !== undefined) { updates.push(`installation_date = $${idx++}`); values.push(installation_date); }
      if (expected_tilt_degrees !== undefined) { updates.push(`expected_tilt_degrees = $${idx++}`); values.push(expected_tilt_degrees); }
      if (expected_orientation !== undefined) { updates.push(`expected_orientation = $${idx++}`); values.push(expected_orientation); }

      if (updates.length === 0) return res.status(400).json({ ok: false, error: "No fields to update" });

      updates.push(`updated_at = NOW()`);

      const r = await db.query(
        `UPDATE pv_systems SET ${updates.join(", ")} WHERE id = $1 RETURNING *`,
        values
      );

      if (!r.rowCount) return res.status(404).json({ ok: false, error: "PV system not found" });
      res.json({ ok: true, system: r.rows[0] });
    } catch (e) {
      log.error({ err: e.message }, "[pv] update system error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── DELETE /pv/systems/:id — delete a PV system
router.delete(
  "/pv/systems/:id",
  requireRole("platform_super_admin", "org_admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Unassign all points from this system
      await db.query(
        `UPDATE measurement_points SET pv_system_id = NULL WHERE pv_system_id = $1`,
        [id]
      );

      // Delete system
      const r = await db.query(
        `DELETE FROM pv_systems WHERE id = $1`,
        [id]
      );

      if (!r.rowCount) return res.status(404).json({ ok: false, error: "PV system not found" });
      res.json({ ok: true, deleted: true });
    } catch (e) {
      log.error({ err: e.message }, "[pv] delete system error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── POST /pv/assign — assign a point to a PV system
router.post(
  "/pv/assign",
  requireRole("platform_super_admin", "org_admin"),
  validate(assignPointToPvSystemSchema),
  async (req, res) => {
    try {
      const { point_id, pv_system_id } = req.body;

      // Verify point exists
      const ptRes = await db.query(
        `SELECT terrain_id FROM measurement_points WHERE id = $1`,
        [point_id]
      );

      if (!ptRes.rows.length) return res.status(404).json({ ok: false, error: "Point not found" });
      const terrainId = ptRes.rows[0].terrain_id;

      // If pv_system_id provided, verify it belongs to same terrain
      if (pv_system_id) {
        const sysRes = await db.query(
          `SELECT id FROM pv_systems WHERE id = $1 AND terrain_id = $2`,
          [pv_system_id, terrainId]
        );

        if (!sysRes.rows.length) return res.status(400).json({ ok: false, error: "PV system does not belong to same terrain" });
      }

      // Update point
      const r = await db.query(
        `UPDATE measurement_points SET pv_system_id = $1 WHERE id = $2
         RETURNING id, name, pv_system_id`,
        [pv_system_id ?? null, point_id]
      );

      res.json({ ok: true, point: r.rows[0] });
    } catch (e) {
      log.error({ err: e.message }, "[pv] assign point error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

module.exports = router;
