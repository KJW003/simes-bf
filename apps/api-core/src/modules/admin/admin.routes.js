const express = require("express");
const router = express.Router();
const {corePool} = require("../../config/db");
const { makeDeviceKey } = require("../../shared/acrel");
const { requireAuth } = require("../../shared/auth-middleware");
const { telemetryQueue } = require("../../jobs/queues");
const JobTypes = require("../../jobs/jobTypes");

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
      console.warn("Failed to enqueue PROCESS_HISTORICAL_MESSAGES job:", jobErr);
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

    // 3) Create measurement_point + device_registry per device
    const created = [];
    const skipped = [];

    for (const row of msgs.rows) {
      const deviceKey = row.device_key;
      const modbusAddr = row.modbus_addr;
      const devEui = row.dev_eui;

      // Already mapped?
      const existing = await corePool.query(
        `SELECT point_id FROM device_registry WHERE terrain_id = $1 AND device_key = $2`,
        [terrainId, deviceKey]
      );
      if (existing.rows.length) {
        skipped.push({ device_key: deviceKey, point_id: existing.rows[0].point_id, reason: "already mapped" });
        continue;
      }

      // Check if measurement_point exists by modbus / eui
      let pointId = null;
      if (modbusAddr !== null) {
        const mp = await corePool.query(
          `SELECT id FROM measurement_points WHERE terrain_id = $1 AND modbus_addr = $2`,
          [terrainId, modbusAddr]
        );
        pointId = mp.rows[0]?.id;
      }
      if (!pointId && devEui) {
        const mp = await corePool.query(
          `SELECT id FROM measurement_points WHERE terrain_id = $1 AND lora_dev_eui = $2`,
          [terrainId, devEui]
        );
        pointId = mp.rows[0]?.id;
      }

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

    // 4) Mark buffered messages as mapped ONLY for devices that were actually provisioned
    let messagesUpdated = 0;
    for (const c of created) {
      const upd = await corePool.query(
        `UPDATE incoming_messages
         SET status = 'mapped', mapped_terrain_id = $2, mapped_point_id = $3
         WHERE gateway_id = $1
           AND device_key = $4
           AND status = 'unmapped'`,
        [gatewayId, terrainId, c.point_id, c.device_key]
      );
      messagesUpdated += (upd.rowCount ?? 0);
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
    const { telemetryQueue } = require("../../jobs/queues");
    
    // Find unmapped messages whose devices are now mapped
    const messages = await corePool.query(
      `SELECT DISTINCT im.id, im.gateway_id, im.device_key, im.payload_raw, im.received_at,
              dr.terrain_id, pr.point_id
       FROM incoming_messages im
       JOIN device_registry dr ON dr.device_key = im.device_key
       LEFT JOIN point_registry pr ON pr.device_id = dr.id
       WHERE im.status = 'unmapped'
         AND dr.device_key IS NOT NULL
       LIMIT 5000`
    );

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    let enqueued = 0;
    let failed = 0;
    const errors = [];

    for (const msg of messages.rows) {
      try {
        const payload = JSON.parse(msg.payload_raw);
        
        // IMPORTANT: Use the original message arrival time, NOT current time
        // This ensures historical messages keep their original timestamps
        const msgTime = payload.time 
          ? new Date(payload.time).toISOString() 
          : new Date(msg.received_at).toISOString();

        // Transform to acrel format and send to ingestion service
        const acrelPayload = {
          sn: payload.sn || msg.device_key,
          meter_type: payload.meter_type,
          time: msgTime,
          data: payload.data || {},
        };

        // Send to ingestion service /acrel endpoint
        const response = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(acrelPayload),
        });

        if (!response.ok) {
          throw new Error(`Ingestion service returned ${response.status}`);
        }

        // Mark message as mapped after successful processing
        await corePool.query(
          `UPDATE incoming_messages 
           SET status = 'mapped', mapped_terrain_id = $1, mapped_point_id = $2
           WHERE id = $3`,
          [msg.terrain_id, msg.point_id || null, msg.id]
        );

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
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Return first 10 errors
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;