const express = require("express");
const router = express.Router();

const { corePool, telemetryPool } = require("../config/db");
const { telemetryQueue } = require("../jobs/queues");
const {
  pickMetrics,
  makeDeviceKey,
  lookupPoint,
  buildUpsertSQL,
  isIsoDateString,
  applyCT,
} = require("../shared/acrel");
const { isUG67Batch, normalizeUG67 } = require("../shared/ug67-normalizer");

// ─────────────────────────────────────────────────────────────
// POST /milesight
// Single entry point for ALL Milesight gateways (UG67).
// ─────────────────────────────────────────────────────────────
router.post("/milesight", async (req, res) => {
  try {
    let payload = req.body || {};
    console.log("[INGEST/MILESIGHT] payload received:", JSON.stringify(payload).substring(0, 500));
    if (isUG67Batch(payload)) {
      payload = normalizeUG67(payload);
    }

    const gatewayId = payload.gateway?.id ?? payload.gateway_id;
    console.log("[INGEST/MILESIGHT] gatewayId:", gatewayId);

    if (!gatewayId) {
      return res.status(400).json({ ok: false, error: "gateway_id is required (payload.gateway.id)" });
    }

    const time = payload.time
      ? new Date(payload.time).toISOString()
      : new Date().toISOString();
    const source = payload.source || {};
    console.log("[INGEST/MILESIGHT] time:", time, "source:", source);

    // ── Normalise to devices array ──
    let devices;
    if (Array.isArray(payload.devices) && payload.devices.length > 0) {
      devices = payload.devices;
    } else {
      devices = [
        {
          modbus_addr: payload.modbus_addr ?? payload.device?.modbus_addr ?? null,
          dev_eui: payload.dev_eui ?? payload.device?.lora_dev_eui ?? null,
          rssi_lora: payload.device?.rssi_lora ?? null,
          metrics: payload.metrics || {},
          raw: payload.raw || payload,
        },
      ];
    }
    console.log("[INGEST/MILESIGHT] devices normalized:", devices.length);

    // ── 1) Gateway lookup ──
    console.log("[INGEST/MILESIGHT] querying gateway_registry for:", gatewayId);
    const gw = await corePool.query(
      `SELECT terrain_id FROM gateway_registry WHERE gateway_id = $1`,
      [gatewayId]
    );
    console.log("[INGEST/MILESIGHT] gateway lookup result:", gw.rows.length);
    const terrainId = gw.rows[0]?.terrain_id || null;

    // ── 2) Gateway NOT mapped → buffer everything ──
    if (!terrainId) {
      const buffered = [];
      for (const dev of devices) {
        const modbusAddr = dev.modbus_addr ?? null;
        const devEui = dev.dev_eui ?? dev.lora_dev_eui ?? null;
        const deviceKey = makeDeviceKey(modbusAddr, devEui);

        const payloadRaw = {
          time,
          gateway_id: gatewayId,
          source,
          device: { modbus_addr: modbusAddr, lora_dev_eui: devEui, rssi_lora: dev.rssi_lora ?? null },
          metrics: dev.metrics || {},
          raw: dev,
        };

        const ins = await corePool.query(
          `INSERT INTO incoming_messages
             (gateway_id, topic, device_key, modbus_addr, dev_eui, payload_raw)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           RETURNING id, device_key, status`,
          [gatewayId, "ingest/milesight", deviceKey, modbusAddr, devEui, JSON.stringify(payloadRaw)]
        );
        buffered.push(ins.rows[0]);
      }

      return res.status(202).json({
        ok: true,
        status: "buffered",
        reason: "gateway not mapped to any terrain",
        gateway_id: gatewayId,
        count: buffered.length,
        messages: buffered,
      });
    }

    // ── 3) Gateway IS mapped → resolve hierarchy ──
    const terrainInfo = await corePool.query(
      `SELECT t.id AS terrain_id, t.site_id, s.organization_id AS org_id
       FROM terrains t
       JOIN sites s ON s.id = t.site_id
       WHERE t.id = $1`,
      [terrainId]
    );

    if (!terrainInfo.rows.length) {
      return res.status(409).json({ ok: false, error: "terrain linked to gateway no longer exists" });
    }

    const { org_id, site_id } = terrainInfo.rows[0];

    const results = [];
    let ingested = 0;
    let bufferedCount = 0;

    for (const dev of devices) {
      const modbusAddr = dev.modbus_addr ?? null;
      const devEui = dev.dev_eui ?? dev.lora_dev_eui ?? null;
      const deviceKey = makeDeviceKey(modbusAddr, devEui);
      const metrics = dev.metrics || {};

      const devTime = dev._time
        ? new Date(dev._time).toISOString()
        : time;

      // ── Device lookup in registry ──
      const dr = await corePool.query(
        `SELECT point_id FROM device_registry WHERE terrain_id = $1 AND device_key = $2`,
        [terrainId, deviceKey]
      );
      const pointId = dr.rows[0]?.point_id || null;

      // ── Device NOT mapped → buffer with terrain known ──
      if (!pointId) {
        const payloadRaw = {
          time: devTime,
          gateway_id: gatewayId,
          source,
          device: { modbus_addr: modbusAddr, lora_dev_eui: devEui, rssi_lora: dev.rssi_lora ?? null },
          metrics,
          raw: dev,
        };
        await corePool.query(
          `INSERT INTO incoming_messages
             (gateway_id, topic, device_key, modbus_addr, dev_eui, status, mapped_terrain_id, payload_raw)
           VALUES ($1, $2, $3, $4, $5, 'unmapped', $6, $7::jsonb)`,
          [gatewayId, "ingest/milesight", deviceKey, modbusAddr, devEui, terrainId, JSON.stringify(payloadRaw)]
        );
        bufferedCount++;
        results.push({ device_key: deviceKey, status: "buffered", reason: "device not mapped to measurement_point" });
        continue;
      }

      // ── Device IS mapped → direct ingestion ──
      corePool
        .query(`UPDATE device_registry SET last_seen_at = NOW() WHERE terrain_id = $1 AND device_key = $2`, [terrainId, deviceKey])
        .catch(() => {});

      // Lookup CT ratio for this measurement point
      const mpRow = await corePool.query(
        `SELECT ct_ratio FROM measurement_points WHERE id = $1`,
        [pointId]
      );
      const ctRatio = Number(mpRow.rows[0]?.ct_ratio) || 1;

      const picked = pickMetrics(metrics);
      // Apply CT ratio: multiply all current-derived metrics
      applyCT(picked, ctRatio);

      picked.rssi_lora = dev.rssi_lora ?? null;
      picked.rssi_gateway = source.rssi_gateway ?? null;
      picked.snr_gateway = dev._snr ?? source.snr_gateway ?? null;
      picked.f_cnt = dev._fcnt ?? source.f_cnt ?? null;

      const raw = dev.raw ?? dev;
      const { sql, values } = buildUpsertSQL({
        time: devTime,
        orgId: org_id,
        siteId: site_id,
        terrainId,
        pointId,
        metrics: picked,
        raw,
      });

      try {
        const inserted = await telemetryPool.query(sql, values);

        await telemetryQueue.add(
          "acrel.ingested",
          { pointId, time: inserted.rows[0].time, terrainId, siteId: site_id, orgId: org_id },
          { attempts: 1 }
        );

        ingested++;
        results.push({ device_key: deviceKey, status: "ingested", point_id: pointId });
      } catch (e) {
        results.push({ device_key: deviceKey, status: "error", error: e.message });
      }
    }

    return res.json({
      ok: true,
      gateway_id: gatewayId,
      terrain_id: terrainId,
      time,
      summary: { total: devices.length, ingested, buffered: bufferedCount },
      results,
    });
  } catch (e) {
    console.error("[INGEST/MILESIGHT] ERROR:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /acrel
// Direct injection for already-mapped devices (manual / import).
// ─────────────────────────────────────────────────────────────
router.post("/acrel", async (req, res) => {
  const payload = req.body || {};

  if (Array.isArray(payload.devices)) {
    const terrainId = payload.terrain_id;
    if (!terrainId || typeof terrainId !== "string") {
      return res.status(400).json({ error: "terrain_id is required (uuid string)" });
    }

    if (payload.time && !isIsoDateString(payload.time)) {
      return res.status(400).json({ error: "time must be an ISO string if provided" });
    }

    const time = payload.time ? new Date(payload.time).toISOString() : new Date().toISOString();
    const source = payload.source || {};
    const rssi_gateway = source.rssi_gateway ?? null;
    const snr_gateway = source.snr_gateway ?? null;
    const f_cnt = source.f_cnt ?? null;

    const results = [];
    let okCount = 0;
    let failCount = 0;

    for (let d = 0; d < payload.devices.length; d++) {
      const block = payload.devices[d] || {};
      const device = block.device || {};
      const metrics = block.metrics || {};

      const modbusAddr = device.modbus_addr;
      const loraDevEui = device.lora_dev_eui ?? null;

      if (!Number.isInteger(modbusAddr) && (!loraDevEui || typeof loraDevEui !== "string")) {
        failCount++;
        results.push({ index: d, ok: false, error: "device.modbus_addr (int) required or device.lora_dev_eui (string) fallback" });
        continue;
      }

      const ref = await lookupPoint({ terrainId, modbusAddr, loraDevEui });
      if (!ref) {
        failCount++;
        results.push({ index: d, ok: false, error: "Measurement point not found for this device in this terrain" });
        continue;
      }

      const rssi_lora = device.rssi_lora ?? null;

      const picked = pickMetrics(metrics);
      // Apply CT ratio correction
      applyCT(picked, Number(ref.ct_ratio) || 1);

      picked.rssi_lora = rssi_lora;
      picked.rssi_gateway = rssi_gateway;
      picked.snr_gateway = snr_gateway;
      picked.f_cnt = f_cnt;

      const raw = block.raw ?? block ?? payload;
      const { sql, values } = buildUpsertSQL({
        time, orgId: ref.org_id, siteId: ref.site_id,
        terrainId: ref.terrain_id, pointId: ref.point_id,
        metrics: picked, raw,
      });

      try {
        const inserted = await telemetryPool.query(sql, values);

        await telemetryQueue.add(
          "acrel.ingested",
          {
            pointId: ref.point_id,
            time: inserted.rows[0].time,
            terrainId: ref.terrain_id,
            siteId: ref.site_id,
            orgId: ref.org_id
          },
          { attempts: 1 }
        );

        okCount++;
        results.push({ index: d, ok: true, inserted: inserted.rows[0], ref });
      } catch (e) {
        failCount++;
        results.push({ index: d, ok: false, error: e.message });
      }
    }

    return res.status(207).json({
      ok: failCount === 0,
      mode: "multi_devices_single_timestamp",
      time,
      terrain_id: terrainId,
      summary: { total: payload.devices.length, ok: okCount, failed: failCount },
      results
    });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /acrel/batch
// Batch injection with per-device items (each with its own time).
// ─────────────────────────────────────────────────────────────
router.post("/acrel/batch", async (req, res) => {
  const payload = req.body || {};

  const terrainId = payload.terrain_id;
  if (!terrainId || typeof terrainId !== "string") {
    return res.status(400).json({ error: "terrain_id is required (uuid string)" });
  }

  const source = payload.source || {};
  const devices = payload.devices;

  if (!Array.isArray(devices) || devices.length === 0) {
    return res.status(400).json({ error: "devices must be a non-empty array" });
  }

  const rssi_gateway = source.rssi_gateway ?? null;
  const snr_gateway = source.snr_gateway ?? null;
  const f_cnt = source.f_cnt ?? null;

  const batchSummary = {
    devices: devices.length,
    total_items: 0,
    ok: 0,
    failed: 0
  };

  const results = [];

  for (let d = 0; d < devices.length; d++) {
    const devBlock = devices[d] || {};
    const device = devBlock.device || {};
    const items = devBlock.items;

    const modbusAddr = device.modbus_addr;
    const loraDevEui = device.lora_dev_eui ?? null;

    if (!Array.isArray(items) || items.length === 0) {
      batchSummary.failed++;
      results.push({
        device_index: d,
        ok: false,
        error: "items must be a non-empty array for each device"
      });
      continue;
    }

    if (!Number.isInteger(modbusAddr) && (!loraDevEui || typeof loraDevEui !== "string")) {
      batchSummary.failed++;
      results.push({
        device_index: d,
        ok: false,
        error: "device.modbus_addr (int) required, or device.lora_dev_eui (string) fallback"
      });
      continue;
    }

    let ref;
    try {
      ref = await lookupPoint({ terrainId, modbusAddr, loraDevEui });
      if (!ref) {
        batchSummary.failed++;
        results.push({
          device_index: d,
          ok: false,
          error: "Measurement point not found for this device in this terrain"
        });
        continue;
      }
    } catch (e) {
      batchSummary.failed++;
      results.push({
        device_index: d,
        ok: false,
        error: `lookup failed: ${e.message}`
      });
      continue;
    }

    const rssi_lora = device.rssi_lora ?? null;

    const deviceResult = {
      device_index: d,
      point_id: ref.point_id,
      modbus_addr: modbusAddr ?? null,
      ok: 0,
      failed: 0,
      items: []
    };

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      batchSummary.total_items++;

      try {
        if (it.time && !isIsoDateString(it.time)) {
          throw new Error("invalid time (ISO expected)");
        }

        const time = it.time ? new Date(it.time).toISOString() : new Date().toISOString();
        const metrics = it.metrics || {};

        const picked = pickMetrics(metrics);
        // Apply CT ratio correction
        applyCT(picked, Number(ref.ct_ratio) || 1);

        picked.rssi_lora = rssi_lora;
        picked.rssi_gateway = rssi_gateway;
        picked.snr_gateway = snr_gateway;
        picked.f_cnt = f_cnt;

        const raw = it.raw ?? it ?? payload;
        const { sql, values } = buildUpsertSQL({
          time, orgId: ref.org_id, siteId: ref.site_id,
          terrainId: ref.terrain_id, pointId: ref.point_id,
          metrics: picked, raw,
        });

        const inserted = await telemetryPool.query(sql, values);

        await telemetryQueue.add(
          "acrel.ingested",
          {
            pointId: ref.point_id,
            time: inserted.rows[0].time,
            terrainId: ref.terrain_id,
            siteId: ref.site_id,
            orgId: ref.org_id
          },
          { attempts: 1 }
        );

        batchSummary.ok++;
        deviceResult.ok++;
        deviceResult.items.push({ index: i, ok: true, inserted: inserted.rows[0] });
      } catch (e) {
        batchSummary.failed++;
        deviceResult.failed++;
        deviceResult.items.push({ index: i, ok: false, error: e.message });
      }
    }

    results.push(deviceResult);
  }

  return res.status(207).json({
    ok: batchSummary.failed === 0,
    terrain_id: terrainId,
    summary: batchSummary,
    results
  });
});

module.exports = router;
