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

  try {
    console.log(`[process-historical] Processing messages for device ${device_key} terrain ${terrain_id}`);

    // Find all incoming_messages for this device
    const msgs = await db.query(
      `SELECT id, received_at, payload_raw, modbus_addr, dev_eui
       FROM incoming_messages
       WHERE device_key = $1
         AND (status = 'mapped' OR status = 'unmapped')
         AND payload_raw IS NOT NULL
       ORDER BY received_at ASC`,
      [device_key]
    );

    if (!msgs.rows.length) {
      console.log(`[process-historical] No messages found for device ${device_key}`);
      return {
        ok: true,
        message: "No messages to process",
        device_key, terrain_id, point_id,
        processed: 0,
      };
    }

    console.log(`[process-historical] Found ${msgs.rows.length} messages to process`);
    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    const results = [];
    let processed = 0;
    let failed = 0;

    for (const msg of msgs.rows) {
      const payload_raw = msg.payload_raw || {};
      // IMPORTANT: Use the original message arrival time, NOT current time
      const msgTime = payload_raw.time ? new Date(payload_raw.time).toISOString() : new Date(msg.received_at).toISOString();

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
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          console.error(`[process-historical] Ingest failed for msg ${msg.id}: ${data.error || resp.status}`);
          failed++;
          results.push({ message_id: msg.id, ok: false, error: data.error || "ingest failed" });
          continue;
        }

        // Mark as ingested and remove from incoming_messages
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        console.error(`[process-historical] Error for msg ${msg.id}: ${e.message}`);
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    const summary = { total: msgs.rows.length, processed, failed };
    console.log(`[process-historical] Done:`, JSON.stringify(summary));

    return {
      ok: true,
      device_key, terrain_id, point_id,
      summary,
      results: results.slice(0, 20),
    };
  } catch (e) {
    console.error(`[process-historical] Fatal error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Background cleanup: find mapped messages whose devices exist in device_registry
// and re-send them to the ingestion service to create actual acrel_readings.
async function runCleanupUnmappedMessages(payload = {}) {
  try {
    console.log("[cleanup] Starting cleanup of mapped messages...");

    // Find mapped messages + join device_registry to get terrain_id and point_id
    // NOTE: device_registry has point_id directly (no separate point_registry table)
    const messages = await db.query(
      `SELECT im.id, im.device_key, im.payload_raw, im.received_at,
              im.mapped_terrain_id, im.mapped_point_id,
              dr.terrain_id, dr.point_id
       FROM incoming_messages im
       JOIN device_registry dr ON dr.device_key = im.device_key
       WHERE im.status = 'mapped'
       ORDER BY im.received_at ASC
       LIMIT $1`,
      [payload.limit || 500]
    );

    if (!messages.rows.length) {
      console.log("[cleanup] No mapped messages found - nothing to do");
      return { ok: true, message: "No mapped messages to process", processed: 0 };
    }

    console.log(`[cleanup] Found ${messages.rows.length} mapped messages to process`);

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const msg of messages.rows) {
      try {
        const payload_raw = msg.payload_raw || {};
        const terrainId = msg.terrain_id || msg.mapped_terrain_id;

        if (!terrainId) {
          console.warn(`[cleanup] Skipping msg ${msg.id}: no terrain_id`);
          failed++;
          errors.push({ id: msg.id, error: "no terrain_id" });
          continue;
        }

        // IMPORTANT: Use original message arrival time, NOT current time
        const msgTime = payload_raw.time
          ? new Date(payload_raw.time).toISOString()
          : new Date(msg.received_at).toISOString();

        const ingestPayload = {
          time: msgTime,
          terrain_id: terrainId,
          source: payload_raw.source ?? {},
          devices: [{
            device: {
              modbus_addr: payload_raw?.device?.modbus_addr ?? null,
              lora_dev_eui: payload_raw?.device?.lora_dev_eui ?? null,
              rssi_lora: payload_raw?.device?.rssi_lora ?? null,
            },
            metrics: payload_raw.metrics ?? {},
            raw: payload_raw,
          }],
        };

        console.log(`[cleanup] Processing msg ${msg.id} (device: ${msg.device_key}, time: ${msgTime})`);

        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          console.error(`[cleanup] Ingestion failed for msg ${msg.id}:`, data.error || resp.status);
          failed++;
          errors.push({ id: msg.id, error: data.error || `HTTP ${resp.status}` });
          continue;
        }

        // Success: delete message from incoming_messages (no more "mapped" lingering)
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]);
        processed++;
        console.log(`[cleanup] ✓ msg ${msg.id} ingested and removed`);
      } catch (e) {
        console.error(`[cleanup] Error processing msg ${msg.id}: ${e.message}`);
        failed++;
        errors.push({ id: msg.id, error: e.message });
      }
    }

    const summary = { total: messages.rows.length, processed, failed };
    console.log(`[cleanup] Done:`, JSON.stringify(summary));

    return {
      ok: true,
      summary,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    };
  } catch (e) {
    console.error("[cleanup] Fatal error:", e.message);
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