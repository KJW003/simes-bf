/**
 * ug67-normalizer.js
 *
 * Transforms the native UG67 gateway batch payload into the internal
 * format expected by the /ingest/milesight handler.
 *
 * UG67 input format:
 * {
 *   gateway: { id, ts_batch_start, ts_batch_end },
 *   window_sec: 600,
 *   devices: [{
 *     devEUI, meta, radio: { rssi, snr, fcnt, time, ... },
 *     snapshot: { Ua, Ub, P, ... }
 *   }]
 * }
 *
 * Internal output format (what the milesight handler processes):
 * {
 *   gateway_id: "UG67-OUAGA-01",
 *   time: <ISO>,
 *   source: { rssi_gateway, snr_gateway, f_cnt },
 *   devices: [{
 *     dev_eui: "00956906000b12d7",
 *     rssi_lora: -31,
 *     metrics: { voltage_a: 214.2, ... },
 *     raw: <original device block>
 *   }]
 * }
 */

const { mapSnapshot } = require("./acrel-field-map");

/**
 * Detect whether a payload is in UG67 native batch format.
 */
function isUG67Batch(payload) {
  return (
    payload &&
    typeof payload.gateway === "object" &&
    typeof payload.gateway.id === "string" &&
    Array.isArray(payload.devices) &&
    payload.devices.length > 0 &&
    payload.devices[0].snapshot !== undefined
  );
}

/**
 * Normalise one UG67 device block into internal device format.
 */
function normalizeDevice(dev) {
  const radio = dev.radio || {};
  const { metrics } = mapSnapshot(dev.snapshot);

  return {
    dev_eui: dev.devEUI || dev.devEui || dev.dev_eui || null,
    modbus_addr: dev.modbus_addr ?? null,
    rssi_lora: radio.rssi ?? null,
    metrics,
    raw: dev, // keep full original block for traceability
    _time: radio.time || dev.meta?.lastSeen || null,   // per-device time
    _snr: radio.snr ?? null,
    _fcnt: radio.fcnt ?? radio.fCnt ?? null,
  };
}

/**
 * Transform the entire UG67 batch payload into the internal format.
 * Returns ONE normalized payload per device (each with its own time).
 */
function normalizeUG67(payload) {
  const gatewayId = payload.gateway?.id;
  const batchTime = payload.gateway?.ts_batch_end
    || payload.gateway?.ts_batch_start
    || new Date().toISOString();

  const devices = (payload.devices || []).map((dev) => {
    const norm = normalizeDevice(dev);
    return norm;
  });

  return {
    gateway_id: gatewayId,
    time: batchTime,
    source: {
      batch_start: payload.gateway?.ts_batch_start || null,
      batch_end: payload.gateway?.ts_batch_end || null,
      window_sec: payload.window_sec ?? null,
    },
    devices: devices.map((d) => ({
      dev_eui: d.dev_eui,
      modbus_addr: d.modbus_addr,
      rssi_lora: d.rssi_lora,
      metrics: d.metrics,
      raw: d.raw,
      // per-device overrides (consumed by the handler)
      _time: d._time,
      _snr: d._snr,
      _fcnt: d._fcnt,
    })),
    _raw_batch: payload, // full original payload for audit
  };
}

module.exports = { isUG67Batch, normalizeUG67, normalizeDevice };
