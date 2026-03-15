const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult, telemetryDb, db } = require("./shared");
const { auditLog } = require("./audit-log");
const log = require("./config/logger");

if (!connection) {
  log.warn("telemetry-worker skipped – no Redis connection");
  return;
}


function isIso(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

async function runAggregate(payload = {}) {
  if (!telemetryDb) {
    const msg = "telemetryDb not available - aggregation cannot run";
    log.info(`✗ ${msg}`);
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
  const includeDaily = payload.includeDaily === true;

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
      energy_import_delta, energy_export_delta, energy_total_delta,
      reactive_energy_import_delta, power_factor_avg
    )
    SELECT
      time_bucket('15 minutes', time) AS bucket_start,
      org_id, site_id, terrain_id, point_id,
      COUNT(*)::int AS samples_count,
      AVG(active_power_total) AS active_power_avg,
      MAX(active_power_total) AS active_power_max,
      AVG(voltage_a) AS voltage_a_avg,
      (MAX(energy_import) - MIN(energy_import)) AS energy_import_delta,
      (MAX(energy_export) - MIN(energy_export)) AS energy_export_delta,
      (MAX(energy_total) - MIN(energy_total)) AS energy_total_delta,
      (MAX(reactive_energy_import) - MIN(reactive_energy_import)) AS reactive_energy_import_delta,
      AVG(power_factor_total) AS power_factor_avg
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
      energy_export_delta = EXCLUDED.energy_export_delta,
      energy_total_delta = EXCLUDED.energy_total_delta,
      reactive_energy_import_delta = EXCLUDED.reactive_energy_import_delta,
      power_factor_avg = EXCLUDED.power_factor_avg
  `;

  const r15 = await telemetryDb.query(sql15m, params);
  log.info(`15m aggregation: ${r15.rowCount} rows affected`);
  // r15.rowCount = nombre de lignes insert/update

  let dailyRowCount = 0;
  if (includeDaily) {
    const sqlDaily = `
      INSERT INTO acrel_agg_daily (
        day, org_id, site_id, terrain_id, point_id,
        samples_count,
        active_power_avg, active_power_max,
        energy_import_delta, energy_export_delta, energy_total_delta,
        reactive_energy_import_delta, power_factor_avg
      )
      SELECT
        (DATE_TRUNC('day', time AT TIME ZONE 'UTC'))::date AS day,
        org_id, site_id, terrain_id, point_id,
        COUNT(*)::int AS samples_count,
        AVG(active_power_total) AS active_power_avg,
        MAX(active_power_total) AS active_power_max,
        GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS energy_import_delta,
        GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS energy_export_delta,
        GREATEST(MAX(energy_total) - MIN(energy_total), 0) AS energy_total_delta,
        GREATEST(MAX(reactive_energy_import) - MIN(reactive_energy_import), 0) AS reactive_energy_import_delta,
        AVG(power_factor_total) AS power_factor_avg
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
        energy_export_delta = EXCLUDED.energy_export_delta,
        energy_total_delta = EXCLUDED.energy_total_delta,
        reactive_energy_import_delta = EXCLUDED.reactive_energy_import_delta,
        power_factor_avg = EXCLUDED.power_factor_avg
    `;

    const rDay = await telemetryDb.query(sqlDaily, params);
    dailyRowCount = rDay.rowCount;
    log.info(`Daily aggregation (runAggregate includeDaily=true): ${dailyRowCount} rows affected`);
  }

  const result = {
    window: { from: from.toISOString(), to: to.toISOString() },
    filters: { site_id: siteId, terrain_id: terrainId, point_id: pointId },
    upserted: { agg_15m: r15.rowCount, agg_daily: dailyRowCount }
  };
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Daily aggregation: runs at midnight UTC to finalize yesterday's complete day
// Uses GREATEST(MAX-MIN, 0) for safety with negative deltas
// ────────────────────────────────────────────────────────────────────────────
async function runDailyAggregation(payload = {}) {
  if (!telemetryDb) {
    const msg = "telemetryDb not available - daily aggregation cannot run";
    log.info(`✗ ${msg}`);
    throw new Error(msg);
  }

  // Default: aggregate yesterday's completed day (midnight to midnight UTC)
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const dayStart = payload.dayStart ? new Date(payload.dayStart) : yesterday;
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1); // Next day midnight

  const siteId = payload.site_id || null;
  const terrainId = payload.terrain_id || null;
  const pointId = payload.point_id || null;

  // Build dynamic filters
  const where = [];
  const params = [dayStart.toISOString(), dayEnd.toISOString()];
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

  // Daily aggregation (using GREATEST for safety, matching dashboard calculation)
  const sqlDaily = `
    INSERT INTO acrel_agg_daily (
      day, org_id, site_id, terrain_id, point_id,
      samples_count,
      active_power_avg, active_power_max,
      energy_import_delta, energy_export_delta, energy_total_delta,
      reactive_energy_import_delta, power_factor_avg
    )
    SELECT
      (DATE_TRUNC('day', time AT TIME ZONE 'UTC'))::date AS day,
      org_id, site_id, terrain_id, point_id,
      COUNT(*)::int AS samples_count,
      AVG(active_power_total) AS active_power_avg,
      MAX(active_power_total) AS active_power_max,
      GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS energy_import_delta,
      GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS energy_export_delta,
      GREATEST(MAX(energy_total) - MIN(energy_total), 0) AS energy_total_delta,
      GREATEST(MAX(reactive_energy_import) - MIN(reactive_energy_import), 0) AS reactive_energy_import_delta,
      AVG(power_factor_total) AS power_factor_avg
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
      energy_export_delta = EXCLUDED.energy_export_delta,
      energy_total_delta = EXCLUDED.energy_total_delta,
      reactive_energy_import_delta = EXCLUDED.reactive_energy_import_delta,
      power_factor_avg = EXCLUDED.power_factor_avg
  `;

  const rDay = await telemetryDb.query(sqlDaily, params);
  log.info(`Daily aggregation for ${dayStart.toISOString().split('T')[0]}: ${rDay.rowCount} rows upserted`);

  const result = {
    day: dayStart.toISOString().split('T')[0],
    filters: { site_id: siteId, terrain_id: terrainId, point_id: pointId },
    upserted: rDay.rowCount
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
    log.info(`Processing messages for device ${device_key} terrain ${terrain_id}`);

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
      log.info(`No messages found for device ${device_key}`);
      return {
        ok: true,
        message: "No messages to process",
        device_key, terrain_id, point_id,
        processed: 0,
      };
    }

    log.info(`Found ${msgs.rows.length} messages to process`);
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
          log.info(`✗ Ingest failed for msg ${msg.id}: ${data.error || resp.status}`);
          failed++;
          results.push({ message_id: msg.id, ok: false, error: data.error || "ingest failed" });
          continue;
        }

        // Mark as ingested and remove from incoming_messages
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]).catch(() => {});

        processed++;
        results.push({ message_id: msg.id, ok: true, ingested: true });
      } catch (e) {
        log.info(`✗ Error for msg ${msg.id}: ${e.message}`);
        failed++;
        results.push({ message_id: msg.id, ok: false, error: e.message });
      }
    }

    const summary = { total: msgs.rows.length, processed, failed };
    log.info(`Done: ${JSON.stringify(summary)}`);

    return {
      ok: true,
      device_key, terrain_id, point_id,
      summary,
      results: results.slice(0, 20),
    };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
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
    log.info(`Starting stale device check (warn=${WARN_MINUTES}m, crit=${CRITICAL_MINUTES}m)`);

    // 1) Find stale devices
    const staleDevices = await db.query(
      `SELECT dr.id, dr.device_key, dr.terrain_id, dr.point_id,
              dr.last_seen_at,
              EXTRACT(EPOCH FROM (NOW() - dr.last_seen_at)) / 60 AS minutes_silent,
              mp.name AS point_name, t.name AS terrain_name
       FROM device_registry dr
       LEFT JOIN measurement_points mp ON mp.id = dr.point_id
       LEFT JOIN terrains t ON t.id = dr.terrain_id
       WHERE dr.last_seen_at IS NOT NULL
         AND dr.last_seen_at < NOW() - ($1 * INTERVAL '1 minute')`,
      [WARN_MINUTES]
    );

    log.info(`Found ${staleDevices.rows.length} stale device(s)`);

    let created = 0;
    let escalated = 0;
    let resolved = 0;

    for (const dev of staleDevices.rows) {
      const minutesSilent = Math.round(dev.minutes_silent);
      const severity = minutesSilent >= CRITICAL_MINUTES ? "critical" : "warning";
      const deviceLabel = dev.point_name || dev.device_key;

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
          log.info(`↑ Escalated incident ${inc.id} for ${dev.device_key} (${minutesSilent}m)`);
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
      log.info(`Created ${severity} incident for ${dev.device_key} (${minutesSilent}m)`);
      auditLog(severity === 'critical' ? 'error' : 'warn', 'worker',
        `Appareil silencieux détecté: ${deviceLabel} (${minutesSilent}min)`,
        { device_key: dev.device_key, minutes_silent: minutesSilent, severity });
    }

    // 2) Auto-resolve incidents for devices that came back online
    const autoResolved = await db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
              description = description || ' — Auto-résolu: appareil de retour en ligne.'
       WHERE source = 'stale_device_monitor'
         AND status IN ('open', 'acknowledged')
         AND metadata->>'device_key' IN (
           SELECT device_key FROM device_registry
           WHERE last_seen_at >= NOW() - ($1 * INTERVAL '1 minute')
         )
       RETURNING id, metadata->>'device_key' AS device_key`,
      [WARN_MINUTES]
    );

    resolved = autoResolved.rowCount;
    for (const r of autoResolved.rows) {
      log.info(`✓ Auto-resolved incident ${r.id} for ${r.device_key}`);
    }

    const summary = { stale_found: staleDevices.rows.length, created, escalated, resolved };
    log.info(`Done: ${JSON.stringify(summary)}`);
    if (created > 0 || escalated > 0 || resolved > 0) {
      auditLog('info', 'worker', `Stale check: ${created} créé(s), ${escalated} escaladé(s), ${resolved} résolu(s)`, summary);
    }
    return { ok: true, summary };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
    auditLog('error', 'worker', `Stale device check failed: ${e.message}`, { error: e.message });
    return { ok: false, error: e.message };
  }
}

