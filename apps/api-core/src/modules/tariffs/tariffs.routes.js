const express = require("express");
const router = express.Router();
const { corePool } = require("../../config/db");

// GET /tariffs?group=D
router.get("/tariffs", async (req, res) => {
  try {
    const group = req.query.group || null;

    const r = group
      ? await corePool.query(
          `SELECT id, group_code, plan_code, name, valid_from, valid_to,
                  hp_start_min, hp_end_min, hpt_start_min, hpt_end_min,
                  rate_hp, rate_hpt, fixed_monthly, prime_per_kw,
                  vat_rate, tde_tdsaae_rate, meta
           FROM tariff_plans
           WHERE group_code = $1
           ORDER BY plan_code, valid_from DESC`,
          [group]
        )
      : await corePool.query(
          `SELECT id, group_code, plan_code, name, valid_from, valid_to,
                  hp_start_min, hp_end_min, hpt_start_min, hpt_end_min,
                  rate_hp, rate_hpt, fixed_monthly, prime_per_kw,
                  vat_rate, tde_tdsaae_rate, meta
           FROM tariff_plans
           ORDER BY group_code, plan_code, valid_from DESC`
        );

    res.json({ ok: true, tariffs: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /tariffs/:planCode/current
router.get("/tariffs/:planCode/current", async (req, res) => {
  try {
    const { planCode } = req.params;

    const r = await corePool.query(
      `SELECT *
       FROM tariff_plans
       WHERE plan_code = $1
       ORDER BY valid_from DESC
       LIMIT 1`,
      [planCode]
    );

    if (!r.rows.length) return res.status(404).json({ ok: false, error: "tariff not found" });
    res.json({ ok: true, tariff: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /terrains/:terrainId/contract
router.get("/terrains/:terrainId/contract", async (req, res) => {
  try {
    const { terrainId } = req.params;

    const r = await corePool.query(
      `SELECT tc.id, tc.terrain_id, tc.tariff_plan_id, tc.subscribed_power_kw,
              tc.meter_rental, tc.post_rental, tc.maintenance,
              tp.plan_code, tp.name, tp.group_code, tp.valid_from
       FROM terrain_contracts tc
       JOIN tariff_plans tp ON tp.id = tc.tariff_plan_id
       WHERE tc.terrain_id = $1`,
      [terrainId]
    );

    if (!r.rows.length) return res.status(404).json({ ok: false, error: "contract not found" });
    res.json({ ok: true, contract: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /terrains/:terrainId/contract
// body: { tariff_plan_id, subscribed_power_kw, meter_rental?, post_rental?, maintenance? }
router.put("/terrains/:terrainId/contract", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const {
      tariff_plan_id,
      subscribed_power_kw,
      meter_rental = 0,
      post_rental = 0,
      maintenance = 0,
    } = req.body || {};

    if (!tariff_plan_id) return res.status(400).json({ ok: false, error: "tariff_plan_id is required" });
    if (typeof subscribed_power_kw !== "number" || subscribed_power_kw <= 0) {
      return res.status(400).json({ ok: false, error: "subscribed_power_kw must be a positive number" });
    }

    // ensure tariff exists
    const t = await corePool.query(`SELECT id FROM tariff_plans WHERE id = $1`, [tariff_plan_id]);
    if (!t.rows.length) return res.status(404).json({ ok: false, error: "tariff_plan_id not found" });

    const up = await corePool.query(
      `INSERT INTO terrain_contracts (terrain_id, tariff_plan_id, subscribed_power_kw, meter_rental, post_rental, maintenance)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (terrain_id)
       DO UPDATE SET
         tariff_plan_id = EXCLUDED.tariff_plan_id,
         subscribed_power_kw = EXCLUDED.subscribed_power_kw,
         meter_rental = EXCLUDED.meter_rental,
         post_rental = EXCLUDED.post_rental,
         maintenance = EXCLUDED.maintenance,
         updated_at = now()
       RETURNING *`,
      [terrainId, tariff_plan_id, subscribed_power_kw, meter_rental, post_rental, maintenance]
    );

    res.json({ ok: true, contract: up.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;