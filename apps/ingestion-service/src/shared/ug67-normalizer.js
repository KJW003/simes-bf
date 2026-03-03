/**
 * ug67-normalizer.js
 *
 * Transforms the native UG67 gateway batch payload into the internal
 * format expected by the /milesight handler.
 */

const { mapSnapshot } = require("./acrel-field-map");

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

function normalizeDevice(dev) {
  const radio = dev.radio || {};
  const { metrics } = mapSnapshot(dev.snapshot);

  return {
    dev_eui: dev.devEUI || dev.devEui || dev.dev_eui || null,
    modbus_addr: dev.modbus_addr ?? null,
    rssi_lora: radio.rssi ?? null,
    metrics,
    raw: dev,
    _time: radio.time || dev.meta?.lastSeen || null,
    _snr: radio.snr ?? null,
    _fcnt: radio.fcnt ?? radio.fCnt ?? null,
  };
}

function normalizeUG67(payload) {
  const gatewayId = payload.gateway?.id;
  const batchTime = payload.gateway?.ts_batch_end
    || payload.gateway?.ts_batch_start
    || new Date().toISOString();

  const devices = (payload.devices || []).map(normalizeDevice);

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
      _time: d._time,
      _snr: d._snr,
      _fcnt: d._fcnt,
    })),
    _raw_batch: payload,
  };
}

module.exports = { isUG67Batch, normalizeUG67, normalizeDevice };
