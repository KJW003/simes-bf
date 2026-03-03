/**
 * acrel-field-map.js
 *
 * Maps raw Acrel/Milesight codec field names (from the UG67 gateway snapshot)
 * to the normalised DB column names used in acrel_readings (TimescaleDB).
 */

const ACREL_TO_DB = {
  Ua:  "voltage_a",
  Ub:  "voltage_b",
  Uc:  "voltage_c",
  Uab: "voltage_ab",
  Ubc: "voltage_bc",
  Uca: "voltage_ca",

  Ia: "current_a",
  Ib: "current_b",
  Ic: "current_c",
  IL: "aftercurrent",

  Pa: "active_power_a",
  Pb: "active_power_b",
  Pc: "active_power_c",
  P:  "active_power_total",

  Qa: "reactive_power_a",
  Qb: "reactive_power_b",
  Qc: "reactive_power_c",
  Q:  "reactive_power_total",

  Sa: "apparent_power_a",
  Sb: "apparent_power_b",
  Sc: "apparent_power_c",
  S:  "apparent_power_total",

  Pfa: "power_factor_a",
  Pfb: "power_factor_b",
  Pfc: "power_factor_c",
  Pf:  "power_factor_total",

  EP:  "energy_total",
  EPI: "energy_import",
  EPE: "energy_export",

  EQL: "reactive_energy_import",
  EQC: "reactive_energy_export",

  EPa:  "energy_total_a",
  EPIa: "energy_import_a",
  EPEa: "energy_export_a",

  EPb:  "energy_total_b",
  EPIb: "energy_import_b",
  EPEb: "energy_export_b",

  EPc:  "energy_total_c",
  EPIc: "energy_import_c",
  EPEc: "energy_export_c",

  EPJ: "energy_spike",
  EPF: "energy_peak",
  EPP: "energy_flat",
  EPG: "energy_valley",

  UaTHD: "thdu_a",
  UbTHD: "thdu_b",
  UcTHD: "thdu_c",
  IaTHD: "thdi_a",
  IbTHD: "thdi_b",
  IcTHD: "thdi_c",

  TempA: "temp_a",
  TempB: "temp_b",
  TempC: "temp_c",
  TempN: "temp_n",

  VUB: "voltage_unbalance",
  CUB: "current_unbalance",

  DI_state: "di_state",
};

const SNAPSHOT_META_KEYS = new Set([
  "applicationID", "cellularIP", "devEUI", "deviceName", "gatewayTime",
  "CT", "PT",
  "DI1", "DI2", "DI3", "DI4",
  "MD", "MDTimeStamp", "RD",
  "EQLa", "EQLb", "EQLc", "EQCa", "EQCb", "EQCc",
]);

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
  }

  return { metrics, meta };
}

module.exports = { ACREL_TO_DB, SNAPSHOT_META_KEYS, mapSnapshot };
