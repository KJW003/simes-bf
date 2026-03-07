const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult, telemetryDb, db } = require("./shared");

if (!connection) {
  console.warn("[telemetry-worker] Skipped – no Redis connection.");
  return;
}

// ─── Logging helper ───────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const LOG_DIR = "/app/logs";
const LOG_FILE = path.join(LOG_DIR, "cleanup.log");

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (e) {
    // Log dir creation failed, will just use console
  }
}

function log(prefix, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${prefix}: ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_DIR) || fs.existsSync(path.dirname(LOG_FILE))) {
      fs.appendFileSync(LOG_FILE, line + "\n", { flag: "a" });
    }
  } catch (e) {
    // File logging failed, console is already logged
  }
}

// Call once on startup
ensureLogDir();


function isIso(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

async function runAggregate(payload = {}) {
  if (!telemetryDb) {
    const msg = "telemetryDb not available - aggregation cannot run";
    log("runAggregate", `✗ ${msg}`);
    throw new Error(msg);
  }

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
  log("runAggregate", `15m aggregation: ${r15.rowCount} rows affected`);
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
  log("runAggregate", `Daily aggregation: ${rDay.rowCount} rows affected`);

  const result = {
    window: { from: from.toISOString(), to: to.toISOString() },
    filters: { site_id: siteId, terrain_id: terrainId, point_id: pointId },
    upserted: { agg_15m: r15.rowCount, agg_daily: rDay.rowCount }
  };
  return result;
}

async function runProcessHistoricalMessages(payload = {}) {
  // Fetch all incoming_messages for a newly-mapped device and replay them to /ingest/acrel
  const { device_key, terrain_id, point_id } = payload;
  if (!device_key || !terrain_id || !point_id) {
    return { ok: false, error: "device_key, terrain_id, and point_id required" };
  }

  try {
    log("process-historical", `Processing messages for device ${device_key} terrain ${terrain_id}`);

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
      log("process-historical", `No messages found for device ${device_key}`);
      return {
        ok: true,
        message: "No messages to process",
        device_key, terrain_id, point_id,
        processed: 0,
      };
    }

    log("process-historical", `Found ${msgs.rows.length} messages to process`);
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
          log("process-historical", `✗ Ingest failed for msg ${msg.id}: ${data.error || resp.status}`);
          failed++;
          results.push({ message_id: msg.id, ok: false, error: data.error || "ingest failed" });
          continue;
        }

        // Mark as ingested and remove from incoming_messages
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        log("process-historical", `✗ Error for msg ${msg.id}: ${e.message}`);
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    const summary = { total: msgs.rows.length, processed, failed };
    log("process-historical", `Done: ${JSON.stringify(summary)}`);

    return {
      ok: true,
      device_key, terrain_id, point_id,
      summary,
      results: results.slice(0, 20),
    };
  } catch (e) {
    log("process-historical", `✗ Fatal error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ─── Stale device detection ─────────────────────────────────
// Checks device_registry for devices that haven't reported in a while
// and creates/resolves incidents in the core DB automatically.
async function runCheckStaleDevices(payload = {}) {
  const WARN_MINUTES = payload.warn_minutes || 30;
  const CRITICAL_MINUTES = payload.critical_minutes || 60;

  if (!db) throw new Error("Core DB not available");

  try {
    log("stale-check", `Starting stale device check (warn=${WARN_MINUTES}m, crit=${CRITICAL_MINUTES}m)`);

    // 1) Find stale devices
    const staleDevices = await db.query(
      `SELECT dr.id, dr.device_key, dr.label, dr.terrain_id, dr.point_id,
              dr.last_seen_at,
              EXTRACT(EPOCH FROM (NOW() - dr.last_seen_at)) / 60 AS minutes_silent,
              mp.name AS point_name, t.name AS terrain_name
       FROM device_registry dr
       LEFT JOIN measurement_points mp ON mp.id = dr.point_id
       LEFT JOIN terrains t ON t.id = dr.terrain_id
       WHERE dr.last_seen_at IS NOT NULL
         AND dr.last_seen_at < NOW() - INTERVAL '${WARN_MINUTES} minutes'`
    );

    log("stale-check", `Found ${staleDevices.rows.length} stale device(s)`);

    let created = 0;
    let escalated = 0;
    let resolved = 0;

    for (const dev of staleDevices.rows) {
      const minutesSilent = Math.round(dev.minutes_silent);
      const severity = minutesSilent >= CRITICAL_MINUTES ? "critical" : "warning";
      const deviceLabel = dev.label || dev.device_key;

      // Check if an open incident already exists for this device
      const existing = await db.query(
        `SELECT id, severity FROM incidents
         WHERE source = 'stale_device_monitor'
           AND status IN ('open', 'acknowledged')
           AND metadata->>'device_key' = $1
         LIMIT 1`,
        [dev.device_key]
      );

      if (existing.rows.length > 0) {
        const inc = existing.rows[0];
        // Escalate if needed
        if (inc.severity === "warning" && severity === "critical") {
          await db.query(
            `UPDATE incidents SET severity = 'critical',
               description = $1, updated_at = NOW()
             WHERE id = $2`,
            [`Appareil "${deviceLabel}" silencieux depuis ${minutesSilent} minutes (escaladé en critique)`, inc.id]
          );
          escalated++;
          log("stale-check", `↑ Escalated incident ${inc.id} for ${dev.device_key} (${minutesSilent}m)`);
        }
        continue; // Already tracked
      }

      // Create new incident
      await db.query(
        `INSERT INTO incidents (id, title, description, severity, status, source, terrain_id, point_id, metadata)
         VALUES (gen_random_uuid(), $1, $2, $3, 'open', 'stale_device_monitor', $4, $5, $6)`,
        [
          `Appareil silencieux: ${deviceLabel}`,
          `Appareil "${deviceLabel}" n'a pas envoyé de données depuis ${minutesSilent} minutes.`,
          severity,
          dev.terrain_id,
          dev.point_id,
          JSON.stringify({
            device_key: dev.device_key,
            device_id: dev.id,
            last_seen_at: dev.last_seen_at,
            minutes_silent: minutesSilent,
          }),
        ]
      );
      created++;
      log("stale-check", `+ Created ${severity} incident for ${dev.device_key} (${minutesSilent}m)`);
    }

    // 2) Auto-resolve incidents for devices that came back online
    const autoResolved = await db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
              description = description || ' — Auto-résolu: appareil de retour en ligne.'
       WHERE source = 'stale_device_monitor'
         AND status IN ('open', 'acknowledged')
         AND metadata->>'device_key' IN (
           SELECT device_key FROM device_registry
           WHERE last_seen_at >= NOW() - INTERVAL '${WARN_MINUTES} minutes'
         )
       RETURNING id, metadata->>'device_key' AS device_key`
    );

    resolved = autoResolved.rowCount;
    for (const r of autoResolved.rows) {
      log("stale-check", `✓ Auto-resolved incident ${r.id} for ${r.device_key}`);
    }

    const summary = { stale_found: staleDevices.rows.length, created, escalated, resolved };
    log("stale-check", `Done: ${JSON.stringify(summary)}`);
    return { ok: true, summary };
  } catch (e) {
    log("stale-check", `✗ Fatal error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Background cleanup: find mapped messages whose devices exist in device_registry
