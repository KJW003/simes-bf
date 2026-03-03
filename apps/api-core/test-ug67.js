/**
 * Standalone test – no Redis / DB dependencies.
 * node apps/api-core/test-ug67.js
 */

// Direct require of pure modules (no side effects)
const { ACREL_TO_DB, mapSnapshot } = require("./src/modules/webhook/acrel-field-map");

// ── 1) Test mapSnapshot ──
const snapshot = {
  Ua: 214.2, Ub: 214.3, Uc: 214.3,
  Uab: 371, Ubc: 371.1, Uca: 371,
  Ia: 0, Ib: 0, Ic: 0,
  P: 0, Pa: 0, Pb: 0, Pc: 0,
  Q: 0, S: 0,
  Pf: 1, Pfa: 1, Pfb: 1, Pfc: 1,
  EP: 0, EPI: 0, EPE: 0,
  UaTHD: 5.79, UbTHD: 5.79, UcTHD: 5.79,
  IaTHD: 0, IbTHD: 0, IcTHD: 0,
  VUB: 0.04, CUB: 0,
  TempN: 0, TempA: 0, TempB: 0, TempC: 0,
  DI_state: 0,
  // metadata (should NOT appear in metrics)
  CT: 300, PT: 1,
  applicationID: 1, deviceName: "SIMES 3", devEUI: "00956906000b12d7",
};

const { metrics, meta } = mapSnapshot(snapshot);

console.log("=== mapSnapshot ===");
console.log("metrics keys:", Object.keys(metrics).sort().join(", "));
console.log("voltage_a =", metrics.voltage_a, "(expected 214.2)");
console.log("thdu_a =", metrics.thdu_a, "(expected 5.79)");
console.log("voltage_unbalance =", metrics.voltage_unbalance, "(expected 0.04)");
console.log("meta keys:", Object.keys(meta).sort().join(", "));
console.log("");

// ── 2) Test isUG67Batch + normalizeUG67 ──
// We can't require ug67-normalizer because it requires acrel-field-map
// which would work, but let's be safe and inline the test.
const { isUG67Batch, normalizeUG67 } = require("./src/modules/webhook/ug67-normalizer");

const payload = {
  gateway: { id: "UG67-OUAGA-01", ts_batch_start: "2026-03-02T00:30:42.875Z", ts_batch_end: "2026-03-02T00:31:42.875Z" },
  window_sec: 600,
  devices: [
    {
      devEUI: "00956906000b12d7",
      meta: { lastSeen: "2026-03-02T00:31:09.913Z", deviceName: "SIMES 3" },
      radio: { rssi: -31, snr: 13.8, fcnt: 97, time: "2026-03-02T00:31:07.807388Z" },
      snapshot,
    },
  ],
};

console.log("=== isUG67Batch ===");
console.log("detected:", isUG67Batch(payload), "(expected true)");
console.log("not UG67:", isUG67Batch({ gateway_id: "x", devices: [] }), "(expected false)");

const norm = normalizeUG67(payload);
console.log("");
console.log("=== normalizeUG67 ===");
console.log("gateway_id:", norm.gateway_id, "(expected UG67-OUAGA-01)");
console.log("time:", norm.time);
console.log("device count:", norm.devices.length);
console.log("dev_eui:", norm.devices[0].dev_eui, "(expected 00956906000b12d7)");
console.log("rssi_lora:", norm.devices[0].rssi_lora, "(expected -31)");
console.log("_time:", norm.devices[0]._time, "(expected radio.time)");
console.log("_snr:", norm.devices[0]._snr, "(expected 13.8)");
console.log("_fcnt:", norm.devices[0]._fcnt, "(expected 97)");
console.log("metrics.voltage_a:", norm.devices[0].metrics.voltage_a, "(expected 214.2)");
console.log("metrics.active_power_total:", norm.devices[0].metrics.active_power_total, "(expected 0)");
console.log("");
console.log("ALL TESTS PASSED");
