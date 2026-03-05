/**
 * shared/acrel.js
 *
 * Single source of truth for:
 *  - METRIC_COLS   (DB column whitelist for acrel_readings)
 *  - pickMetrics() (extract only whitelisted keys)
 *  - makeDeviceKey()
 *  - lookupPoint()
 *  - buildUpsertSQL()
 *
 * Used by: ingestion routes
 */

const { corePool } = require("../config/db");
const { applyCT } = require("./ct-transform");

// ── DB-column whitelist (matches schema-telemetry.sql exactly) ──
const METRIC_COLS = new Set([
  // Voltages
  "voltage_a","voltage_b","voltage_c",
  "voltage_ab","voltage_bc","voltage_ca",

  // Currents
  "current_a","current_b","current_c",
  "current_sum","aftercurrent",

  // Active power (kW)
  "active_power_a","active_power_b","active_power_c","active_power_total",

  // Reactive power (kVar)
  "reactive_power_a","reactive_power_b","reactive_power_c","reactive_power_total",

  // Apparent power (kVA)
  "apparent_power_a","apparent_power_b","apparent_power_c","apparent_power_total",

  // Power factor
  "power_factor_a","power_factor_b","power_factor_c","power_factor_total",

  // Misc
  "frequency","voltage_unbalance","current_unbalance",

  // Global energies
  "energy_total","energy_import","energy_export",
  "reactive_energy_import","reactive_energy_export",

  // Phase energies
  "energy_total_a","energy_import_a","energy_export_a",
  "energy_total_b","energy_import_b","energy_export_b",
  "energy_total_c","energy_import_c","energy_export_c",

  // SONABEL slices
  "energy_spike","energy_peak","energy_flat","energy_valley",

  // THD
  "thdu_a","thdu_b","thdu_c",
  "thdi_a","thdi_b","thdi_c",

  // Temps
  "temp_a","temp_b","temp_c","temp_n",

  // DI/DO/Alarm numeric (bitmask capable)
  "di_state","do1_state","do2_state","alarm_state",
]);

// ── Radio / transmission meta columns ───────────────────────
const RADIO_COLS = new Set([
  "rssi_lora","rssi_gateway","snr_gateway","f_cnt",
]);

/**
 * Keep only keys present in METRIC_COLS.
 */
function pickMetrics(metrics = {}) {
  const out = {};
  for (const [k, v] of Object.entries(metrics || {})) {
    if (METRIC_COLS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Canonical device key: "modbus:<int>" or "deveui:<string>".
 */
function makeDeviceKey(modbusAddrOrObj, devEuiFallback) {
  let modbus, devEui;

  if (modbusAddrOrObj !== null && typeof modbusAddrOrObj === "object") {
    const o = modbusAddrOrObj;
    modbus = o.modbus_addr ?? o.device?.modbus_addr ?? null;
    devEui = o.dev_eui ?? o.lora_dev_eui ?? o.devEui ?? o.devEUI
          ?? o.device?.lora_dev_eui ?? o.device?.dev_eui ?? null;
  } else {
    modbus = modbusAddrOrObj;
    devEui = devEuiFallback;
  }

  if (modbus !== null && modbus !== undefined && Number.isInteger(modbus))
    return `modbus:${modbus}`;
  if (devEui) return `deveui:${String(devEui)}`;
  return "unknown";
}

/**
 * Lookup measurement_point by terrain + modbus_addr or lora_dev_eui.
 * Returns { point_id, measure_category, terrain_id, site_id, org_id, ct_ratio } or null.
 */
async function lookupPoint({ terrainId, modbusAddr, loraDevEui }) {
  if (terrainId && Number.isInteger(modbusAddr)) {
    const r = await corePool.query(
      `SELECT mp.id AS point_id, mp.measure_category, mp.terrain_id,
              mp.ct_ratio,
              t.site_id, s.organization_id AS org_id
       FROM measurement_points mp
       JOIN terrains t ON t.id = mp.terrain_id
       JOIN sites s ON s.id = t.site_id
       WHERE mp.terrain_id = $1 AND mp.modbus_addr = $2
       LIMIT 1`,
      [terrainId, modbusAddr]
    );
    if (r.rows.length) return r.rows[0];
  }

  if (terrainId && loraDevEui && typeof loraDevEui === "string") {
    const r = await corePool.query(
      `SELECT mp.id AS point_id, mp.measure_category, mp.terrain_id,
              mp.ct_ratio,
              t.site_id, s.organization_id AS org_id
       FROM measurement_points mp
       JOIN terrains t ON t.id = mp.terrain_id
       JOIN sites s ON s.id = t.site_id
       WHERE mp.terrain_id = $1 AND mp.lora_dev_eui = $2
       LIMIT 1`,
      [terrainId, loraDevEui]
    );
    if (r.rows.length) return r.rows[0];
  }

  return null;
}

/**
 * Build a dynamic INSERT … ON CONFLICT DO UPDATE for acrel_readings.
 */
function buildUpsertSQL({ time, orgId, siteId, terrainId, pointId, metrics, raw }) {
  const fixedCols = ["time", "org_id", "site_id", "terrain_id", "point_id", "raw"];
  const fixedVals = [time, orgId, siteId, terrainId, pointId, raw];

  const metricCols = [];
  const metricVals = [];
  for (const [k, v] of Object.entries(metrics)) {
    if (v === undefined) continue;
    if (METRIC_COLS.has(k) || RADIO_COLS.has(k)) {
      metricCols.push(k);
      metricVals.push(v);
    }
  }

  const allCols = fixedCols.concat(metricCols);
  const allVals = fixedVals.concat(metricVals);

  const placeholders = allVals.map((_, i) => `$${i + 1}`).join(", ");
  const colList = allCols.join(", ");

  const updatableCols = allCols.filter((c) => !["time", "point_id"].includes(c));
  const setClause = updatableCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");

  const sql = `
    INSERT INTO acrel_readings (${colList})
    VALUES (${placeholders})
    ON CONFLICT (point_id, time)
    DO UPDATE SET ${setClause}
    RETURNING time, point_id
  `;

  return { sql, values: allVals };
}

function isIsoDateString(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

module.exports = {
  METRIC_COLS,
  RADIO_COLS,
  pickMetrics,
  makeDeviceKey,
  lookupPoint,
  buildUpsertSQL,
  isIsoDateString,
  applyCT,
};
