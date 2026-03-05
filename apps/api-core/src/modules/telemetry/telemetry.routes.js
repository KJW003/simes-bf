const express = require("express");
const router = express.Router();
const { corePool, telemetryPool } = require("../../config/db");

// ─────────────────────────────────────────────────────────────
// GET /terrains/:terrainId/readings/latest
// Latest reading per measurement_point in the terrain
// ─────────────────────────────────────────────────────────────
router.get("/terrains/:terrainId/readings/latest", async (req, res) => {
  try {
    const { terrainId } = req.params;

    const r = await telemetryPool.query(
      `SELECT DISTINCT ON (point_id)
              point_id, time,
              voltage_a, voltage_b, voltage_c, voltage_ab, voltage_bc, voltage_ca,
              current_a, current_b, current_c, current_sum, aftercurrent,
              active_power_a, active_power_b, active_power_c, active_power_total,
              reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
              apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
              power_factor_a, power_factor_b, power_factor_c, power_factor_total,
              frequency, voltage_unbalance, current_unbalance,
              energy_total, energy_import, energy_export,
              reactive_energy_import, reactive_energy_export,
              energy_total_a, energy_import_a, energy_export_a,
              energy_total_b, energy_import_b, energy_export_b,
              energy_total_c, energy_import_c, energy_export_c,
              energy_spike, energy_peak, energy_flat, energy_valley,
              thdu_a, thdu_b, thdu_c, thdi_a, thdi_b, thdi_c,
              temp_a, temp_b, temp_c, temp_n,
              di_state, do1_state, do2_state, alarm_state,
              rssi_lora, rssi_gateway, snr_gateway, f_cnt
       FROM acrel_readings
       WHERE terrain_id = $1
       ORDER BY point_id, time DESC`,
      [terrainId]
    );

    // Enrich with point names
    const pointIds = r.rows.map((row) => row.point_id);
    let pointsMap = {};
    if (pointIds.length) {
      const pts = await corePool.query(
        `SELECT id, name, device, measure_category, modbus_addr, zone_id
         FROM measurement_points
         WHERE id = ANY($1::uuid[])`,
        [pointIds]
      );
      for (const p of pts.rows) pointsMap[p.id] = p;
    }

    const readings = r.rows.map((row) => ({
      ...row,
      point: pointsMap[row.point_id] || null,
    }));

    res.json({ ok: true, terrain_id: terrainId, count: readings.length, readings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /terrains/:terrainId/readings
// Raw time-series readings with optional filters
// Query: ?from=ISO&to=ISO&point_id=uuid&limit=500
// ─────────────────────────────────────────────────────────────
router.get("/terrains/:terrainId/readings", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 500, 5000);

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const from = req.query.from || defaultFrom.toISOString();
    const to = req.query.to || now.toISOString();
    const pointId = req.query.point_id || null;

    const params = [terrainId, from, to];
    const where = [`terrain_id = $1`, `time >= $2`, `time <= $3`];

    if (pointId) {
      params.push(pointId);
      where.push(`point_id = $${params.length}`);
    }

    params.push(limit);

    const sql = `
      SELECT point_id, time,
             voltage_a, voltage_b, voltage_c, voltage_ab, voltage_bc, voltage_ca,
             current_a, current_b, current_c, current_sum, aftercurrent,
             active_power_a, active_power_b, active_power_c, active_power_total,
             reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
             apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
             power_factor_a, power_factor_b, power_factor_c, power_factor_total,
             frequency, voltage_unbalance, current_unbalance,
             energy_total, energy_import, energy_export,
             reactive_energy_import, reactive_energy_export,
             energy_total_a, energy_import_a, energy_export_a,
             energy_total_b, energy_import_b, energy_export_b,
             energy_total_c, energy_import_c, energy_export_c,
             energy_spike, energy_peak, energy_flat, energy_valley,
             thdu_a, thdu_b, thdu_c, thdi_a, thdi_b, thdi_c,
             temp_a, temp_b, temp_c, temp_n,
             di_state, do1_state, do2_state, alarm_state,
             rssi_lora, rssi_gateway, snr_gateway, f_cnt
      FROM acrel_readings
      WHERE ${where.join(" AND ")}
      ORDER BY time DESC
      LIMIT $${params.length}
    `;

    const r = await telemetryPool.query(sql, params);
    res.json({ ok: true, terrain_id: terrainId, count: r.rows.length, readings: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /terrains/:terrainId/dashboard
// Real-time KPIs for a terrain (power, energy today, etc.)
// ─────────────────────────────────────────────────────────────
router.get("/terrains/:terrainId/dashboard", async (req, res) => {
  try {
    const { terrainId } = req.params;

    // Count points
    const ptCount = await corePool.query(
      `SELECT COUNT(*)::int AS total FROM measurement_points WHERE terrain_id = $1 AND status = 'active'`,
      [terrainId]
    );

    // Latest total power across all points
    const latestPower = await telemetryPool.query(
      `SELECT DISTINCT ON (point_id) point_id, time, active_power_total
       FROM acrel_readings
       WHERE terrain_id = $1
       ORDER BY point_id, time DESC`,
      [terrainId]
    );

    const totalPowerNow = latestPower.rows.reduce((s, r) => s + (Number(r.active_power_total) || 0), 0);
    const lastUpdate = latestPower.rows.reduce(
      (max, r) => (r.time > max ? r.time : max),
      latestPower.rows[0]?.time || null
    );

    // Energy today (from raw readings, per-point delta then sum)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const energyToday = await telemetryPool.query(
      `SELECT
         SUM(delta_import) AS import_kwh,
         SUM(delta_export) AS export_kwh
       FROM (
         SELECT point_id,
                GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS delta_import,
                GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS delta_export
         FROM acrel_readings
         WHERE terrain_id = $1 AND time >= $2
         GROUP BY point_id
       ) sub`,
      [terrainId, todayStart.toISOString()]
    );

    const importKwh = Number(energyToday.rows[0]?.import_kwh || 0);
    const exportKwh = Number(energyToday.rows[0]?.export_kwh || 0);

    res.json({
      ok: true,
      terrain_id: terrainId,
      points_count: ptCount.rows[0]?.total || 0,
      power_now_kw: Number(totalPowerNow.toFixed(3)),
      energy_today: {
        import_kwh: Number(importKwh.toFixed(3)),
        export_kwh: Number(exportKwh.toFixed(3)),
        net_kwh: Number((importKwh - exportKwh).toFixed(3)),
      },
      last_update: lastUpdate,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /terrains/:terrainId/overview
// Full terrain overview: points + zones + latest readings merged
// Used by the frontend Dashboard / DataMonitor pages
// ─────────────────────────────────────────────────────────────
router.get("/terrains/:terrainId/overview", async (req, res) => {
  try {
    const { terrainId } = req.params;

    // 1) Points
    const ptsR = await corePool.query(
      `SELECT id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status, created_at
       FROM measurement_points
       WHERE terrain_id = $1
       ORDER BY name`,
      [terrainId]
    );

    // 2) Zones
    const zonesR = await corePool.query(
      `SELECT id, terrain_id, name, description, created_at
       FROM zones
       WHERE terrain_id = $1
       ORDER BY name`,
      [terrainId]
    );

    // 3) Latest readings (one per point)
    const readR = await telemetryPool.query(
      `SELECT DISTINCT ON (point_id)
              point_id, time,
              voltage_a, voltage_b, voltage_c, voltage_ab, voltage_bc, voltage_ca,
              current_a, current_b, current_c, current_sum, aftercurrent,
              active_power_a, active_power_b, active_power_c, active_power_total,
              reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
              apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
              power_factor_a, power_factor_b, power_factor_c, power_factor_total,
              frequency, voltage_unbalance, current_unbalance,
              energy_total, energy_import, energy_export,
              reactive_energy_import, reactive_energy_export,
              energy_total_a, energy_import_a, energy_export_a,
              energy_total_b, energy_import_b, energy_export_b,
              energy_total_c, energy_import_c, energy_export_c,
              energy_spike, energy_peak, energy_flat, energy_valley,
              thdu_a, thdu_b, thdu_c, thdi_a, thdi_b, thdi_c,
              temp_a, temp_b, temp_c, temp_n,
              di_state, do1_state, do2_state, alarm_state,
              rssi_lora, rssi_gateway, snr_gateway, f_cnt
       FROM acrel_readings
       WHERE terrain_id = $1
       ORDER BY point_id, time DESC`,
      [terrainId]
    );

    // Index readings by point_id
    const readingsMap = {};
    for (const r of readR.rows) readingsMap[r.point_id] = r;

    // Build enriched points
    const points = ptsR.rows.map(p => {
      const r = readingsMap[p.id] || null;
      return {
        ...p,
        lastSeen: r?.time || null,
        readings: r ? {
          voltage_a: Number(r.voltage_a) || 0,
          voltage_b: Number(r.voltage_b) || 0,
          voltage_c: Number(r.voltage_c) || 0,
          voltage_ab: Number(r.voltage_ab) || 0,
          voltage_bc: Number(r.voltage_bc) || 0,
          voltage_ca: Number(r.voltage_ca) || 0,
          current_a: Number(r.current_a) || 0,
          current_b: Number(r.current_b) || 0,
          current_c: Number(r.current_c) || 0,
          current_sum: Number(r.current_sum) || 0,
          aftercurrent: Number(r.aftercurrent) || 0,
          active_power_a: Number(r.active_power_a) || 0,
          active_power_b: Number(r.active_power_b) || 0,
          active_power_c: Number(r.active_power_c) || 0,
          active_power_total: Number(r.active_power_total) || 0,
          reactive_power_a: Number(r.reactive_power_a) || 0,
          reactive_power_b: Number(r.reactive_power_b) || 0,
          reactive_power_c: Number(r.reactive_power_c) || 0,
          reactive_power_total: Number(r.reactive_power_total) || 0,
          apparent_power_a: Number(r.apparent_power_a) || 0,
          apparent_power_b: Number(r.apparent_power_b) || 0,
          apparent_power_c: Number(r.apparent_power_c) || 0,
          apparent_power_total: Number(r.apparent_power_total) || 0,
          power_factor_a: Number(r.power_factor_a) || 0,
          power_factor_b: Number(r.power_factor_b) || 0,
          power_factor_c: Number(r.power_factor_c) || 0,
          power_factor_total: Number(r.power_factor_total) || 0,
          frequency: Number(r.frequency) || 0,
          voltage_unbalance: Number(r.voltage_unbalance) || 0,
          current_unbalance: Number(r.current_unbalance) || 0,
          energy_total: Number(r.energy_total) || 0,
          energy_import: Number(r.energy_import) || 0,
          energy_export: Number(r.energy_export) || 0,
          reactive_energy_import: Number(r.reactive_energy_import) || 0,
          reactive_energy_export: Number(r.reactive_energy_export) || 0,
          energy_total_a: Number(r.energy_total_a) || 0,
          energy_import_a: Number(r.energy_import_a) || 0,
          energy_export_a: Number(r.energy_export_a) || 0,
          energy_total_b: Number(r.energy_total_b) || 0,
          energy_import_b: Number(r.energy_import_b) || 0,
          energy_export_b: Number(r.energy_export_b) || 0,
          energy_total_c: Number(r.energy_total_c) || 0,
          energy_import_c: Number(r.energy_import_c) || 0,
          energy_export_c: Number(r.energy_export_c) || 0,
          energy_spike: Number(r.energy_spike) || 0,
          energy_peak: Number(r.energy_peak) || 0,
          energy_flat: Number(r.energy_flat) || 0,
          energy_valley: Number(r.energy_valley) || 0,
          thdu_a: Number(r.thdu_a) || 0,
          thdu_b: Number(r.thdu_b) || 0,
          thdu_c: Number(r.thdu_c) || 0,
          thdi_a: Number(r.thdi_a) || 0,
          thdi_b: Number(r.thdi_b) || 0,
          thdi_c: Number(r.thdi_c) || 0,
          temp_a: Number(r.temp_a) || 0,
          temp_b: Number(r.temp_b) || 0,
          temp_c: Number(r.temp_c) || 0,
          temp_n: Number(r.temp_n) || 0,
          di_state: Number(r.di_state) || 0,
          do1_state: Number(r.do1_state) || 0,
          do2_state: Number(r.do2_state) || 0,
          alarm_state: Number(r.alarm_state) || 0,
          rssi_lora: Number(r.rssi_lora) || 0,
          rssi_gateway: Number(r.rssi_gateway) || 0,
          snr_gateway: Number(r.snr_gateway) || 0,
          f_cnt: Number(r.f_cnt) || 0,
        } : null,
      };
    });

    // Build zone membership map (zone_id -> point_ids)
    const zones = zonesR.rows.map(z => ({
      ...z,
      pointIds: ptsR.rows.filter(p => p.zone_id === z.id).map(p => p.id),
    }));

    res.json({
      ok: true,
      terrain_id: terrainId,
      points,
      zones,
      points_count: points.length,
      zones_count: zones.length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