// Background cleanup: find mapped messages whose devices exist in device_registry
// and re-send them to the ingestion service to create actual acrel_readings.
async function runCleanupUnmappedMessages(payload = {}) {
  try {
    log.info('Starting cleanup of mapped messages...');

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
      log.info('No mapped messages found - nothing to do');
      return { ok: true, message: "No mapped messages to process", processed: 0 };
    }

    log.info(`Found ${messages.rows.length} mapped messages to process`);

    const ingestServiceUrl = process.env.INGESTION_SERVICE_URL || "http://ingestion-service:3001";
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const msg of messages.rows) {
      try {
        const payload_raw = msg.payload_raw || {};
        const terrainId = msg.terrain_id || msg.mapped_terrain_id;

        if (!terrainId) {
          log.info(`Skipping msg ${msg.id}: no terrain_id`);
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

        log.info(`Processing msg ${msg.id} (device: ${msg.device_key}, time: ${msgTime})`);

        const resp = await fetch(`${ingestServiceUrl}/acrel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ingestPayload),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          log.info(`✗ Ingestion failed for msg ${msg.id}: ${data.error || resp.status}`);
          failed++;
          errors.push({ id: msg.id, error: data.error || `HTTP ${resp.status}` });
          continue;
        }

        // Success: delete message from incoming_messages (no more "mapped" lingering)
        await db.query(`DELETE FROM incoming_messages WHERE id = $1`, [msg.id]);
        processed++;
        log.info(`✓ msg ${msg.id} ingested and removed`);
      } catch (e) {
        log.info(`✗ Error processing msg ${msg.id}: ${e.message}`);
        failed++;
        errors.push({ id: msg.id, error: e.message });
      }
    }

    const summary = { total: messages.rows.length, processed, failed };
    log.info(`Done: ${JSON.stringify(summary)}`);
    if (processed > 0 || failed > 0) {
      auditLog('info', 'worker', `Cleanup: ${processed} traité(s), ${failed} échec(s) sur ${messages.rows.length}`, summary);
    }

    return {
      ok: true,
      summary,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
    auditLog('error', 'worker', `Cleanup failed: ${e.message}`, { error: e.message });
    return { ok: false, error: e.message };
  }
}

// ─── Aggregation gap checker ────────────────────────────────
// Detects points that have readings but missing aggregation buckets
async function runCheckAggregationGaps(payload = {}) {
  if (!telemetryDb) throw new Error("telemetryDb not available");
  if (!db) throw new Error("Core DB not available");

  const LOOKBACK_HOURS = payload.lookback_hours || 6;

  try {
    log.info(`Checking aggregation gaps (lookback=${LOOKBACK_HOURS}h)`);

    // Find points that have readings in the last N hours but missing 15m agg buckets
    const gaps = await telemetryDb.query(`
      WITH reading_buckets AS (
        SELECT point_id,
               time_bucket('15 minutes', time) AS bucket,
               count(*)::int AS reading_count
        FROM acrel_readings
        WHERE time > now() - ($1 * INTERVAL '1 hour')
        GROUP BY point_id, bucket
      ),
      agg_buckets AS (
        SELECT point_id, bucket_start AS bucket
        FROM acrel_agg_15m
        WHERE bucket_start > now() - ($1 * INTERVAL '1 hour')
      )
      SELECT rb.point_id, rb.bucket, rb.reading_count
      FROM reading_buckets rb
      LEFT JOIN agg_buckets ab ON ab.point_id = rb.point_id AND ab.bucket = rb.bucket
      WHERE ab.bucket IS NULL
        AND rb.bucket < now() - interval '20 minutes'
      ORDER BY rb.bucket DESC
      LIMIT 100
    `, [LOOKBACK_HOURS]);

    if (gaps.rows.length === 0) {
      log.info('No aggregation gaps found');
      return { ok: true, summary: { gaps_found: 0, repaired: 0 } };
    }

    log.info(`Found ${gaps.rows.length} missing aggregation bucket(s)`);

    // Auto-repair: re-run aggregation for each gap
    let repaired = 0;
    const pointBuckets = {};
    for (const gap of gaps.rows) {
      const key = gap.point_id;
      if (!pointBuckets[key]) pointBuckets[key] = [];
      pointBuckets[key].push(gap.bucket);
    }

    for (const [pointId, buckets] of Object.entries(pointBuckets)) {
      try {
        const earliest = new Date(Math.min(...buckets.map(b => new Date(b).getTime())));
        const latest = new Date(Math.max(...buckets.map(b => new Date(b).getTime() + 15 * 60 * 1000)));

        await runAggregate({
          from: earliest.toISOString(),
          to: latest.toISOString(),
          point_id: pointId,
        });
        repaired += buckets.length;
        log.info(`✓ Repaired ${buckets.length} bucket(s) for point ${pointId}`);
      } catch (e) {
        log.info(`✗ Repair failed for point ${pointId}: ${e.message}`);
      }
    }

    const summary = { gaps_found: gaps.rows.length, repaired, points_affected: Object.keys(pointBuckets).length };
    log.info(`Done: ${JSON.stringify(summary)}`);

    if (gaps.rows.length > 0) {
      auditLog(repaired < gaps.rows.length ? 'warn' : 'info', 'worker',
        `Aggregation gaps: ${gaps.rows.length} trouvé(s), ${repaired} réparé(s)`, summary);
    }

    return { ok: true, summary };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
    auditLog('error', 'worker', `Aggregation gap check failed: ${e.message}`, { error: e.message });
    return { ok: false, error: e.message };
  }
}

// ─── Queue health checker ───────────────────────────────────
// Monitors BullMQ queue status and creates incidents for anomalies
async function runCheckQueueHealth(payload = {}) {
  if (!db) throw new Error("Core DB not available");

  const { connection: redis } = require("./shared");
  if (!redis) return { ok: true, summary: { message: "Redis not available" } };

  const FAILED_THRESHOLD = payload.failed_threshold || 20;
  const STUCK_THRESHOLD_MIN = payload.stuck_threshold_min || 15;

  try {
    log.info('Checking BullMQ queue health');

    const queues = ["telemetry", "ai", "reports"];
    const issues = [];

    for (const q of queues) {
      const waiting = await redis.llen(`bull:${q}:wait`);
      const active = await redis.llen(`bull:${q}:active`);
      const failed = await redis.zcard(`bull:${q}:failed`);

      // Check for excessive failed jobs
      if (failed > FAILED_THRESHOLD) {
        issues.push({
          queue: q, severity: failed > FAILED_THRESHOLD * 3 ? "critical" : "warning",
          issue: "excessive_failures", detail: `${failed} failed jobs`,
          metrics: { waiting, active, failed },
        });
      }

      // Check for stuck active jobs (active > 0 with nothing completing)
      if (active > 5) {
        issues.push({
          queue: q, severity: "warning",
          issue: "stuck_active", detail: `${active} active jobs possibly stuck`,
          metrics: { waiting, active, failed },
        });
      }

      // Check for backlog
      if (waiting > 100) {
        issues.push({
          queue: q, severity: waiting > 500 ? "critical" : "warning",
          issue: "backlog", detail: `${waiting} jobs waiting`,
          metrics: { waiting, active, failed },
        });
      }

      log.info(`Queue ${q}: waiting=${waiting} active=${active} failed=${failed}`);
    }

    // Create/update incidents for issues
    let created = 0;
    for (const issue of issues) {
      const existing = await db.query(
        `SELECT id FROM incidents
         WHERE source = 'queue_health_monitor'
           AND status IN ('open', 'acknowledged')
           AND metadata->>'queue' = $1
           AND metadata->>'issue' = $2
         LIMIT 1`,
        [issue.queue, issue.issue]
      );

      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO incidents (id, title, description, severity, status, source, metadata)
           VALUES (gen_random_uuid(), $1, $2, $3, 'open', 'queue_health_monitor', $4)`,
          [
            `Queue ${issue.queue}: ${issue.issue}`,
            `Queue "${issue.queue}" — ${issue.detail}`,
            issue.severity,
            JSON.stringify({ queue: issue.queue, issue: issue.issue, ...issue.metrics }),
          ]
        );
        created++;
        log.info(`Created ${issue.severity} incident for ${issue.queue}/${issue.issue}`);
      }
    }

    // Auto-resolve issues that are no longer present
    const issueQueues = issues.length > 0 ? issues.map(i => i.queue) : ['__none__'];
    const placeholders = issueQueues.map((_, i) => `$${i + 1}`).join(",");
    const autoResolved = await db.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
              description = description || ' — Auto-résolu.'
       WHERE source = 'queue_health_monitor'
         AND status IN ('open', 'acknowledged')
         AND metadata->>'queue' NOT IN (${placeholders})
       RETURNING id`,
      issueQueues
    );

    const summary = { issues_found: issues.length, created, resolved: autoResolved.rowCount };
    log.info(`Done: ${JSON.stringify(summary)}`);

    if (issues.length > 0) {
      auditLog('warn', 'worker', `Queue health: ${issues.length} problème(s) détecté(s)`, summary);
    }

    return { ok: true, summary };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
    auditLog('error', 'worker', `Queue health check failed: ${e.message}`, { error: e.message });
    return { ok: false, error: e.message };
  }
}

// ─── Pipeline heartbeat ─────────────────────────────────────
// Periodic full pipeline status check with DB logging
async function runPipelineHeartbeat(payload = {}) {
  if (!db) throw new Error("Core DB not available");

  try {
    log.info('Running pipeline heartbeat check');

    const checks = {};

    // 1) Core DB
    try {
      const r = await db.query("SELECT NOW() as now, count(*)::int as users FROM users");
      checks.core_db = { status: "up", users: r.rows[0].users };
    } catch (e) {
      checks.core_db = { status: "down", error: e.message };
    }

    // 2) Telemetry DB
    if (telemetryDb) {
      try {
        const r = await telemetryDb.query(`
          SELECT count(*)::int AS readings_1h, max(time) AS latest_reading
          FROM acrel_readings WHERE time > now() - interval '1 hour'
        `);
        const throughput = r.rows[0].readings_1h;
        checks.telemetry_db = {
          status: throughput > 0 ? "up" : "warning",
          readings_last_hour: throughput,
          latest_reading: r.rows[0].latest_reading,
        };
      } catch (e) {
        checks.telemetry_db = { status: "down", error: e.message };
      }
    } else {
      checks.telemetry_db = { status: "disabled" };
    }

    // 3) Device activity
    try {
      const r = await db.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE last_seen_at > now() - interval '30 minutes')::int AS active,
               count(*) FILTER (WHERE last_seen_at <= now() - interval '30 minutes')::int AS stale,
               count(*) FILTER (WHERE last_seen_at IS NULL)::int AS never_seen
        FROM device_registry
      `);
      checks.devices = r.rows[0];
    } catch (e) {
      checks.devices = { error: e.message };
    }

    // 4) Pending messages
    try {
      const r = await db.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'unmapped')::int AS unmapped,
               count(*) FILTER (WHERE status = 'mapped')::int AS mapped
        FROM incoming_messages
      `);
      checks.pending_messages = r.rows[0];
    } catch (e) {
      checks.pending_messages = { error: e.message };
    }

    // 5) Open incidents
    try {
      const r = await db.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE severity = 'critical')::int AS critical,
               count(*) FILTER (WHERE severity = 'warning')::int AS warning
        FROM incidents WHERE status IN ('open', 'acknowledged')
      `);
      checks.open_incidents = r.rows[0];
    } catch (e) {
      checks.open_incidents = { error: e.message };
    }

    // Determine overall status
    const hasDown = Object.values(checks).some(c => c.status === "down");
    const hasWarning = Object.values(checks).some(c => c.status === "warning");
    const overall = hasDown ? "degraded" : hasWarning ? "warning" : "healthy";

    log.info(`Pipeline status: ${overall}`);
    auditLog('info', 'system', `Pipeline heartbeat: ${overall}`, checks);

    // Create incident if pipeline is degraded
    if (hasDown) {
      const downComponents = Object.entries(checks)
        .filter(([_, v]) => v.status === "down")
        .map(([k]) => k);

      const existing = await db.query(
        `SELECT id FROM incidents
         WHERE source = 'pipeline_heartbeat' AND status IN ('open', 'acknowledged')
         LIMIT 1`
      );

      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO incidents (id, title, description, severity, status, source, metadata)
           VALUES (gen_random_uuid(), $1, $2, 'critical', 'open', 'pipeline_heartbeat', $3)`,
          [
            `Pipeline dégradée: ${downComponents.join(", ")}`,
            `Composant(s) en panne: ${downComponents.join(", ")}. Intervention nécessaire.`,
            JSON.stringify(checks),
          ]
        );
        auditLog('error', 'system', `Pipeline dégradée: ${downComponents.join(", ")} en panne`, checks);
      }
    } else {
      // Auto-resolve pipeline incident if everything is back up
      await db.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
                description = description || ' — Auto-résolu: pipeline rétablie.'
         WHERE source = 'pipeline_heartbeat' AND status IN ('open', 'acknowledged')`
      );
    }

    return { ok: true, overall, checks };
  } catch (e) {
    log.info(`✗ Fatal error: ${e.message}`);
    auditLog('error', 'system', `Pipeline heartbeat failed: ${e.message}`, { error: e.message });
    return { ok: false, error: e.message };
  }
}

