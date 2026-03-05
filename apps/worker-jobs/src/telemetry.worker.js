const { Worker } = require("bullmq");
const { connection, setRunStatus, insertJobResult, telemetryDb } = require("./shared");

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