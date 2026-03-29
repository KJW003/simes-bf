const { Worker } = require("bullmq");
const { connection, db, telemetryDb, setRunStatus, insertJobResult } = require("./shared");
const log = require("./config/logger");

if (!connection) {
  log.warn("reports-worker skipped – no Redis connection");
  return;
}

// ═══════════════════════════════════════════════════════════════
//  ENERGY AUDIT — scoring algorithm (ported from EnergyAudit.tsx)
// ═══════════════════════════════════════════════════════════════

async function computeEnergyAudit(payload) {
  const { terrain_id, audit_report_id, period_from, period_to } = payload;
  if (!terrain_id) throw new Error("terrain_id is required");
  if (!audit_report_id) throw new Error("audit_report_id is required");

  // Update status to computing
  await db.query(
    `UPDATE energy_audit_reports SET status = 'computing', updated_at = now() WHERE id = $1`,
    [audit_report_id]
  );

  // 1) Fetch measurement points for this terrain
  const pointsRes = await db.query(
    `SELECT mp.id, mp.name, mp.dev_eui
     FROM measurement_points mp
     WHERE mp.terrain_id = $1 AND mp.status = 'active'`,
    [terrain_id]
  );
  const points = pointsRes.rows;

  if (!points.length) {
    throw new Error("No active measurement points found for this terrain");
  }

  // 2) Fetch 24h readings from telemetry DB
  const readingsRes = await telemetryDb.query(
    `SELECT point_id,
            active_power_total,
            power_factor_total,
            thdi_a, thdi_b, thdi_c,
            voltage_unbalance,
            energy_total, energy_import
     FROM acrel_readings
     WHERE terrain_id = $1
       AND time >= $2
       AND time < $3
     ORDER BY time ASC`,
    [terrain_id, period_from, period_to]
  );
  const readings = readingsRes.rows;

  log.info({ terrain_id, points: points.length, readings: readings.length }, "Audit: data fetched");

  // 3) Compute diagnostics
  const diagnostics = [];

  // 3a) Power factor average
  const pfValues = readings
    .map((r) => r.power_factor_total)
    .filter((v) => v != null)
    .map(Number);
  const pfAvg = pfValues.length
    ? pfValues.reduce((s, v) => s + v, 0) / pfValues.length
    : null;

  if (pfAvg != null) {
    diagnostics.push({
      label: "Facteur de puissance",
      status: pfAvg < 0.85 ? "warning" : "ok",
      detail: `PF moyen ${pfAvg.toFixed(3)} (24h, ${pfValues.length} mesures)`,
    });
  }

  // 3b) THD (Total Harmonic Distortion)
  const thdValues = readings
    .flatMap((r) => [r.thdi_a, r.thdi_b, r.thdi_c])
    .filter((v) => v != null)
    .map(Number);
  const thdAvg = thdValues.length
    ? thdValues.reduce((s, v) => s + v, 0) / thdValues.length
    : null;
  const thdMax = thdValues.length ? Math.max(...thdValues) : 0;

  if (thdAvg != null) {
    diagnostics.push({
      label: "Distorsion harmonique (THD)",
      status: thdMax > 8 ? "critical" : thdMax > 5 ? "warning" : "ok",
      detail: `Moy ${thdAvg.toFixed(1)}% — Max ${thdMax.toFixed(1)}%`,
    });
  }

  // 3c) Voltage unbalance
  const vUnbalValues = readings
    .map((r) => r.voltage_unbalance)
    .filter((v) => v != null)
    .map(Number);
  const vUnbalMax = vUnbalValues.length ? Math.max(...vUnbalValues) : 0;
  const vUnbalAvg = vUnbalValues.length
    ? vUnbalValues.reduce((s, v) => s + v, 0) / vUnbalValues.length
    : null;

  if (vUnbalAvg != null) {
    diagnostics.push({
      label: "Qualité tension",
      status: vUnbalMax > 3 ? "warning" : "ok",
      detail: `Déséquilibre moy ${vUnbalAvg.toFixed(1)}% — max ${vUnbalMax.toFixed(1)}%`,
    });
  }

  // 3d) Data completeness (expected ~96 readings per 24h per point at 15min intervals)
  const expectedReadings = points.length * 96;
  const completeness = expectedReadings > 0 ? (readings.length / expectedReadings) * 100 : 0;
  diagnostics.push({
    label: "Complétude données",
    status: completeness < 80 ? "warning" : "ok",
    detail: `${readings.length} mesures / ~${expectedReadings} attendues (${completeness.toFixed(0)}%)`,
  });

  // 4) Compute efficiency score (0-100)
  let score = 100;

  // PF penalty
  if (pfAvg != null && pfAvg > 0 && pfAvg < 0.85) score -= 20;
  else if (pfAvg != null && pfAvg > 0 && pfAvg < 0.92) score -= 10;

  // THD penalty
  if (thdMax > 8) score -= 15;
  else if (thdMax > 5) score -= 8;

  // Voltage unbalance penalty
  if (vUnbalMax > 3) score -= 15;
  else if (vUnbalMax > 2) score -= 8;

  // Data completeness penalty
  if (completeness < 80) score -= 10;
  else if (completeness < 90) score -= 5;

  // Diagnostic issues penalty
  const issues = diagnostics.filter((d) => d.status !== "ok").length;
  score -= issues * 5;

  score = Math.max(0, Math.min(100, score));

  const scoreLabel =
    score >= 85 ? "Excellent" : score >= 70 ? "Bon" : score >= 50 ? "Moyen" : "Critique";

  // 5) Compute recommendations
  const recommendations = [];

  // Group readings by point for per-point analysis
  const readingsByPoint = new Map();
  for (const r of readings) {
    const pid = String(r.point_id);
    if (!readingsByPoint.has(pid)) readingsByPoint.set(pid, []);
    readingsByPoint.get(pid).push(r);
  }

  // Find latest reading per point for recommendations
  const latestByPoint = new Map();
  for (const [pid, pReadings] of readingsByPoint) {
    latestByPoint.set(pid, pReadings[pReadings.length - 1]);
  }

  // Low PF points
  const lowPfPoints = [];
  for (const p of points) {
    const latest = latestByPoint.get(String(p.id));
    if (latest && latest.power_factor_total != null && Number(latest.power_factor_total) < 0.85) {
      lowPfPoints.push(p.name);
    }
  }
  if (lowPfPoints.length > 0) {
    recommendations.push({
      priority: "Haute",
      title: `${lowPfPoints.length} point(s) avec PF < 0.85`,
      impact: "Risque de pénalité facteur de puissance",
      points: lowPfPoints,
    });
  }

  // High THD points
  const highThdPoints = [];
  for (const p of points) {
    const latest = latestByPoint.get(String(p.id));
    if (latest) {
      const vals = [latest.thdi_a, latest.thdi_b, latest.thdi_c];
      if (vals.some((v) => v != null && Number(v) > 8)) {
        highThdPoints.push(p.name);
      }
    }
  }
  if (highThdPoints.length > 0) {
    recommendations.push({
      priority: "Haute",
      title: `${highThdPoints.length} point(s) avec THD > 8%`,
      impact: "Harmoniques élevées — risque d'échauffement",
      points: highThdPoints,
    });
  }

  // Voltage unbalance points
  const unbalPoints = [];
  for (const p of points) {
    const latest = latestByPoint.get(String(p.id));
    if (latest && latest.voltage_unbalance != null && Number(latest.voltage_unbalance) > 2) {
      unbalPoints.push(p.name);
    }
  }
  if (unbalPoints.length > 0) {
    recommendations.push({
      priority: "Moyenne",
      title: `${unbalPoints.length} point(s) avec déséquilibre > 2%`,
      impact: "Vérifier distribution monophasée",
      points: unbalPoints,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: "Basse",
      title: "Aucun problème critique détecté",
      impact: "Installation dans les normes",
    });
  }

  // 6) Per-point diagnostics
  const pointDiagnostics = [];
  for (const p of points) {
    const latest = latestByPoint.get(String(p.id));
    if (!latest) continue;

    const pf = latest.power_factor_total != null ? Number(latest.power_factor_total) : null;
    const thdA = latest.thdi_a != null ? Number(latest.thdi_a) : null;
    const vUnbal = latest.voltage_unbalance != null ? Number(latest.voltage_unbalance) : null;
    const power = latest.active_power_total != null ? Number(latest.active_power_total) : 0;

    let pointScore = 100;
    if (pf != null && pf < 0.85) pointScore -= 25;
    else if (pf != null && pf < 0.92) pointScore -= 10;
    if (thdA != null && thdA > 8) pointScore -= 20;
    else if (thdA != null && thdA > 5) pointScore -= 10;
    if (vUnbal != null && vUnbal > 3) pointScore -= 15;

    pointDiagnostics.push({
      point_id: p.id,
      name: p.name,
      pf,
      thdA,
      vUnbal,
      power,
      score: Math.max(0, pointScore),
    });
  }

  // 7) Energy delta (kWh consumed in 24h)
  const byPoint = new Map();
  for (const r of readings) {
    const val =
      r.energy_total != null
        ? Number(r.energy_total)
        : r.energy_import != null
          ? Number(r.energy_import)
          : NaN;
    if (isNaN(val)) continue;
    const pid = String(r.point_id);
    const entry = byPoint.get(pid);
    if (!entry) byPoint.set(pid, { min: val, max: val });
    else {
      entry.min = Math.min(entry.min, val);
      entry.max = Math.max(entry.max, val);
    }
  }
  let energyKwh = 0;
  for (const { min, max } of byPoint.values()) energyKwh += Math.max(0, max - min);

  // KPI summary
  const kpi = {
    points_count: points.length,
    readings_count: readings.length,
    pf_global: pfAvg != null ? Number(pfAvg.toFixed(3)) : null,
    thd_max: Number(thdMax.toFixed(1)),
    thd_avg: thdAvg != null ? Number(thdAvg.toFixed(1)) : null,
    v_unbalance_max: Number(vUnbalMax.toFixed(1)),
    data_completeness_pct: Number(completeness.toFixed(1)),
    energy_kwh: Number(energyKwh.toFixed(1)),
  };

  // 8) Persist results to energy_audit_reports
  await db.query(
    `UPDATE energy_audit_reports
     SET efficiency_score = $2,
         score_label = $3,
         diagnostics = $4::jsonb,
         recommendations = $5::jsonb,
         point_diagnostics = $6::jsonb,
         kpi = $7::jsonb,
         status = 'ready',
         computed_at = now(),
         updated_at = now(),
         error = NULL
     WHERE id = $1`,
    [
      audit_report_id,
      score,
      scoreLabel,
      JSON.stringify(diagnostics),
      JSON.stringify(recommendations),
      JSON.stringify(pointDiagnostics),
      JSON.stringify(kpi),
    ]
  );

  log.info(
    { audit_report_id, terrain_id, score, scoreLabel, points: points.length, readings: readings.length },
    "Energy audit computed successfully"
  );

  return {
    audit_report_id,
    terrain_id,
    efficiency_score: score,
    score_label: scoreLabel,
    kpi,
    diagnostics_count: diagnostics.length,
    recommendations_count: recommendations.length,
    point_count: pointDiagnostics.length,
  };
}

