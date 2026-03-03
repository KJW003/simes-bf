const express = require("express");
const router = express.Router();
const {corePool} = require("../../config/db");
const { makeDeviceKey } = require("../../shared/acrel");

// 1) Inject a fake "MQTT" message (for tomorrow tests / UI dev)
router.post("/admin/incoming/sandbox", async (req, res) => {
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
router.get("/admin/incoming", async (req, res) => {
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
              mapped_terrain_id, mapped_point_id
       FROM incoming_messages
       ${whereSql}
       ORDER BY received_at DESC
       LIMIT 200`,
      params
    );

    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 3) Map a gateway to a terrain (1 Milesight = 1 terrain)
router.put("/admin/gateways/:gatewayId/map", async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const { terrain_id, meta = {} } = req.body || {};

    if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });

    const up = await corePool.query(
      `INSERT INTO gateway_registry (gateway_id, terrain_id, meta)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (gateway_id)
       DO UPDATE SET terrain_id = EXCLUDED.terrain_id, meta = EXCLUDED.meta, updated_at = now()
       RETURNING gateway_id, terrain_id, meta`,
      [gatewayId, terrain_id, JSON.stringify(meta)]
    );

    res.json({ ok: true, gateway: up.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 4) Map a device_key (scoped by terrain) to a measurement_point
// body: { terrain_id, point_id, modbus_addr?, dev_eui? }
router.put("/admin/devices/:deviceKey/map", async (req, res) => {
  try {
    const { deviceKey } = req.params;
    const { terrain_id, point_id, modbus_addr = null, dev_eui = null } = req.body || {};

    if (!terrain_id) return res.status(400).json({ ok: false, error: "terrain_id is required" });
    if (!point_id) return res.status(400).json({ ok: false, error: "point_id is required" });

    const up = await corePool.query(
      `INSERT INTO device_registry (terrain_id, device_key, modbus_addr, dev_eui, point_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (terrain_id, device_key)
       DO UPDATE SET modbus_addr = EXCLUDED.modbus_addr, dev_eui = EXCLUDED.dev_eui,
                     point_id = EXCLUDED.point_id, updated_at = now()
       RETURNING terrain_id, device_key, point_id, modbus_addr, dev_eui`,
      [terrain_id, deviceKey, modbus_addr, dev_eui, point_id]
    );

    res.json({ ok: true, device: up.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5) Replay a raw message into /ingest/acrel (only if mapped)
// Uses internal HTTP call to api-core itself (works local and VPS)
router.post("/admin/incoming/:id/replay", async (req, res) => {
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
    const time = payload.time || row.received_at;

    // Build ingestion payload in multi-device format expected by /ingest/acrel
    const ingestPayload = {
      time,
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
    const baseUrl = process.env.API_CORE_BASE_URL || "http://localhost:3000";
    const resp = await fetch(`${baseUrl}/ingest/acrel`, {
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

// ─────────────────────────────────────────────────────────────
// 6) List registered gateways
// ─────────────────────────────────────────────────────────────
router.get("/admin/gateways", async (req, res) => {
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
router.get("/admin/gateways/:gatewayId/devices", async (req, res) => {
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
router.post("/admin/gateways/:gatewayId/provision", async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const {
      terrain_id = null,
      device_model = "ADW300",
      default_category = "LOAD",
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
             (terrain_id, name, device, measure_category, modbus_addr, lora_dev_eui)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id, name`,
          [terrainId, name, device_model, default_category, modbusAddr, devEui]
        );

        if (mp.rows.length) {
          pointId = mp.rows[0].id;
        } else {
          // Name conflict → use suffixed name
          const nameAlt = `${name}-${Date.now().toString(36)}`;
          const mp2 = await corePool.query(
            `INSERT INTO measurement_points
               (terrain_id, name, device, measure_category, modbus_addr, lora_dev_eui)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name`,
            [terrainId, nameAlt, device_model, default_category, modbusAddr, devEui]
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

    // 4) Mark buffered messages as mapped
    const updated = await corePool.query(
      `UPDATE incoming_messages
       SET status = 'mapped', mapped_terrain_id = $2
       WHERE gateway_id = $1 AND status = 'unmapped'`,
      [gatewayId, terrainId]
    );

    res.json({
      ok: true,
      gateway_id: gatewayId,
      terrain_id: terrainId,
      summary: {
        devices_found: msgs.rows.length,
        points_created: created.length,
        already_mapped: skipped.length,
        messages_updated: updated.rowCount,
      },
      created,
      skipped,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;