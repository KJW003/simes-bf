const express = require("express");
const router = express.Router();
const { corePool: db } = require("../../config/db");
const { pickQueue, JobTypes } = require("../../jobs/dispatch");
const { requireRole, verifyTerrainAccess } = require("../../shared/auth-middleware");
const log = require("../../config/logger");

// ── Defaults for solar parameters per method
const METHOD_DEFAULTS = {
  average_load: {
    hsp: 5.5, eta_sys: 0.80, k_sec: 1.20, p_module: 400,
    autonomy_days: 2, battery_capacity_ah: 200, system_voltage: 48,
    lever_soleil: 6.0, coucher_soleil: 18.5,
    rendement_onduleur: 0.95, profondeur_decharge: 0.80,
  },
  peak_demand: {
    hsp: 5.5, eta_sys: 0.80, k_sec: 1.20, p_module: 400,
    cos_phi: 0.90, k_ond: 1.30,
  },
  theoretical_production: {
    gj: 5.5, t_lever: 6.0, t_coucher: 18.0, pr: 0.78,
    eta_mod: 0.20, eta_inv: 0.96, gamma_t: -0.004,
    t_amb: 35, t_noct: 45,
  },
  available_surface: {
    k_occ: 0.70, s_mod: 1.65, p_module: 400, hsp: 5.5, pr: 0.78,
  },
};

// ── Helper: create run + enqueue
async function createSolarRunAndEnqueue(payload) {
  const ins = await db.query(
    `INSERT INTO runs (type, status, payload)
     VALUES ($1, 'queued', $2::jsonb)
     RETURNING id, type, status, created_at`,
    [JobTypes.SOLAR_SCENARIO, JSON.stringify(payload)]
  );
  const run = ins.rows[0];
  const queue = pickQueue(JobTypes.SOLAR_SCENARIO);
  await queue.add(JobTypes.SOLAR_SCENARIO, { runId: run.id, payload }, { attempts: 2 });
  return run;
}

// ── POST /solar/scenarios — create and compute a solar scenario
router.post(
  "/solar/scenarios",
  requireRole("platform_super_admin", "org_admin"),
  verifyTerrainAccess("body.terrain_id"),
  async (req, res) => {
    try {
      const { terrain_id, name, method = "average_load", params = {} } = req.body;
      if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });

      const validMethods = ["average_load", "peak_demand", "theoretical_production", "available_surface"];
      if (!validMethods.includes(method)) {
        return res.status(400).json({ ok: false, error: `method must be one of: ${validMethods.join(", ")}` });
      }

      // Merge defaults with user-provided params
      const mergedParams = { ...METHOD_DEFAULTS[method], ...params };

      // Create the scenario record (draft)
      const { rows } = await db.query(
        `INSERT INTO solar_scenarios (terrain_id, name, method, params, status, created_by)
         VALUES ($1, $2, $3, $4::jsonb, 'draft', $5)
         RETURNING id`,
        [terrain_id, name || "Scénario PV", method, JSON.stringify(mergedParams), req.userId]
      );
      const scenarioId = rows[0].id;

      // Create run + enqueue
      const run = await createSolarRunAndEnqueue({
        terrain_id,
        scenario_id: scenarioId,
        method,
        params: mergedParams,
      });

      // Link run to scenario
      await db.query(
        `UPDATE solar_scenarios SET run_id = $1, status = 'computing' WHERE id = $2`,
        [run.id, scenarioId]
      );

      res.status(201).json({ ok: true, scenario_id: scenarioId, run });
    } catch (e) {
      log.error({ err: e.message }, "[solar] create scenario error");
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── GET /solar/scenarios — list scenarios for a terrain
router.get("/solar/scenarios", async (req, res) => {
  try {
    const { terrain_id, method, status, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (terrain_id) { conditions.push(`s.terrain_id = $${idx++}`); params.push(terrain_id); }
    if (method) { conditions.push(`s.method = $${idx++}`); params.push(method); }
    if (status) { conditions.push(`s.status = $${idx++}`); params.push(status); }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const limitVal = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetVal = Math.max(Number(offset) || 0, 0);

    const { rows } = await db.query(`
      SELECT s.id, s.terrain_id, s.name, s.method,
             s.params, s.results, s.financial,
             s.status, s.error,
             s.created_at, s.computed_at,
             t.name AS terrain_name
      FROM solar_scenarios s
      LEFT JOIN terrains t ON t.id = s.terrain_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limitVal, offsetVal]);

    const countRes = await db.query(
      `SELECT count(*)::int FROM solar_scenarios s ${where}`,
      params
    );

    res.json({ ok: true, scenarios: rows, total: countRes.rows[0].count });
  } catch (e) {
    log.error({ err: e.message }, "[solar] list error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /solar/scenarios/:id — single scenario detail
router.get("/solar/scenarios/:id", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.*, t.name AS terrain_name
      FROM solar_scenarios s
      LEFT JOIN terrains t ON t.id = s.terrain_id
      WHERE s.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ ok: false, error: "Scenario not found" });
    res.json({ ok: true, scenario: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /solar/scenarios/:id — delete a scenario
router.delete(
  "/solar/scenarios/:id",
  requireRole("platform_super_admin", "org_admin"),
  async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM solar_scenarios WHERE id = $1`,
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ ok: false, error: "Scenario not found" });
      res.json({ ok: true, deleted: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── GET /solar/defaults/:method — get default parameters for a method
router.get("/solar/defaults/:method", (req, res) => {
  const defaults = METHOD_DEFAULTS[req.params.method];
  if (!defaults) return res.status(400).json({ ok: false, error: "Unknown method" });
  res.json({ ok: true, method: req.params.method, defaults });
});

module.exports = router;
