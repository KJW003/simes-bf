const express = require("express");
const router = express.Router();
const { corePool, telemetryPool } = require("../../config/db");

// Try to require Excel library for report exports
let ExcelJS;
try {
  ExcelJS = require("exceljs");
} catch (e) {
  console.warn("[telemetry-routes] ExcelJS not available, Excel export will not work. Install with: npm install exceljs");
}

// ─── Shared Acrel column list (DRY) ────────────────────────
const ACREL_METRIC_COLS = [
  "voltage_a", "voltage_b", "voltage_c", "voltage_ab", "voltage_bc", "voltage_ca",
  "current_a", "current_b", "current_c", "current_sum", "aftercurrent",
  "active_power_a", "active_power_b", "active_power_c", "active_power_total",
  "reactive_power_a", "reactive_power_b", "reactive_power_c", "reactive_power_total",
  "apparent_power_a", "apparent_power_b", "apparent_power_c", "apparent_power_total",
  "power_factor_a", "power_factor_b", "power_factor_c", "power_factor_total",
  "frequency", "voltage_unbalance", "current_unbalance",
  "energy_total", "energy_import", "energy_export",
  "reactive_energy_import", "reactive_energy_export",
  "energy_total_a", "energy_import_a", "energy_export_a",
  "energy_total_b", "energy_import_b", "energy_export_b",
  "energy_total_c", "energy_import_c", "energy_export_c",
  "energy_spike", "energy_peak", "energy_flat", "energy_valley",
  "thdu_a", "thdu_b", "thdu_c", "thdi_a", "thdi_b", "thdi_c",
  "temp_a", "temp_b", "temp_c", "temp_n",
  "di_state", "do1_state", "do2_state", "alarm_state",
  "rssi_lora", "rssi_gateway", "snr_gateway", "f_cnt",
];
const ACREL_COLS_SQL = ACREL_METRIC_COLS.join(", ");

/** Convert a telemetry row to numbers (strip nulls → 0) */
function rowToNumbers(row) {
  const out = {};
  for (const col of ACREL_METRIC_COLS) out[col] = Number(row[col]) || 0;
  return out;
}

// ─────────────────────────────────────────────────────────────
// GET /terrains/:terrainId/readings/latest
// Latest reading per measurement_point in the terrain
// ─────────────────────────────────────────────────────────────
router.get("/terrains/:terrainId/readings/latest", async (req, res) => {
  try {
    const { terrainId } = req.params;

    const r = await telemetryPool.query(
      `SELECT DISTINCT ON (point_id)
              point_id, time, ${ACREL_COLS_SQL}
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
        `SELECT id, name, device, measure_category, modbus_addr, zone_id, ct_ratio
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
    console.error("[telemetry/readings/latest]", e.message, e.stack);
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
      SELECT point_id, time, ${ACREL_COLS_SQL}
      FROM acrel_readings
      WHERE ${where.join(" AND ")}
      ORDER BY time DESC
      LIMIT $${params.length}
    `;

    const r = await telemetryPool.query(sql, params);
    res.json({ ok: true, terrain_id: terrainId, count: r.rows.length, readings: r.rows });
  } catch (e) {
    console.error("[telemetry/readings]", e.message, e.stack);
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

    // Energy today (from raw readings, per-point delta then sum — Load meters only)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Get Load-type point IDs from core DB
    const loadPts = await corePool.query(
      `SELECT id FROM measurement_points WHERE terrain_id = $1 AND status = 'active' AND measure_category = 'LOAD'`,
      [terrainId]
    );
    const loadIds = loadPts.rows.map(r => r.id);

    let importKwh = 0;
    let exportKwh = 0;

    if (loadIds.length > 0) {
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
             AND point_id = ANY($3)
           GROUP BY point_id
         ) sub`,
        [terrainId, todayStart.toISOString(), loadIds]
      );

      importKwh = Number(energyToday.rows[0]?.import_kwh || 0);
      exportKwh = Number(energyToday.rows[0]?.export_kwh || 0);
    }

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
    console.error("[telemetry/dashboard]", e.message, e.stack);
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

    // 1) Points (include ct_ratio for frontend display, default to 1 if missing)
    const ptsR = await corePool.query(
      `SELECT id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status, 
              COALESCE(ct_ratio, 1) AS ct_ratio, created_at
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
              point_id, time, ${ACREL_COLS_SQL}
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
        readings: r ? rowToNumbers(r) : null,
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
    console.error("[telemetry/overview]", e.message, e.stack);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Point Report Export (Excel) ────────────────────────────
// GET /reports/point/:pointId/excel
// Exports all acrel_readings for a measurement point to Excel
router.get("/reports/point/:pointId/excel", async (req, res) => {
  try {
    if (!ExcelJS) {
      return res.status(503).json({
        ok: false,
        error: "Excel export not available. Install exceljs: npm install exceljs"
      });
    }

    const { pointId } = req.params;
    const limit = parseInt(req.query.limit) || 1000; // max records to export
    const days = parseInt(req.query.days) || 30; // default last 30 days

    // Get point details
    const ptRes = await corePool.query(
      `SELECT id, name, measure_category, terrain_id FROM measurement_points WHERE id = $1`,
      [pointId]
    );
    if (!ptRes.rows.length) {
      return res.status(404).json({ ok: false, error: "measurement_point not found" });
    }
    const point = ptRes.rows[0];

    // Fetch acrel_readings for this point (last N days, sorted newest first)
    const fromTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sqlReadings = `
      SELECT ${ACREL_COLS_SQL}, time, point_id
      FROM acrel_readings
      WHERE point_id = $1 AND time >= $2
      ORDER BY time DESC
      LIMIT $3
    `;
    const readings = await telemetryPool.query(sqlReadings, [pointId, fromTime, limit]);

    if (!readings.rows.length) {
      return res.json({
        ok: true,
        message: "No readings found for this point in the specified time range",
        point_id: pointId,
        days
      });
    }

    // Create workbook & worksheet
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Readings");

    // Header row with point info
    const infoRow = sheet.addRow([
      `Measurement Point: ${point.name}`,
      `Category: ${point.measure_category}`,
      `Records: ${readings.rows.length}`,
      `Period: last ${days} days`
    ]);
    infoRow.font = { bold: true, size: 12 };
    infoRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

    // Empty row
    sheet.addRow([]);

    // Column headers (all acrel fields)
    const headers = ["Time", ...ACREL_METRIC_COLS];
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };

    // Data rows
    for (const row of readings.rows) {
      const values = [
        row.time ? new Date(row.time).toISOString() : "",
        ...ACREL_METRIC_COLS.map(col => Number(row[col]) || null),
      ];
      sheet.addRow(values);
    }

    // Adjust column widths
    sheet.columns.forEach((col, idx) => {
      col.width = idx === 0 ? 25 : 14; // Time column wider, others fixed
    });

    // Set file response
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="simes-point-${point.id}-${new Date().toISOString().slice(0, 10)}.xlsx"`
    );

    await workbook.xlsx.write(res);
  } catch (e) {
    console.error("[telemetry/reports/point/excel]", e.message, e.stack);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
