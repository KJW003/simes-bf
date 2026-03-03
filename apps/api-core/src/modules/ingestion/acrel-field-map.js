/**
 * acrel-field-map.js
 *
 * Maps raw Acrel/Milesight codec field names (from the UG67 gateway snapshot)
 * to the normalised DB column names used in acrel_readings (TimescaleDB).
 *
 * Codec reference: Milesight Payload Codec Code.js (ADW300 / ADW310)
 */

// ── Snapshot key  →  DB column ──────────────────────────────
const ACREL_TO_DB = {
  // Voltages (V)
  Ua:  "voltage_a",
  Ub:  "voltage_b",
  Uc:  "voltage_c",
  Uab: "voltage_ab",
  Ubc: "voltage_bc",
  Uca: "voltage_ca",

  // Currents (A)
  Ia: "current_a",
  Ib: "current_b",
  Ic: "current_c",
  IL: "aftercurrent",       // courant résiduel (mA dans codec)

  // Active power (kW) – codec already scales ×0.001
  Pa: "active_power_a",
  Pb: "active_power_b",
  Pc: "active_power_c",
  P:  "active_power_total",

  // Reactive power (kVar)
  Qa: "reactive_power_a",
  Qb: "reactive_power_b",
  Qc: "reactive_power_c",
  Q:  "reactive_power_total",

  // Apparent power (kVA)
  Sa: "apparent_power_a",
  Sb: "apparent_power_b",
  Sc: "apparent_power_c",
  S:  "apparent_power_total",

  // Power factor (0-1)
  Pfa: "power_factor_a",
  Pfb: "power_factor_b",
  Pfc: "power_factor_c",
  Pf:  "power_factor_total",

  // Global energies (kWh)
  EP:  "energy_total",
  EPI: "energy_import",
  EPE: "energy_export",

  // Reactive energies (global only – no per-phase columns in DB schema)
  EQL: "reactive_energy_import",   // inductive
  EQC: "reactive_energy_export",   // capacitive
  // EQLa/b/c, EQCa/b/c → no DB columns, kept in raw only

  // Phase energies
  EPa:  "energy_total_a",
  EPIa: "energy_import_a",
  EPEa: "energy_export_a",

  EPb:  "energy_total_b",
  EPIb: "energy_import_b",
  EPEb: "energy_export_b",

  EPc:  "energy_total_c",
  EPIc: "energy_import_c",
  EPEc: "energy_export_c",

  // SONABEL time-of-use slices
  EPJ: "energy_spike",   // pointe
  EPF: "energy_peak",    // heures pleines
  EPP: "energy_flat",    // heures creuses
  EPG: "energy_valley",  // heures de nuit

  // THD (%)
  UaTHD: "thdu_a",
  UbTHD: "thdu_b",
  UcTHD: "thdu_c",
  IaTHD: "thdi_a",
  IbTHD: "thdi_b",
  IcTHD: "thdi_c",

  // Temperatures (°C)
  TempA: "temp_a",
  TempB: "temp_b",
  TempC: "temp_c",
  TempN: "temp_n",

  // Unbalance (%)
  VUB: "voltage_unbalance",
  CUB: "current_unbalance",

  // DI / DO
  DI_state: "di_state",
};

// ── Fields in snapshot that are metadata not metrics ─────────
const SNAPSHOT_META_KEYS = new Set([
  "applicationID", "cellularIP", "devEUI", "deviceName", "gatewayTime",
  "CT", "PT",          // transformer ratios – config, not a reading
  "DI1", "DI2", "DI3", "DI4",  // individual bits (DI_state covers them)
  "MD", "MDTimeStamp", "RD",   // demand – not mapped in schema yet
  // Per-phase reactive energies – no DB columns yet, kept in raw
  "EQLa", "EQLb", "EQLc", "EQCa", "EQCb", "EQCc",
]);

/**
 * Convert a raw Acrel snapshot (UG67 codec output)
 * into a { metrics, meta } object with DB column names.
 */
function mapSnapshot(snapshot) {
  const metrics = {};
  const meta = {};

  for (const [key, value] of Object.entries(snapshot || {})) {
    const dbCol = ACREL_TO_DB[key];
    if (dbCol) {
      metrics[dbCol] = value;
    } else if (SNAPSHOT_META_KEYS.has(key)) {
      meta[key] = value;
    }
    // ignore unknown keys silently (tolerance)
  }

  return { metrics, meta };
}

module.exports = { ACREL_TO_DB, SNAPSHOT_META_KEYS, mapSnapshot };
