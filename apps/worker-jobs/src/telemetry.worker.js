const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult, telemetryDb, db } = require("./shared");

if (!connection) {
  console.warn("[telemetry-worker] Skipped – no Redis connection.");
  return;
}

function isIso(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

async function runAggregate(payload = {}) {
  // Fenêtre par défaut: last 24h
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const from = payload.from && isIso(payload.from) ? new Date(payload.from) : defaultFrom;
  const to = payload.to && isIso(payload.to) ? new Date(payload.to) : now;

  const siteId = payload.site_id || null;
  const terrainId = payload.terrain_id || null;
  const pointId = payload.point_id || null;

  // filtre dynamique
  const where = [];
  const params = [from.toISOString(), to.toISOString()];
  let idx = 3;

  where.push(`time >= $1 AND time < $2`);

  if (siteId) {
    where.push(`site_id = $${idx++}`);
    params.push(siteId);
  }
  if (terrainId) {
    where.push(`terrain_id = $${idx++}`);
    params.push(terrainId);
  }
  if (pointId) {
    where.push(`point_id = $${idx++}`);
    params.push(pointId);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // 1) 15 minutes aggregation
  const sql15m = `
    INSERT INTO acrel_agg_15m (
      bucket_start, org_id, site_id, terrain_id, point_id,
      samples_count,
      active_power_avg, active_power_max,
      voltage_a_avg,
      energy_import_delta, energy_export_delta
    )
    SELECT
      time_bucket('15 minutes', time) AS bucket_start,
      org_id, site_id, terrain_id, point_id,
      COUNT(*)::int AS samples_count,
      AVG(active_power_total) AS active_power_avg,
      MAX(active_power_total) AS active_power_max,
      AVG(voltage_a) AS voltage_a_avg,
      (MAX(energy_import) - MIN(energy_import)) AS energy_import_delta,
      (MAX(energy_export) - MIN(energy_export)) AS energy_export_delta
    FROM acrel_readings
    ${whereSql}
    GROUP BY bucket_start, org_id, site_id, terrain_id, point_id
    ON CONFLICT (point_id, bucket_start)
    DO UPDATE SET
      org_id = EXCLUDED.org_id,
      site_id = EXCLUDED.site_id,
      terrain_id = EXCLUDED.terrain_id,
      samples_count = EXCLUDED.samples_count,
      active_power_avg = EXCLUDED.active_power_avg,
      active_power_max = EXCLUDED.active_power_max,
      voltage_a_avg = EXCLUDED.voltage_a_avg,
      energy_import_delta = EXCLUDED.energy_import_delta,
      energy_export_delta = EXCLUDED.energy_export_delta
  `;

  const r15 = await telemetryDb.query(sql15m, params);
  // r15.rowCount = nombre de lignes insert/update

  // 2) daily aggregation
  const sqlDaily = `
    INSERT INTO acrel_agg_daily (
      day, org_id, site_id, terrain_id, point_id,
      samples_count,
      active_power_avg, active_power_max,
      energy_import_delta, energy_export_delta
    )
    SELECT
      (time_bucket('1 day', time))::date AS day,
      org_id, site_id, terrain_id, point_id,
      COUNT(*)::int AS samples_count,
      AVG(active_power_total) AS active_power_avg,
      MAX(active_power_total) AS active_power_max,
      (MAX(energy_import) - MIN(energy_import)) AS energy_import_delta,
      (MAX(energy_export) - MIN(energy_export)) AS energy_export_delta
    FROM acrel_readings
    ${whereSql}
    GROUP BY day, org_id, site_id, terrain_id, point_id
    ON CONFLICT (point_id, day)
    DO UPDATE SET
      org_id = EXCLUDED.org_id,
      site_id = EXCLUDED.site_id,
      terrain_id = EXCLUDED.terrain_id,
      samples_count = EXCLUDED.samples_count,
      active_power_avg = EXCLUDED.active_power_avg,
      active_power_max = EXCLUDED.active_power_max,
      energy_import_delta = EXCLUDED.energy_import_delta,
      energy_export_delta = EXCLUDED.energy_export_delta
  `;

  const rDay = await telemetryDb.query(sqlDaily, params);

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    filters: { site_id: siteId, terrain_id: terrainId, point_id: pointId },
    upserted: { agg_15m: r15.rowCount, agg_daily: rDay.rowCount }
  };
}

async function runProcessHistoricalMessages(payload = {}) {
  // Fetch all incoming_messages for a newly-mapped device and replay them to /ingest/acrel
  const { device_key, terrain_id, point_id } = payload;
  if (!device_key || !terrain_id || !point_id) {
    return { ok: false, error: "device_key, terrain_id, and point_id required" };
  }

  // Import corePool locally within the worker context (or use shared db)
  // For now, assume we have access via the worker context
  // In a production setup, you'd want to pass the coreDb connection
  let corePool;
  try {
    corePool = require("../../../apps/api-core/src/config/db").corePool;
  } catch (e) {
    return { ok: false, error: "cannot connect to core database" };
  }

  try {
    // Find all incoming_messages for this device
    const msgs = await corePool.query(
      `SELECT id, received_at, payload_raw, modbus_addr, dev_eui
       FROM incoming_messages
       WHERE device_key = $1
         AND (status = 'mapped' OR status = 'unmapped')
         AND payload_raw IS NOT NULL
       ORDER BY received_at ASC`,
      [device_key]
    );

    if (!msgs.rows.length) {
      return {
        ok: true,
        message: "No messages to process",
        device_key, terrain_id, point_id,
        processed: 0,
      };
    }

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    const results = [];
    let processed = 0;
    let failed = 0;

    for (const msg of msgs.rows) {
      const payload_raw = msg.payload_raw || {};
      // IMPORTANT: Use the original message arrival time, NOT current time
      // This ensures historical messages keep their original timestamps
      const msgTime = payload_raw.time ? new Date(payload_raw.time).toISOString() : new Date(msg.received_at).toISOString();

      // Build ingestion payload
      const ingestPayload = {
        time: msgTime,
        terrain_id,
        source: payload_raw.source ?? {},
        devices: [
          {
            device: {
              modbus_addr: msg.modbus_addr ?? payload_raw?.device?.modbus_addr ?? null,
              lora_dev_eui: msg.dev_eui ?? payload_raw?.device?.lora_dev_eui ?? null,
              rssi_lora: payload_raw?.device?.rssi_lora ?? null,
            },
            metrics: payload_raw.metrics ?? {},
            raw: payload_raw,
          },
        ],
      };

      try {
        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
          timeout: 10000,
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
          [msg.id, terrain_id, point_id]
        ).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    return {
      ok: true,
      device_key, terrain_id, point_id,
      summary: { total: msgs.rows.length, processed, failed },
      results: results.slice(0, 20), // Return first 20 to avoid huge response
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runCleanupUnmappedMessages(payload = {}) {
  try {
    // Find unmapped messages that now have mapped devices
    const messages = await db.query(
      `SELECT DISTINCT im.id, im.gateway_id, im.device_key, im.payload_raw, im.received_at,
              dr.terrain_id, dr.id as device_id, pr.point_id
       FROM incoming_messages im
       JOIN device_registry dr ON dr.device_key = im.device_key
       LEFT JOIN point_registry pr ON pr.device_id = dr.id
       WHERE im.status = 'unmapped'
         AND dr.device_key IS NOT NULL
       LIMIT $1`,
      [payload.limit || 500]
    );

    if (!messages.rows.length) {
      return {
        ok: true,
        message: "No unmapped messages found for mapped devices",
        processed: 0,
      };
    }

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    const results = [];
    let processed = 0;
    let failed = 0;

    for (const msg of messages.rows) {
      try {
        const payload_raw = msg.payload_raw || {};
        
        // IMPORTANT: Use the original message arrival time, NOT current time
        // This ensures historical messages keep their original timestamps
        const msgTime = payload_raw.time 
          ? new Date(payload_raw.time).toISOString() 
          : new Date(msg.received_at).toISOString();

        // Build ingestion payload
        const ingestPayload = {
          time: msgTime,
          terrain_id: msg.terrain_id,
          source: payload_raw.source ?? {},
          devices: [
            {
              device: {
                modbus_addr: payload_raw?.device?.modbus_addr ?? null,
                lora_dev_eui: payload_raw?.device?.lora_dev_eui ?? null,
                rssi_lora: payload_raw?.device?.rssi_lora ?? null,
              },
              metrics: payload_raw.metrics ?? {},
              raw: payload_raw,
            },
          ],
        };

        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
          timeout: 10000,
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          failed++;
          results.push({ message_id: msg.id, ok: false, error: data.error || "ingest failed" });
          continue;
        }

        // Mark message as mapped
        await db.query(
          `UPDATE incoming_messages
           SET status = 'mapped', mapped_terrain_id = $2, mapped_point_id = $3
           WHERE id = $1`,
          [msg.id, msg.terrain_id, msg.point_id || null]
        ).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    return {
      ok: true,
      summary: { total: messages.rows.length, processed, failed },
      results: results.slice(0, 20), // Return first 20 to avoid huge response
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

new Worker(
  "telemetry",
  async (job) => {
    const { runId, payload } = job.data || {};

    // ── acrel.ingested: triggered by ingestion service after each reading ──
    // These events do NOT have a runId — they trigger a targeted aggregation
    // for the specific point that just received data.
    if (job.name === "acrel.ingested") {
      const { pointId, terrainId, siteId, orgId, time } = job.data || {};
      if (!pointId) return { ok: true, skipped: "no pointId" };

      try {
        // Aggregate the 15-minute bucket that contains this reading
        const readingTime = new Date(time || Date.now());
        const bucketStart = new Date(readingTime);
        bucketStart.setMinutes(bucketStart.getMinutes() - (bucketStart.getMinutes() % 15), 0, 0);
        const bucketEnd = new Date(bucketStart.getTime() + 15 * 60 * 1000);

        const summary = await runAggregate({
          from: bucketStart.toISOString(),
          to: bucketEnd.toISOString(),
          point_id: pointId,
          terrain_id: terrainId,
          site_id: siteId,
        });

        return { ok: true, summary };
      } catch (e) {
        console.error("[telemetry-worker] acrel.ingested error:", e.message);
        return { ok: false, error: e.message };
      }
    }

    // ── telemetry.aggregate: manual/scheduled full aggregation ──
    if (runId) {
      await setRunStatus(runId, "running", { started_at: new Date().toISOString() });
    }

    try {
      if (job.name === "telemetry.aggregate") {
        const summary = await runAggregate(payload);

        if (runId) {
          await insertJobResult(runId, job.name, summary);
          await setRunStatus(runId, "success", {
            finished_at: new Date().toISOString(),
            result: summary
          });
        }

        return { ok: true, summary };
      }

      // ── telemetry.process_historical_messages: replay unmapped/buffered messages ──
      if (job.name === "telemetry.process_historical_messages") {
        const summary = await runProcessHistoricalMessages(payload);

        if (runId) {
          await insertJobResult(runId, job.name, summary);
          const status = summary.ok ? "success" : "failed";
          await setRunStatus(runId, status, {
            finished_at: new Date().toISOString(),
            result: summary
          });
        }

        return { ok: true, summary };
      }

      // ── telemetry.cleanup_unmapped_messages: auto-process unmapped messages from mapped devices ──
      if (job.name === "telemetry.cleanup_unmapped_messages") {
        const summary = await runCleanupUnmappedMessages(payload);

        if (runId) {
          await insertJobResult(runId, job.name, summary);
          const status = summary.ok ? "success" : "failed";
          await setRunStatus(runId, status, {
            finished_at: new Date().toISOString(),
            result: summary
          });
        }

        return { ok: true, summary };
      }

      // fallback for unknown job types
      const result = { queue: "telemetry", name: job.name };
      if (runId) {
        await insertJobResult(runId, job.name, result);
        await setRunStatus(runId, "success", {
          finished_at: new Date().toISOString(),
          result
        });
      }

      return { ok: true };
    } catch (e) {
      if (runId) {
        await setRunStatus(runId, "failed", {
          finished_at: new Date().toISOString(),
          error: e.message
        });
      }
      throw e;
    }
  },
  { connection }
);

console.log("worker listening: telemetry");