// ═══════════════════════════════════════════════════════════════
//  WORKER
// ═══════════════════════════════════════════════════════════════

new Worker(
  "reports",
  async (job) => {
    const { runId, payload } = job.data;
    await setRunStatus(runId, "running", { started_at: new Date().toISOString() });

    try {
      if (job.name === "energy_audit") {
        const result = await computeEnergyAudit(payload);
        await insertJobResult(runId, job.name, result);
        await setRunStatus(runId, "success", {
          finished_at: new Date().toISOString(),
          result,
        });
        return { ok: true };
      }

      // Default handler for other report jobs
      await new Promise((r) => setTimeout(r, 900));
      const result = { queue: "reports", name: job.name };

      try {
        await insertJobResult(runId, job.name, result);
        log.info({ runId, type: job.name }, "job_results inserted");
      } catch (e) {
        log.error({ runId, type: job.name, err: e.message }, "job_results insert failed");
      }

      await setRunStatus(runId, "success", {
        finished_at: new Date().toISOString(),
        result,
      });
      return { ok: true };
    } catch (e) {
      // Mark audit report as failed if applicable
      if (payload?.audit_report_id) {
        try {
          await db.query(
            `UPDATE energy_audit_reports SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
            [payload.audit_report_id, e.message]
          );
        } catch (dbErr) {
          log.error({ err: dbErr.message }, "Failed to mark audit report as failed");
        }
      }

      await setRunStatus(runId, "failed", {
        finished_at: new Date().toISOString(),
        error: e.message,
      });
      throw e;
    }
  },
  { connection }
);

log.info("worker listening: reports");