// and re-send them to the ingestion service to create actual acrel_readings.
async function runCleanupUnmappedMessages(payload = {}) {
  try {
    log("cleanup", "Starting cleanup of mapped messages...");

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
      log("cleanup", "No mapped messages found - nothing to do");
      return { ok: true, message: "No mapped messages to process", processed: 0 };
    }

    log("cleanup", `Found ${messages.rows.length} mapped messages to process`);

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const msg of messages.rows) {
      try {
        const payload_raw = msg.payload_raw || {};
        const terrainId = msg.terrain_id || msg.mapped_terrain_id;

        if (!terrainId) {
          log("cleanup", `Skipping msg ${msg.id}: no terrain_id`);
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

        log("cleanup", `Processing msg ${msg.id} (device: ${msg.device_key}, time: ${msgTime})`);

        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          log("cleanup", `✗ Ingestion failed for msg ${msg.id}: ${data.error || resp.status}`);
          failed++;
          errors.push({ id: msg.id, error: data.error || `HTTP ${resp.status}` });
          continue;
        }

        // Success: delete message from incoming_messages (no more "mapped" lingering)
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]);
        processed++;
        log("cleanup", `✓ msg ${msg.id} ingested and removed`);
      } catch (e) {
        log("cleanup", `✗ Error processing msg ${msg.id}: ${e.message}`);
        failed++;
        errors.push({ id: msg.id, error: e.message });
      }
    }

    const summary = { total: messages.rows.length, processed, failed };
    log("cleanup", `Done: ${JSON.stringify(summary)}`);

    return {
      ok: true,
      summary,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    };
  } catch (e) {
    log("cleanup", `✗ Fatal error: ${e.message}`);
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
      
      if (!pointId) {
        log("acrel.ingested", `Skipped: no pointId in job data`);
        return { ok: true, skipped: "no pointId" };
      }

      try {
        log("acrel.ingested", `Starting aggregation for point ${pointId}, time ${time}`);
        
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

        log("acrel.ingested", `✓ Aggregation done for point ${pointId}: ${JSON.stringify(summary.upserted)}`);
        return { ok: true, summary };
      } catch (e) {
        log("acrel.ingested", `✗ Aggregation failed for point ${pointId}: ${e.message}`);
        // THROW to tell BullMQ this job failed
        throw e;
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

      // ── telemetry.check_stale_devices: periodic stale device check ──
      if (job.name === "telemetry.check_stale_devices") {
        const summary = await runCheckStaleDevices(payload || {});

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