const express = require("express");
const router = express.Router();
const {corePool, telemetryPool} = require("../../config/db");
const { makeDeviceKey } = require("../../shared/acrel");
const { requireAuth } = require("../../shared/auth-middleware");
const { telemetryQueue } = require("../../jobs/queues");
const { auditLog } = require("../../shared/audit-log");
const JobTypes = require("../../jobs/jobTypes");
const log = require("../../config/logger");

// 1) Inject a fake "MQTT" message (for tomorrow tests / UI dev)
router.post("/admin/incoming/sandbox", requireAuth, async (req, res) => {
  try {
    const {
      topic = "sandbox/topic",
      gateway_id = null,
      modbus_addr = null,
      dev_eui = null,
      time = null,
      metrics = {},
      source = {},
      device = {},
      devices = null,
      raw = {},
    } = req.body || {};

    const messages = [];

    // Handle multi-device format
    if (Array.isArray(devices) && devices.length > 0) {
      for (const devBlock of devices) {
        const dev = devBlock.device || {};
        const dev_modbus = dev.modbus_addr ?? null;
        const dev_eui_val = dev.lora_dev_eui ?? null;
        const device_key = makeDeviceKey({ modbus_addr: dev_modbus, dev_eui: dev_eui_val });

        const payload_raw = {
          time,
          gateway_id,
          topic,
          source,
          device: dev,
          metrics: devBlock.metrics || metrics,
          raw: devBlock.raw ?? raw,
        };

        const ins = await corePool.query(
          `INSERT INTO incoming_messages (gateway_id, topic, device_key, modbus_addr, dev_eui, payload_raw)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           RETURNING id, received_at, gateway_id, topic, device_key, status`,
          [gateway_id, topic, device_key, dev_modbus, dev_eui_val, JSON.stringify(payload_raw)]
        );

        messages.push(ins.rows[0]);
      }
    } else {
      // Single device format (backward compat)
      const device_key = makeDeviceKey({ modbus_addr, dev_eui, device });

      const payload_raw = {
        time,
        gateway_id,
        topic,
        source,
        device: { ...device, modbus_addr, dev_eui },
        metrics,
        raw,
      };

      const ins = await corePool.query(
        `INSERT INTO incoming_messages (gateway_id, topic, device_key, modbus_addr, dev_eui, payload_raw)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, received_at, gateway_id, topic, device_key, status`,
        [gateway_id, topic, device_key, modbus_addr, dev_eui, JSON.stringify(payload_raw)]
      );

      messages.push(ins.rows[0]);
    }

    res.status(201).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2) List incoming stream (admin view)
router.get("/admin/incoming", requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null; // unmapped|mapped|ignored
    const gatewayId = req.query.gateway_id || null;

    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (gatewayId) {
      params.push(gatewayId);
      where.push(`gateway_id = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const r = await corePool.query(
      `SELECT id, received_at, gateway_id, topic, device_key, modbus_addr, dev_eui, status,
              mapped_terrain_id, mapped_point_id, payload_raw
       FROM incoming_messages
       ${whereSql}
       ORDER BY received_at DESC
       LIMIT 200`,
      params
    );

    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 3) Map a gateway to a terrain (1 Gateway = 1 Terrain, 1 Terrain = 1 Gateway)
router.put("/admin/gateways/:gatewayId/map", requireAuth, async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const { terrain_id, meta = {} } = req.body || {};

    if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });

    // Enforce: 1 terrain = 1 gateway (reject if terrain already has a DIFFERENT gateway)
    const existing = await corePool.query(
      `SELECT gateway_id FROM gateway_registry WHERE terrain_id = $1 AND gateway_id != $2`,
      [terrain_id, gatewayId]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        ok: false,
        error: `Ce terrain est déjà lié au concentrateur « ${existing.rows[0].gateway_id} ». 1 terrain = 1 concentrateur.`,
      });
    }

    const up = await corePool.query(
      `INSERT INTO gateway_registry (gateway_id, terrain_id, meta)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (gateway_id)
       DO UPDATE SET terrain_id = EXCLUDED.terrain_id, meta = EXCLUDED.meta, updated_at = now()
       RETURNING gateway_id, terrain_id, meta`,
      [gatewayId, terrain_id, JSON.stringify(meta)]
    );

    // Gateway mapping does NOT change incoming_messages status.
    // Status will be set to 'mapped' ONLY when the DEVICE is mapped to a measurement point.

    res.json({ ok: true, gateway: up.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 4) Map a device_key to a measurement_point
// This is the ONLY way a message becomes 'mapped'.
// body: { terrain_id, point_id, modbus_addr?, dev_eui? }
router.put("/admin/devices/:deviceKey/map", requireAuth, async (req, res) => {
  try {
    const { deviceKey } = req.params;
    const { terrain_id, point_id, modbus_addr = null, dev_eui = null } = req.body || {};

    if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });
    if (!point_id) return res.status(400).json({ ok: false, error: "point_id is required" });

    // Enforce 1:1 device-to-measurement-point constraint:
    // Reject if this point is already mapped to a DIFFERENT device
    const conflictCheck = await corePool.query(
      `SELECT device_key FROM device_registry 
       WHERE point_id = $1 AND device_key != $2`,
      [point_id, deviceKey]
    );
    
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: `This measurement point is already mapped to device '${conflictCheck.rows[0].device_key}'. A measurement point can only be linked to one device.`
      });
    }

    const up = await corePool.query(
      `INSERT INTO device_registry (terrain_id, device_key, modbus_addr, dev_eui, point_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (terrain_id, device_key)
       DO UPDATE SET modbus_addr = EXCLUDED.modbus_addr, dev_eui = EXCLUDED.dev_eui,
                     point_id = EXCLUDED.point_id, updated_at = now()
       RETURNING terrain_id, device_key, point_id, modbus_addr, dev_eui`,
      [terrain_id, deviceKey, modbus_addr, dev_eui, point_id]
    );

    // Update measurement_point with the device's DevEUI/Modbus (if not already set)
    if (dev_eui || modbus_addr !== null) {
      await corePool.query(
        `UPDATE measurement_points
         SET lora_dev_eui = COALESCE(lora_dev_eui, $1),
             modbus_addr = COALESCE(modbus_addr, $2)
         WHERE id = $3`,
        [dev_eui, modbus_addr, point_id]
      );
    }

    // Mark matching messages as 'mapped' — device is now linked to a measurement point
    // Only messages whose gateway is registered to this terrain
    await corePool.query(
      `UPDATE incoming_messages im
       SET status = 'mapped',
           mapped_terrain_id = $3,
           mapped_point_id = $2
       WHERE im.device_key = $1
         AND im.status = 'unmapped'
         AND im.gateway_id IN (
           SELECT gateway_id FROM gateway_registry WHERE terrain_id = $3
         )`,
      [deviceKey, point_id, terrain_id]
    );

    // Enqueue job to process historical messages for this device
    try {
      await telemetryQueue.add(
        JobTypes.PROCESS_HISTORICAL_MESSAGES,
        { device_key: deviceKey, terrain_id, point_id },
        { attempts: 1 }
      );
    } catch (jobErr) {
      log.warn({ err: jobErr.message }, 'Failed to enqueue PROCESS_HISTORICAL_MESSAGES job');
      // Don't fail the entire request if job enqueue fails
    }

    res.json({ ok: true, device: up.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5) Replay a raw message into /ingest/acrel (only if mapped)
// Uses internal HTTP call to api-core itself (works local and VPS)
router.post("/admin/incoming/:id/replay", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const msg = await corePool.query(`SELECT * FROM incoming_messages WHERE id = $1`, [id]);
    if (!msg.rows.length) return res.status(404).json({ ok: false, error: "incoming message not found" });
    const row = msg.rows[0];

    // Resolve terrain_id from gateway_registry (if possible)
    let terrainId = row.mapped_terrain_id;
    if (!terrainId && row.gateway_id) {
      const g = await corePool.query(`SELECT terrain_id FROM gateway_registry WHERE gateway_id = $1`, [row.gateway_id]);
      terrainId = g.rows[0]?.terrain_id || null;
    }

    if (!terrainId) return res.status(409).json({ ok: false, error: "gateway not mapped to terrain yet" });

    // Resolve point_id from device_registry (terrain scoped)
    let pointId = row.mapped_point_id;
    if (!pointId && row.device_key) {
      const d = await corePool.query(
        `SELECT point_id FROM device_registry WHERE terrain_id = $1 AND device_key = $2`,
        [terrainId, row.device_key]
      );
      pointId = d.rows[0]?.point_id || null;
    }
    if (!pointId) return res.status(409).json({ ok: false, error: "device not mapped to measurement_point yet" });

    const payload = row.payload_raw || {};
    // IMPORTANT: Use the original message arrival time, NOT current time
    // This ensures historical messages keep their original timestamps
    const msgTime = payload.time ? new Date(payload.time).toISOString() : new Date(row.received_at).toISOString();

    // Build ingestion payload in multi-device format expected by /ingest/acrel
    const ingestPayload = {
      time: msgTime,
      terrain_id: terrainId,
      source: payload.source ?? {},
      devices: [
        {
          device: {
            modbus_addr: row.modbus_addr ?? payload?.device?.modbus_addr ?? null,
            lora_dev_eui: row.dev_eui ?? payload?.device?.lora_dev_eui ?? null,
            rssi_lora: payload?.device?.rssi_lora ?? null,
          },
          metrics: payload.metrics ?? {},
          raw: payload,
        },
      ],
    };

    // Call the ingestion endpoint
    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    const resp = await fetch(`${ingestServiceUrl}/acrel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ingestPayload),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return res.status(resp.status).json({ ok: false, error: data.error || "ingest failed", data });

    // Mark message as mapped/replayed
    await corePool.query(
      `UPDATE incoming_messages
       SET status='mapped', mapped_terrain_id=$2, mapped_point_id=$3
       WHERE id=$1`,
      [id, terrainId, pointId]
    );

    res.json({ ok: true, replayed: true, ingest: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5b) Process historical messages: replay all incoming_messages for a mapped device
// POST /admin/devices/:terrain_id/:device_key/process-historical
// Transforms unmapped/buffered messages into acrel_readings after device is mapped
router.post("/admin/devices/:terrain_id/:device_key/process-historical", requireAuth, async (req, res) => {
  try {
    const { terrain_id: terrainId, device_key: deviceKey } = req.params;

    // Resolve point_id from device_registry
    const deviceReg = await corePool.query(
      `SELECT point_id FROM device_registry WHERE terrain_id = $1 AND device_key = $2`,
      [terrainId, deviceKey]
    );
    if (!deviceReg.rows.length) {
      return res.status(404).json({ ok: false, error: "device not mapped to measurement_point" });
    }
    const pointId = deviceReg.rows[0].point_id;

    // Find all incoming_messages for this device that have a payload but weren't ingested
    // (status='mapped' or 'unmapped' but mapped_point_id is set)
    const msgs = await corePool.query(
      `SELECT id, received_at, payload_raw, modbus_addr, dev_eui
       FROM incoming_messages
       WHERE device_key = $1
         AND (status = 'mapped' OR (status = 'unmapped' AND mapped_point_id = $2))
         AND payload_raw IS NOT NULL
       ORDER BY received_at ASC`,
      [deviceKey, pointId]
    );

    if (!msgs.rows.length) {
      return res.json({
        ok: true,
        message: "No messages to process",
        terrain_id: terrainId,
        device_key: deviceKey,
        processed: 0,
      });
    }

    // Gateway must be mapped to terrain
    const gw = await corePool.query(
      `SELECT gateway_id FROM gateway_registry WHERE terrain_id = $1`,
      [terrainId]
    );
    if (!gw.rows.length) {
      return res.status(409).json({ ok: false, error: "gateway not mapped to terrain" });
    }
    const gatewayId = gw.rows[0].gateway_id;

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    const results = [];
    let processed = 0;
    let failed = 0;

    for (const msg of msgs.rows) {
      const payload = msg.payload_raw || {};
      // IMPORTANT: Use the original message arrival time, NOT current time
      // This ensures historical messages keep their original timestamps
      const msgTime = payload.time ? new Date(payload.time).toISOString() : new Date(msg.received_at).toISOString();

      // Build ingestion payload
      const ingestPayload = {
        time: msgTime,
        terrain_id: terrainId,
        source: payload.source ?? {},
        devices: [
          {
            device: {
              modbus_addr: msg.modbus_addr ?? payload?.device?.modbus_addr ?? null,
              lora_dev_eui: msg.dev_eui ?? payload?.device?.lora_dev_eui ?? null,
              rssi_lora: payload?.device?.rssi_lora ?? null,
            },
            metrics: payload.metrics ?? {},
            raw: payload,
          },
        ],
      };

      try {
        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          failed++;
          results.push({ message_id: msg.id, ok: false, error: data.error || "ingest failed" });
          continue;
        }

        // Mark message as mapped
        await corePool.query(
          `UPDATE incoming_messages
           SET status = 'mapped', mapped_terrain_id = $2, mapped_point_id = $3
           WHERE id = $1`,
          [msg.id, terrainId, pointId]
        ).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    res.json({
      ok: true,
      terrain_id: terrainId,
      device_key: deviceKey,
      point_id: pointId,
      summary: { total: msgs.rows.length, processed, failed },
      results: results.slice(0, 20), // Return first 20 results to avoid huge response
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 6) List registered gateways
// ─────────────────────────────────────────────────────────────
router.get("/admin/gateways", requireAuth, async (req, res) => {
  try {
    const r = await corePool.query(
      `SELECT gr.gateway_id, gr.terrain_id, gr.meta, gr.created_at, gr.updated_at,
              t.name AS terrain_name, s.name AS site_name, o.name AS org_name
       FROM gateway_registry gr
       LEFT JOIN terrains t ON t.id = gr.terrain_id
       LEFT JOIN sites s ON s.id = t.site_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       ORDER BY gr.updated_at DESC`
    );
    res.json({ ok: true, gateways: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 7) List discovered devices for a gateway (from incoming_messages)
// ─────────────────────────────────────────────────────────────
router.get("/admin/gateways/:gatewayId/devices", requireAuth, async (req, res) => {
  try {
    const { gatewayId } = req.params;

    const r = await corePool.query(
      `SELECT device_key, modbus_addr, dev_eui,
              COUNT(*) AS msg_count,
              MAX(received_at) AS last_seen,
              MIN(received_at) AS first_seen
       FROM incoming_messages
       WHERE gateway_id = $1 AND device_key IS NOT NULL AND device_key != 'unknown'
       GROUP BY device_key, modbus_addr, dev_eui
       ORDER BY device_key`,
      [gatewayId]
    );

    // Check which are already mapped
    const mapped = await corePool.query(
      `SELECT device_key, point_id FROM device_registry
       WHERE terrain_id = (SELECT terrain_id FROM gateway_registry WHERE gateway_id = $1)`,
      [gatewayId]
    );
    const mappedSet = new Map(mapped.rows.map((m) => [m.device_key, m.point_id]));

    const devices = r.rows.map((d) => ({
      ...d,
      mapped: mappedSet.has(d.device_key),
      point_id: mappedSet.get(d.device_key) || null,
    }));

    res.json({ ok: true, gateway_id: gatewayId, devices });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 8) Auto-provision: scan incoming for gateway devices,
//    create measurement_points + device_registry entries
//
// Body: { terrain_id?, device_model?, default_category? }
// ─────────────────────────────────────────────────────────────
router.post("/admin/gateways/:gatewayId/provision", requireAuth, async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const {
      terrain_id = null,
      device_model = "ADW300",
      default_category = "LOAD",
      default_ct_ratio = 1,
    } = req.body || {};

    // 1) Resolve terrain (from body or existing mapping)
    let terrainId = terrain_id;
    if (!terrainId) {
      const gw = await corePool.query(
        `SELECT terrain_id FROM gateway_registry WHERE gateway_id = $1`,
        [gatewayId]
      );
      terrainId = gw.rows[0]?.terrain_id;
    }

    if (!terrainId) {
      return res.status(400).json({
        ok: false,
        error: "terrain_id is required (gateway not yet mapped). Provide terrain_id in body or map gateway first.",
      });
    }

    // Ensure gateway ↔ terrain mapping exists
    await corePool.query(
      `INSERT INTO gateway_registry (gateway_id, terrain_id)
       VALUES ($1, $2)
       ON CONFLICT (gateway_id)
       DO UPDATE SET terrain_id = EXCLUDED.terrain_id, updated_at = NOW()`,
      [gatewayId, terrainId]
    );

    // 2) Find unique devices in incoming_messages for this gateway
    const msgs = await corePool.query(
      `SELECT DISTINCT device_key, modbus_addr, dev_eui
       FROM incoming_messages
       WHERE gateway_id = $1 AND device_key IS NOT NULL AND device_key != 'unknown'
       ORDER BY device_key`,
      [gatewayId]
    );

    if (!msgs.rows.length) {
      return res.json({
        ok: true,
        gateway_id: gatewayId,
        terrain_id: terrainId,
        message: "No devices found in incoming_messages for this gateway. Send some data first.",
        created: [],
        skipped: [],
      });
    }

    // 3) Batch-load existing mappings to avoid N+1 queries
    const deviceKeys = msgs.rows.map(r => r.device_key);
    const existingMappings = await corePool.query(
      `SELECT device_key, point_id FROM device_registry WHERE terrain_id = $1 AND device_key = ANY($2)`,
      [terrainId, deviceKeys]
    );
    const mappedDevices = new Map(existingMappings.rows.map(r => [r.device_key, r.point_id]));

    // Batch-load existing measurement points by modbus/eui
    const modbusAddrs = msgs.rows.map(r => r.modbus_addr).filter(a => a !== null);
    const devEuis = msgs.rows.map(r => r.dev_eui).filter(e => e !== null);

    const existingPointsByModbus = new Map();
    const existingPointsByEui = new Map();

    if (modbusAddrs.length > 0) {
      const mpByModbus = await corePool.query(
        `SELECT id, modbus_addr FROM measurement_points WHERE terrain_id = $1 AND modbus_addr = ANY($2)`,
        [terrainId, modbusAddrs]
      );
      mpByModbus.rows.forEach(r => existingPointsByModbus.set(r.modbus_addr, r.id));
    }
    if (devEuis.length > 0) {
      const mpByEui = await corePool.query(
        `SELECT id, lora_dev_eui FROM measurement_points WHERE terrain_id = $1 AND lora_dev_eui = ANY($2)`,
        [terrainId, devEuis]
      );
      mpByEui.rows.forEach(r => existingPointsByEui.set(r.lora_dev_eui, r.id));
    }

    const created = [];
    const skipped = [];

    for (const row of msgs.rows) {
      const deviceKey = row.device_key;
      const modbusAddr = row.modbus_addr;
      const devEui = row.dev_eui;

      // Already mapped? (from batch lookup)
      if (mappedDevices.has(deviceKey)) {
        skipped.push({ device_key: deviceKey, point_id: mappedDevices.get(deviceKey), reason: "already mapped" });
        continue;
      }

      // Check if measurement_point exists (from batch lookup)
      let pointId = null;
      if (modbusAddr !== null) pointId = existingPointsByModbus.get(modbusAddr) || null;
      if (!pointId && devEui) pointId = existingPointsByEui.get(devEui) || null;

      // Create measurement_point if needed
      if (!pointId) {
        const name =
          modbusAddr !== null
            ? `ACREL-${device_model}-Addr${modbusAddr}`
            : `ACREL-${device_model}-${devEui?.slice(-6) || "unknown"}`;

        const mp = await corePool.query(
          `INSERT INTO measurement_points
             (terrain_id, name, device, measure_category, modbus_addr, lora_dev_eui, ct_ratio)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING
           RETURNING id, name`,
          [terrainId, name, device_model, default_category, modbusAddr, devEui, default_ct_ratio]
        );

        if (mp.rows.length) {
          pointId = mp.rows[0].id;
        } else {
          // Name conflict → use suffixed name
          const nameAlt = `${name}-${Date.now().toString(36)}`;
          const mp2 = await corePool.query(
            `INSERT INTO measurement_points
               (terrain_id, name, device, measure_category, modbus_addr, lora_dev_eui, ct_ratio)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name`,
            [terrainId, nameAlt, device_model, default_category, modbusAddr, devEui, default_ct_ratio]
          );
          pointId = mp2.rows[0].id;
        }
      }

      // Create device_registry entry
      await corePool.query(
        `INSERT INTO device_registry (terrain_id, device_key, modbus_addr, dev_eui, point_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (terrain_id, device_key)
         DO UPDATE SET point_id = EXCLUDED.point_id, updated_at = NOW()`,
        [terrainId, deviceKey, modbusAddr, devEui, pointId]
      );

      created.push({ device_key: deviceKey, point_id: pointId, modbus_addr: modbusAddr, dev_eui: devEui });
    }

    // 4) Batch-update buffered messages for all provisioned devices
    let messagesUpdated = 0;
    if (created.length > 0) {
      const createdKeys = created.map(c => c.device_key);
      // Build a device_key → point_id mapping for the UPDATE
      const devicePointMap = new Map(created.map(c => [c.device_key, c.point_id]));
      
      // Use a CTE to join device_key with its point_id for batch update
      const upd = await corePool.query(
        `UPDATE incoming_messages
         SET status = 'mapped',
             mapped_terrain_id = $2,
             mapped_point_id = dr.point_id
         FROM device_registry dr
         WHERE incoming_messages.gateway_id = $1
           AND incoming_messages.device_key = ANY($3)
           AND incoming_messages.status = 'unmapped'
           AND dr.terrain_id = $2
           AND dr.device_key = incoming_messages.device_key`,
        [gatewayId, terrainId, createdKeys]
      );
      messagesUpdated = upd.rowCount ?? 0;
    }

    res.json({
      ok: true,
      gateway_id: gatewayId,
      terrain_id: terrainId,
      summary: {
        devices_found: msgs.rows.length,
        points_created: created.length,
        already_mapped: skipped.length,
        messages_updated: messagesUpdated,
      },
      created,
      skipped,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 9) Delete a single incoming message
router.delete("/admin/incoming/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const r = await corePool.query(`DELETE FROM incoming_messages WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 10) Delete incoming messages (bulk – by status or all)
router.delete("/admin/incoming", requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const gateway_id = req.query.gateway_id || null;
    const params = [];
    const where = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (gateway_id) { params.push(gateway_id); where.push(`gateway_id = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const r = await corePool.query(`DELETE FROM incoming_messages ${whereSql}`, params);
    res.json({ ok: true, deleted_count: r.rowCount ?? 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 8) Delete a gateway
router.delete("/admin/gateways/:gatewayId", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { gatewayId } = req.params;

    // Get terrain_id before deleting (needed to revert messages)
    const gwRow = await corePool.query(`SELECT terrain_id FROM gateway_registry WHERE gateway_id = $1`, [gatewayId]);
    const gwTerrainId = gwRow.rows[0]?.terrain_id;

    // Delete gateway mapping (FK CASCADE will also delete device_registry entries for this terrain)
    const result = await corePool.query(
      `DELETE FROM gateway_registry WHERE gateway_id = $1`,
      [gatewayId]
    );

    // Revert incoming_messages status: since gateway is no longer mapped, all related messages become unmapped
    if (gwTerrainId) {
      await corePool.query(
        `UPDATE incoming_messages
         SET status = 'unmapped', mapped_terrain_id = NULL, mapped_point_id = NULL
         WHERE gateway_id = $1 AND status = 'mapped'`,
        [gatewayId]
      );
    }

    res.json({
      ok: true,
      deleted: gatewayId,
      rowsDeleted: result.rowCount || 0
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 11) Reconcile: re-sync incoming_messages status based on actual gateway_registry + device_registry
router.post("/admin/incoming/reconcile", requireAuth, async (req, res) => {
  try {
    // A) Mark as 'mapped' messages that SHOULD be mapped (gateway + device both registered)
    const mapped = await corePool.query(
      `UPDATE incoming_messages
       SET status = 'mapped',
           mapped_terrain_id = gr.terrain_id,
           mapped_point_id = dr.point_id
       FROM gateway_registry gr, device_registry dr
       WHERE incoming_messages.gateway_id = gr.gateway_id
         AND dr.terrain_id = gr.terrain_id
         AND dr.device_key = incoming_messages.device_key
         AND incoming_messages.status = 'unmapped'`
    );

    // B) Mark as 'unmapped' messages that are falsely 'mapped' (gateway or device mapping was deleted)
    const unmapped = await corePool.query(
      `UPDATE incoming_messages
       SET status = 'unmapped', mapped_terrain_id = NULL, mapped_point_id = NULL
       WHERE incoming_messages.status = 'mapped'
         AND NOT EXISTS (
           SELECT 1
           FROM gateway_registry gr
           JOIN device_registry dr ON dr.terrain_id = gr.terrain_id AND dr.device_key = incoming_messages.device_key
           WHERE gr.gateway_id = incoming_messages.gateway_id
         )`
    );

    res.json({
      ok: true,
      reconciled_mapped: mapped.rowCount ?? 0,
      reconciled_unmapped: unmapped.rowCount ?? 0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/incoming/process-unmapped
// Process all unmapped messages that now have mapped devices
// This catches historical messages from before the mapping feature was implemented
router.post("/incoming/process-unmapped", async (req, res) => {
  try {
    // Find unmapped messages whose devices are now mapped
    // device_registry has point_id directly
    const messages = await corePool.query(
      `SELECT im.id, im.gateway_id, im.device_key, im.payload_raw, im.received_at,
              dr.terrain_id, dr.point_id
       FROM incoming_messages im
       JOIN device_registry dr ON dr.device_key = im.device_key
       WHERE im.status = 'unmapped'
       ORDER BY im.received_at ASC
       LIMIT 5000`
    );

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    let enqueued = 0;
    let failed = 0;
    const errors = [];

    for (const msg of messages.rows) {
      try {
        const payload = typeof msg.payload_raw === 'string'
          ? JSON.parse(msg.payload_raw)
          : (msg.payload_raw || {});
        
        // IMPORTANT: Use the original message arrival time, NOT current time
        const msgTime = payload.time 
          ? new Date(payload.time).toISOString() 
          : new Date(msg.received_at).toISOString();

        // Build payload in /acrel expected format
        const acrelPayload = {
          time: msgTime,
          terrain_id: msg.terrain_id,
          source: payload.source ?? {},
          devices: [{
            device: {
              modbus_addr: payload?.device?.modbus_addr ?? null,
              lora_dev_eui: payload?.device?.lora_dev_eui ?? null,
              rssi_lora: payload?.device?.rssi_lora ?? null,
            },
            metrics: payload.metrics ?? {},
            raw: payload,
          }],
        };

        const response = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(acrelPayload),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Ingestion service returned ${response.status}`);
        }

        // Delete message after successful processing
        await corePool.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]);

        enqueued++;
      } catch (err) {
        failed++;
        errors.push({ message_id: msg.id, error: err.message });
      }
    }

    res.json({
      ok: true,
      processed: messages.rows.length,
      enqueued,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/cleanup-unmapped-messages
// Immediately trigger cleanup of mapped messages without readings
router.post("/cleanup-unmapped-messages", async (req, res) => {
  try {
    const { telemetryQueue } = require("../../jobs/queues");

    const job = await telemetryQueue.add(
      "telemetry.cleanup_unmapped_messages",
      { payload: { limit: 1000 } },
      { priority: 10 }
    );

    res.json({
      ok: true,
      message: "Cleanup job enqueued",
      jobId: job.id,
      queue: "telemetry",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /admin/logs/cleanup
// View worker cleanup logs (for troubleshooting)
router.get("/logs/cleanup", requireAuth, async (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const logFile = "/app/logs/cleanup.log";

    if (!fs.existsSync(logFile)) {
      return res.json({
        ok: true,
        message: "No cleanup logs yet",
        logs: [],
      });
    }

    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());
    const lastN = parseInt(req.query.last || "50", 10);
    const recent = lines.slice(Math.max(0, lines.length - lastN));

    res.json({
      ok: true,
      total_lines: lines.length,
      returned: recent.length,
      logs: recent,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /admin/logs/scheduler
// View scheduler logs
router.get("/logs/scheduler", requireAuth, async (req, res) => {
  try {
    const fs = require("fs");
    const logFile = "/app/logs/scheduler.log";

    if (!fs.existsSync(logFile)) {
      return res.json({
        ok: true,
        message: "No scheduler logs yet",
        logs: [],
      });
    }

    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());
    const lastN = parseInt(req.query.last || "50", 10);
    const recent = lines.slice(Math.max(0, lines.length - lastN));

    res.json({
      ok: true,
      total_lines: lines.length,
      returned: recent.length,
      logs: recent,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DELETE readings for a specific point (with optional date range) ────
// DELETE /admin/readings/:pointId?from=...&to=...
// Backs up data to trash tables before deletion for recovery
router.delete("/admin/readings/:pointId", requireAuth, async (req, res) => {
  const { pointId } = req.params;
  const { from, to } = req.query;

  if (!pointId) return res.status(400).json({ ok: false, error: "pointId is required" });
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });

  const client = await telemetryPool.connect();
  try {
    // Verify the point exists
    const pointCheck = await corePool.query(
      `SELECT id, name FROM measurement_points WHERE id = $1`,
      [pointId]
    );
    if (pointCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ ok: false, error: "Point not found" });
    }
    const pointName = pointCheck.rows[0].name;

    // Build WHERE clause
    const conditions = ["point_id = $1"];
    const params = [pointId];
    let paramIdx = 2;
    if (from) { conditions.push(`time >= $${paramIdx}`); params.push(from); paramIdx++; }
    if (to) { conditions.push(`time <= $${paramIdx}`); params.push(to); paramIdx++; }
    const where = conditions.join(" AND ");

    const agg15Conditions = conditions.map(c => c.replace(/\btime\b/g, "bucket_start"));

    const aggDayConditions = ["point_id = $1"];
    const dayParams = [pointId];
    let dayIdx = 2;
    if (from) { aggDayConditions.push(`day >= ($${dayIdx})::date`); dayParams.push(from); dayIdx++; }
    if (to) { aggDayConditions.push(`day <= ($${dayIdx})::date`); dayParams.push(to); dayIdx++; }

    await client.query('BEGIN');

    // Create purge batch
    const batch = await client.query(
      `INSERT INTO purge_batches (deleted_by, point_ids, date_from, date_to, counts)
       VALUES ($1, $2, $3, $4, '{}') RETURNING id`,
      [req.userId || null, [pointId], from || null, to || null]
    );
    const batchId = batch.rows[0].id;

    // Backup + delete readings
    await client.query(
      `INSERT INTO acrel_readings_trash SELECT $${paramIdx}::uuid, r.* FROM acrel_readings r WHERE ${where}`,
      [...params, batchId]
    );
    const rReadings = await client.query(`DELETE FROM acrel_readings WHERE ${where}`, params);

    // Backup + delete agg_15m
    await client.query(
      `INSERT INTO acrel_agg_15m_trash SELECT $${paramIdx}::uuid, a.* FROM acrel_agg_15m a WHERE ${agg15Conditions.join(" AND ")}`,
      [...params, batchId]
    );
    const r15m = await client.query(`DELETE FROM acrel_agg_15m WHERE ${agg15Conditions.join(" AND ")}`, params);

    // Backup + delete agg_daily
    await client.query(
      `INSERT INTO acrel_agg_daily_trash SELECT $${dayIdx}::uuid, d.* FROM acrel_agg_daily d WHERE ${aggDayConditions.join(" AND ")}`,
      [...dayParams, batchId]
    );
    const rDay = await client.query(`DELETE FROM acrel_agg_daily WHERE ${aggDayConditions.join(" AND ")}`, dayParams);

    // Update batch with counts
    const counts = { readings: rReadings.rowCount, agg_15m: r15m.rowCount, agg_daily: rDay.rowCount };
    await client.query(`UPDATE purge_batches SET counts = $1 WHERE id = $2`, [JSON.stringify(counts), batchId]);

    await client.query('COMMIT');

    log.info({ point: pointName, pointId, batchId, from: from || 'ALL', to: to || 'ALL', ...counts }, 'purge completed (backed up)');
    auditLog('warn', 'api', `Purge données: ${pointName} (${counts.readings} readings, ${counts.agg_15m} agg15m, ${counts.agg_daily} daily) — batch ${batchId}`, {
      point_id: pointId, point_name: pointName, purge_batch_id: batchId,
      from: from || null, to: to || null, deleted: counts,
    }, req.userId || null);

    res.json({
      ok: true,
      point: pointName,
      purge_batch_id: batchId,
      deleted: counts,
      range: { from: from || null, to: to || null },
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: e.message }, 'purge error');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ─── BATCH DELETE readings for multiple points (with optional date range) ────
// POST /admin/readings/batch-purge
// Body: { pointIds: string[], from?: string, to?: string }
// Backs up data to trash tables before deletion for recovery
router.post("/admin/readings/batch-purge", requireAuth, async (req, res) => {
  const { pointIds = [], from, to } = req.body || {};

  if (!Array.isArray(pointIds) || pointIds.length === 0) {
    return res.status(400).json({ ok: false, error: "pointIds array is required and non-empty" });
  }
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });

  const client = await telemetryPool.connect();
  try {
    // Verify all points exist
    const pointCheck = await corePool.query(
      `SELECT id, name FROM measurement_points WHERE id = ANY($1)`,
      [pointIds]
    );
    const foundPoints = pointCheck.rows;
    if (foundPoints.length === 0) {
      client.release();
      return res.status(404).json({ ok: false, error: "No valid points found" });
    }
    const ids = foundPoints.map(p => p.id);

    // Build WHERE clauses
    const readingsConds = ['point_id = ANY($1)'];
    const readingsParams = [ids];
    let pIdx = 2;
    if (from) { readingsConds.push(`time >= $${pIdx}`); readingsParams.push(from); pIdx++; }
    if (to) { readingsConds.push(`time <= $${pIdx}`); readingsParams.push(to); pIdx++; }
    const readingsWhere = readingsConds.join(' AND ');
    const agg15Where = readingsConds.map(c => c.replace(/\btime\b/g, 'bucket_start')).join(' AND ');

    const dayConds = ['point_id = ANY($1)'];
    const dayParams = [ids];
    let dIdx = 2;
    if (from) { dayConds.push(`day >= ($${dIdx})::date`); dayParams.push(from); dIdx++; }
    if (to) { dayConds.push(`day <= ($${dIdx})::date`); dayParams.push(to); dIdx++; }
    const dayWhere = dayConds.join(' AND ');

    await client.query('BEGIN');

    // Create purge batch
    const batch = await client.query(
      `INSERT INTO purge_batches (deleted_by, point_ids, date_from, date_to, counts)
       VALUES ($1, $2, $3, $4, '{}') RETURNING id`,
      [req.userId || null, ids, from || null, to || null]
    );
    const batchId = batch.rows[0].id;

    // Backup + delete readings
    await client.query(
      `INSERT INTO acrel_readings_trash SELECT $${pIdx}::uuid, r.* FROM acrel_readings r WHERE ${readingsWhere}`,
      [...readingsParams, batchId]
    );
    const rReadings = await client.query(`DELETE FROM acrel_readings WHERE ${readingsWhere}`, readingsParams);

    // Backup + delete agg_15m
    await client.query(
      `INSERT INTO acrel_agg_15m_trash SELECT $${pIdx}::uuid, a.* FROM acrel_agg_15m a WHERE ${agg15Where}`,
      [...readingsParams, batchId]
    );
    const r15m = await client.query(`DELETE FROM acrel_agg_15m WHERE ${agg15Where}`, readingsParams);

    // Backup + delete agg_daily
    await client.query(
      `INSERT INTO acrel_agg_daily_trash SELECT $${dIdx}::uuid, d.* FROM acrel_agg_daily d WHERE ${dayWhere}`,
      [...dayParams, batchId]
    );
    const rDay = await client.query(`DELETE FROM acrel_agg_daily WHERE ${dayWhere}`, dayParams);

    const totals = { readings: rReadings.rowCount, agg_15m: r15m.rowCount, agg_daily: rDay.rowCount };
    await client.query(`UPDATE purge_batches SET counts = $1 WHERE id = $2`, [JSON.stringify(totals), batchId]);

    await client.query('COMMIT');

    auditLog('warn', 'api', `Batch purge ${ids.length} points: ${totals.readings} readings, ${totals.agg_15m} agg15m, ${totals.agg_daily} daily — batch ${batchId}`, {
      point_ids: ids, purge_batch_id: batchId, from: from || null, to: to || null,
    }, req.userId || null);

    log.info({ points: foundPoints.length, batchId, from: from || 'ALL', to: to || 'ALL', ...totals }, 'batch-purge completed (backed up)');

    res.json({
      ok: true,
      points_purged: foundPoints.length,
      point_ids: ids,
      purge_batch_id: batchId,
      totals,
      range: { from: from || null, to: to || null },
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: e.message }, 'batch-purge error');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ─── DELETE aggregation + readings for a date range (all points) ────
// POST /admin/readings/purge-range
// Body: { from: "2025-03-07", to: "2025-03-07", includeReadings?: boolean }
// Backs up data to trash tables before deletion for recovery
router.post("/admin/readings/purge-range", requireAuth, async (req, res) => {
  const { from, to, includeReadings = true } = req.body || {};
  if (!from || !to) return res.status(400).json({ ok: false, error: "from and to are required" });
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });

  const client = await telemetryPool.connect();
  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    const fromISO = fromDate.toISOString();
    const toISO = toDate.toISOString();

    await client.query('BEGIN');

    // Create purge batch (point_ids empty = all points in range)
    const batch = await client.query(
      `INSERT INTO purge_batches (deleted_by, point_ids, date_from, date_to, counts)
       VALUES ($1, '{}', $2, $3, '{}') RETURNING id`,
      [req.userId || null, fromISO, toISO]
    );
    const batchId = batch.rows[0].id;

    let readingsDeleted = 0;
    if (includeReadings) {
      await client.query(
        `INSERT INTO acrel_readings_trash SELECT $3::uuid, r.* FROM acrel_readings r WHERE time >= $1 AND time <= $2`,
        [fromISO, toISO, batchId]
      );
      const rr = await client.query(
        `DELETE FROM acrel_readings WHERE time >= $1 AND time <= $2`,
        [fromISO, toISO]
      );
      readingsDeleted = rr.rowCount;
    }

    await client.query(
      `INSERT INTO acrel_agg_15m_trash SELECT $3::uuid, a.* FROM acrel_agg_15m a WHERE bucket_start >= $1 AND bucket_start <= $2`,
      [fromISO, toISO, batchId]
    );
    const r15 = await client.query(
      `DELETE FROM acrel_agg_15m WHERE bucket_start >= $1 AND bucket_start <= $2`,
      [fromISO, toISO]
    );

    await client.query(
      `INSERT INTO acrel_agg_daily_trash SELECT $3::uuid, d.* FROM acrel_agg_daily d WHERE day >= ($1)::date AND day <= ($2)::date`,
      [from, to, batchId]
    );
    const rDay = await client.query(
      `DELETE FROM acrel_agg_daily WHERE day >= ($1)::date AND day <= ($2)::date`,
      [from, to]
    );

    const deleted = { readings: readingsDeleted, agg_15m: r15.rowCount, agg_daily: rDay.rowCount };
    await client.query(`UPDATE purge_batches SET counts = $1 WHERE id = $2`, [JSON.stringify(deleted), batchId]);

    await client.query('COMMIT');

    log.info({ from, to, batchId, ...deleted }, 'purge-range completed (backed up)');
    auditLog('warn', 'api', `Purge range ${from} → ${to}: ${deleted.readings} readings, ${deleted.agg_15m} agg15m, ${deleted.agg_daily} daily — batch ${batchId}`, {
      from, to, purge_batch_id: batchId, deleted
    }, req.userId || null);

    res.json({ ok: true, range: { from, to }, purge_batch_id: batchId, deleted });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: e.message }, 'purge-range error');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// Purge history & restore
// ═══════════════════════════════════════════════════════════════

// GET /admin/purge-batches — List recent purge batches
router.get("/admin/purge-batches", requireAuth, async (req, res) => {
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });
  try {
    const r = await telemetryPool.query(
      `SELECT id, deleted_at, deleted_by, point_ids, date_from, date_to, counts, restored_at
       FROM purge_batches ORDER BY deleted_at DESC LIMIT 50`
    );
    res.json({ ok: true, batches: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/purge-batches/:batchId/restore — Restore purged data from trash
router.post("/admin/purge-batches/:batchId/restore", requireAuth, async (req, res) => {
  const { batchId } = req.params;
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });

  const client = await telemetryPool.connect();
  try {
    // Verify batch exists and not already restored
    const batchCheck = await client.query(
      `SELECT id, counts, restored_at FROM purge_batches WHERE id = $1`, [batchId]
    );
    if (batchCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ ok: false, error: "Batch not found" });
    }
    if (batchCheck.rows[0].restored_at) {
      client.release();
      return res.status(400).json({ ok: false, error: "Batch already restored" });
    }

    await client.query('BEGIN');

    // Restore readings (ON CONFLICT skip duplicates)
    const rReadings = await client.query(
      `INSERT INTO acrel_readings
       SELECT time, org_id, site_id, terrain_id, point_id, raw,
              voltage_a, voltage_b, voltage_c, voltage_ab, voltage_bc, voltage_ca,
              current_a, current_b, current_c, current_sum, aftercurrent,
              active_power_a, active_power_b, active_power_c, active_power_total,
              reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
              apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
              power_factor_a, power_factor_b, power_factor_c, power_factor_total,
              frequency, voltage_unbalance, current_unbalance,
              energy_total, energy_import, energy_export, reactive_energy_import, reactive_energy_export,
              energy_total_a, energy_import_a, energy_export_a,
              energy_total_b, energy_import_b, energy_export_b,
              energy_total_c, energy_import_c, energy_export_c,
              energy_spike, energy_peak, energy_flat, energy_valley,
              thdu_a, thdu_b, thdu_c, thdi_a, thdi_b, thdi_c,
              temp_a, temp_b, temp_c, temp_n,
              di_state, do1_state, do2_state, alarm_state,
              rssi_lora, rssi_gateway, snr_gateway, f_cnt
       FROM acrel_readings_trash WHERE purge_batch_id = $1
       ON CONFLICT (point_id, time) DO NOTHING`,
      [batchId]
    );

    // Restore agg_15m
    const r15m = await client.query(
      `INSERT INTO acrel_agg_15m
       SELECT bucket_start, org_id, site_id, terrain_id, point_id,
              samples_count, active_power_avg, active_power_max, voltage_a_avg,
              energy_import_delta, energy_export_delta, energy_total_delta
       FROM acrel_agg_15m_trash WHERE purge_batch_id = $1
       ON CONFLICT (point_id, bucket_start) DO NOTHING`,
      [batchId]
    );

    // Restore agg_daily
    const rDay = await client.query(
      `INSERT INTO acrel_agg_daily
       SELECT day, org_id, site_id, terrain_id, point_id,
              samples_count, active_power_avg, active_power_max,
              energy_import_delta, energy_export_delta, energy_total_delta
       FROM acrel_agg_daily_trash WHERE purge_batch_id = $1
       ON CONFLICT (point_id, day) DO NOTHING`,
      [batchId]
    );

    // Mark batch as restored
    await client.query(
      `UPDATE purge_batches SET restored_at = now() WHERE id = $1`, [batchId]
    );

    // Clean trash for this batch
    await client.query(`DELETE FROM acrel_readings_trash WHERE purge_batch_id = $1`, [batchId]);
    await client.query(`DELETE FROM acrel_agg_15m_trash WHERE purge_batch_id = $1`, [batchId]);
    await client.query(`DELETE FROM acrel_agg_daily_trash WHERE purge_batch_id = $1`, [batchId]);

    await client.query('COMMIT');

    const restored = { readings: rReadings.rowCount, agg_15m: r15m.rowCount, agg_daily: rDay.rowCount };
    log.info({ batchId, ...restored }, 'purge restore completed');
    auditLog('info', 'api', `Restauration purge batch ${batchId}: ${restored.readings} readings, ${restored.agg_15m} agg15m, ${restored.agg_daily} daily`, {
      purge_batch_id: batchId, restored
    }, req.userId || null);

    res.json({ ok: true, purge_batch_id: batchId, restored });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: e.message }, 'purge restore error');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /admin/purge-batches/:batchId — Permanently delete trash data (no recovery)
router.delete("/admin/purge-batches/:batchId", requireAuth, async (req, res) => {
  const { batchId } = req.params;
  if (!telemetryPool) return res.status(503).json({ ok: false, error: "Telemetry database not available" });

  try {
    // CASCADE will delete from trash tables too
    const r = await telemetryPool.query(`DELETE FROM purge_batches WHERE id = $1`, [batchId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Batch not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Pipeline repair actions
// ═══════════════════════════════════════════════════════════════

// POST /admin/pipeline/repair-aggregations — force re-aggregation for a time window
router.post("/admin/pipeline/repair-aggregations", requireAuth, async (req, res) => {
  try {
    const { from, to, point_id, terrain_id, site_id } = req.body || {};
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: "from and to are required (ISO dates)" });
    }

    const jobData = {
      payload: { from, to, point_id: point_id || null, terrain_id: terrain_id || null, site_id: site_id || null },
    };

    await telemetryQueue.add("telemetry.aggregate", jobData, { attempts: 1 });
    auditLog('info', 'api', `Réagrégation lancée: ${from} → ${to}`, jobData.payload, req.userId || null);

    res.json({ ok: true, message: "Aggregation job queued", job: jobData.payload });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/pipeline/retry-failed-jobs — clean failed jobs from BullMQ queue
router.post("/admin/pipeline/retry-failed-jobs", requireAuth, async (req, res) => {
  try {
    const { queue = "telemetry", limit = 50 } = req.body || {};

    // Get failed jobs and retry them
    const { Queue } = require("bullmq");
    const redis = require("../../config/redis");
    if (!redis) return res.status(503).json({ ok: false, error: "Redis not available" });

    const q = new Queue(queue, { connection: redis });
    const failed = await q.getFailed(0, limit);

    let retried = 0;
    for (const job of failed) {
      try {
        await job.retry();
        retried++;
      } catch (e) {
        // job may have been removed already
      }
    }

    auditLog('info', 'api', `Retry ${retried}/${failed.length} failed jobs in queue "${queue}"`, { queue, retried, total: failed.length }, req.userId || null);

    res.json({ ok: true, queue, retried, total_failed: failed.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/pipeline/flush-failed-jobs — remove all failed jobs from a queue
router.post("/admin/pipeline/flush-failed-jobs", requireAuth, async (req, res) => {
  try {
    const { queue = "telemetry" } = req.body || {};

    const { Queue } = require("bullmq");
    const redis = require("../../config/redis");
    if (!redis) return res.status(503).json({ ok: false, error: "Redis not available" });

    const q = new Queue(queue, { connection: redis });
    const failed = await q.getFailed(0, 1000);

    let removed = 0;
    for (const job of failed) {
      try {
        await job.remove();
        removed++;
      } catch (e) { /* ignore */ }
    }

    auditLog('warn', 'api', `Flushed ${removed} failed jobs from queue "${queue}"`, { queue, removed }, req.userId || null);

    res.json({ ok: true, queue, removed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/pipeline/reprocess-unmapped — trigger cleanup of unmapped messages now
router.post("/admin/pipeline/reprocess-unmapped", requireAuth, async (req, res) => {
  try {
    const { limit = 500 } = req.body || {};

    await telemetryQueue.add(
      "telemetry.cleanup_unmapped_messages",
      { payload: { limit } },
      { attempts: 1 }
    );

    auditLog('info', 'api', `Reprocess unmapped messages lancé (limit=${limit})`, { limit }, req.userId || null);

    res.json({ ok: true, message: "Cleanup job queued", limit });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// ── Disk Recovery / Storage Management ──
// ══════════════════════════════════════════════════════════

// GET /admin/disk-stats — per-table disk usage
router.get("/admin/disk-stats", requireAuth, async (req, res) => {
  try {
    // Tables in telemetry DB
    const telemetryTables = [
      'acrel_readings', 'acrel_agg_15m', 'acrel_agg_daily',
      'acrel_readings_trash', 'acrel_agg_15m_trash', 'acrel_agg_daily_trash',
      'purge_batches',
    ];
    // Tables in core DB
    const coreTables = ['incoming_messages'];

    const rows = [];
    const queryTableStats = async (pool, tbl) => {
      try {
        const sizeRes = await pool.query(
          `SELECT pg_total_relation_size($1::regclass) AS total_bytes,
                  pg_relation_size($1::regclass)       AS table_bytes,
                  pg_indexes_size($1::regclass)        AS index_bytes`,
          [tbl]
        );
        const countRes = await pool.query(
          `SELECT count(*)::int AS row_count FROM ${tbl}`
        );
        return {
          table: tbl,
          row_count: countRes.rows[0]?.row_count ?? 0,
          total_bytes: parseInt(sizeRes.rows[0]?.total_bytes ?? 0),
          table_bytes: parseInt(sizeRes.rows[0]?.table_bytes ?? 0),
          index_bytes: parseInt(sizeRes.rows[0]?.index_bytes ?? 0),
          total_human: formatBytes(parseInt(sizeRes.rows[0]?.total_bytes ?? 0)),
        };
      } catch {
        return { table: tbl, row_count: 0, total_bytes: 0, table_bytes: 0, index_bytes: 0, total_human: '0 B', error: 'table not found' };
      }
    };
    for (const tbl of telemetryTables) rows.push(await queryTableStats(telemetryPool, tbl));
    for (const tbl of coreTables) rows.push(await queryTableStats(corePool, tbl));

    // Database total size
    const dbSizeRes = await telemetryPool.query(
      `SELECT pg_database_size(current_database()) AS db_bytes`
    );
    const dbBytes = parseInt(dbSizeRes.rows[0]?.db_bytes ?? 0);

    // Trash stats
    let trashBatchCount = 0;
    let oldestTrash = null;
    try {
      const trashRes = await telemetryPool.query(
        `SELECT count(*)::int AS cnt, min(deleted_at) AS oldest FROM purge_batches WHERE restored_at IS NULL`
      );
      trashBatchCount = trashRes.rows[0]?.cnt ?? 0;
      oldestTrash = trashRes.rows[0]?.oldest ?? null;
    } catch { /* purge_batches may not exist */ }

    res.json({
      ok: true,
      database_size: dbBytes,
      database_size_human: formatBytes(dbBytes),
      trash_batches: trashBatchCount,
      oldest_trash: oldestTrash,
      tables: rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /admin/disk-recovery — dispatch as async BullMQ job (VACUUM FULL is too slow for HTTP)
router.post("/admin/disk-recovery", requireAuth, async (req, res) => {
  try {
    const { trash_max_age_days = 7, vacuum = true } = req.body || {};
    await telemetryQueue.add(JobTypes.DISK_RECOVERY, { trash_max_age_days, vacuum }, { attempts: 1 });
    log.info({ trash_max_age_days, vacuum }, 'Disk recovery job queued');
    res.json({ ok: true, message: 'Job de récupération disque mis en file d\'attente' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;