// ─── Power peaks daily computation ──────────────────────────
async function computePowerPeaks() {
  if (!telemetryDb) throw new Error("telemetryDb not available");
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // Get all terrains
  const { rows: terrains } = await db.query("SELECT id FROM terrains");
  let total = 0;

  for (const t of terrains) {
    const { rows } = await telemetryDb.query(
      `SELECT point_id, MAX(active_power_total) AS max_power,
              (array_agg(time ORDER BY active_power_total DESC))[1] AS peak_time
       FROM acrel_readings
       WHERE terrain_id = $1 AND time >= $2 AND time < $3
         AND active_power_total IS NOT NULL
       GROUP BY point_id`,
      [t.id, yesterday, today]
    );

    for (const r of rows) {
      await telemetryDb.query(
        `INSERT INTO power_peaks (terrain_id, point_id, peak_date, max_power, peak_time)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (point_id, peak_date) DO UPDATE SET max_power = $4, peak_time = $5`,
        [t.id, r.point_id, yesterday, r.max_power, r.peak_time]
      );
      total++;
    }
  }

  log.info(`✓ Power peaks computed: ${total} peaks for ${terrains.length} terrains (${yesterday})`);
  return { ok: true, date: yesterday, peaksUpserted: total };
}

async function runDiskRecovery(payload = {}) {
  const trashMaxAgeDays = payload.trash_max_age_days ?? 7;

  const results = { ok: true, trash_batches_removed: 0, vacuumed: [], db_size_before: 0, db_size_after: 0 };

  // 1) Measure DB size before
  const beforeRes = await telemetryDb.query(`SELECT pg_database_size(current_database()) AS db_bytes`);
  results.db_size_before = parseInt(beforeRes.rows[0]?.db_bytes ?? 0);

  // 2) Delete old trash batches (CASCADE deletes trash rows)
  if (trashMaxAgeDays > 0) {
    const del = await telemetryDb.query(
      `DELETE FROM purge_batches WHERE restored_at IS NULL AND deleted_at < NOW() - ($1 || ' days')::interval`,
      [String(trashMaxAgeDays)]
    );
    results.trash_batches_removed = del.rowCount ?? 0;
    log.info(`Disk recovery: deleted ${results.trash_batches_removed} old trash batches (> ${trashMaxAgeDays} days)`);
  }

  // 3) VACUUM FULL to reclaim disk space
  const tablesToVacuum = [
    'acrel_readings_trash', 'acrel_agg_15m_trash', 'acrel_agg_daily_trash',
    'purge_batches',
    'acrel_readings', 'acrel_agg_15m', 'acrel_agg_daily',
    'incoming_messages',
  ];

  for (const tbl of tablesToVacuum) {
    try {
      await telemetryDb.query(`VACUUM FULL ${tbl}`);
      results.vacuumed.push(tbl);
      log.info(`VACUUM FULL ${tbl} done`);
    } catch (e) {
      log.info(`VACUUM FULL ${tbl} skipped: ${e.message}`);
    }
  }

  // 4) Measure DB size after
  const afterRes = await telemetryDb.query(`SELECT pg_database_size(current_database()) AS db_bytes`);
  results.db_size_after = parseInt(afterRes.rows[0]?.db_bytes ?? 0);
  results.recovered = results.db_size_before - results.db_size_after;

  const fmt = (b) => {
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  results.recovered_human = fmt(Math.max(0, results.recovered));
  results.db_size_before_human = fmt(results.db_size_before);
  results.db_size_after_human = fmt(results.db_size_after);

  auditLog('warn', 'worker', `Disk recovery completed: trash=${results.trash_batches_removed}, vacuumed=${results.vacuumed.length}, recovered=${results.recovered_human}`, results);
  log.info(`✓ Disk recovery: ${results.recovered_human} recovered, ${results.trash_batches_removed} trash batches removed, ${results.vacuumed.length} tables vacuumed`);

  return results;
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
        log.info(`Skipped: no pointId in job data`);
        return { ok: true, skipped: "no pointId" };
      }

      try {
        log.info(`Starting aggregation for point ${pointId}, time ${time}`);
        
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

        log.info(`✓ Aggregation done for point ${pointId}: ${JSON.stringify(summary.upserted)}`);
        return { ok: true, summary };
      } catch (e) {
        log.info(`✗ Aggregation failed for point ${pointId}: ${e.message}`);
        auditLog('error', 'worker', `Aggregation failed for point ${pointId}: ${e.message}`, { pointId, error: e.message });
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

      // ── telemetry.aggregate_daily: midnight UTC job to finalize yesterday's day ──
      if (job.name === "telemetry.aggregate_daily") {
        const summary = await runDailyAggregation(payload);

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

      // ── telemetry.check_aggregation_gaps: periodic aggregation gap detection + auto-repair ──
      if (job.name === "telemetry.check_aggregation_gaps") {
        const summary = await runCheckAggregationGaps(payload || {});

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

      // ── telemetry.check_queue_health: periodic BullMQ queue monitoring ──
      if (job.name === "telemetry.check_queue_health") {
        const summary = await runCheckQueueHealth(payload || {});

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

      // ── telemetry.pipeline_heartbeat: periodic pipeline health logging ──
      if (job.name === "telemetry.pipeline_heartbeat") {
        const summary = await runPipelineHeartbeat(payload || {});

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

      if (job.name === "telemetry.compute_power_peaks") {
        const result = await computePowerPeaks();
        if (runId) {
          await insertJobResult(runId, job.name, result);
          await setRunStatus(runId, "success", { finished_at: new Date().toISOString(), result });
        }
        return { ok: true, result };
      }

      // ── telemetry.disk_recovery: trash cleanup + VACUUM FULL ──
      if (job.name === "telemetry.disk_recovery") {
        const summary = await runDiskRecovery(payload || {});
        if (runId) {
          await insertJobResult(runId, job.name, summary);
          await setRunStatus(runId, summary.ok ? "success" : "failed", {
            finished_at: new Date().toISOString(),
            result: summary,
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

log.info("worker listening: telemetry");