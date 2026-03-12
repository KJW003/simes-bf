const { Worker } = require("bullmq");
const { connection, db, telemetryDb, setRunStatus, insertJobResult } = require("./shared");
const log = require("./config/logger");
const { auditLog } = require("./audit-log");

if (!connection) {
  log.warn("ai-worker skipped – no Redis connection");
  return;
}

function isIso(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

function minOfDayFromTs(tsIso) {
  const d = new Date(tsIso);
  const h = d.getUTCHours();   // V1: on calcule en UTC (à améliorer plus tard)
  const m = d.getUTCMinutes();
  return h * 60 + m;
}

async function computeFacture(payload = {}) {
  if (!db) throw new Error("CORE_DB_URL not configured – cannot compute invoice");
  if (!telemetryDb) throw new Error("TELEMETRY_DB_URL not configured – cannot compute invoice");

  const terrainId = payload.terrain_id;
  if (!terrainId) throw new Error("terrain_id is required");

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = payload.from && isIso(payload.from) ? new Date(payload.from) : defaultFrom;
  const to = payload.to && isIso(payload.to) ? new Date(payload.to) : now;

  // 1) contrat terrain -> PS + tariff_plan_id + capacitor_power
  const c = await db.query(
    `SELECT terrain_id, tariff_plan_id, subscribed_power_kw, meter_rental, post_rental, maintenance,
            COALESCE(capacitor_power_kw, 0) AS capacitor_power_kw
     FROM terrain_contracts
     WHERE terrain_id = $1`,
    [terrainId]
  );
  if (!c.rows.length) throw new Error("No contract for terrain (set /terrains/:id/contract)");

  const contract = c.rows[0];

  // override PS possible (what-if)
  const subscribedPowerKw =
    typeof payload.subscribed_power_kw === "number" && payload.subscribed_power_kw > 0
      ? payload.subscribed_power_kw
      : Number(contract.subscribed_power_kw);

  const capacitorPowerKw = Number(contract.capacitor_power_kw) || 0;

  // 2) tariff plan (with loss coefficients)
  const t = await db.query(
    `SELECT id, group_code, plan_code, name,
            hp_start_min, hp_end_min, hpt_start_min, hpt_end_min,
            rate_hp, rate_hpt, fixed_monthly, prime_per_kw,
            vat_rate, tde_tdsaae_rate,
            COALESCE(alpha_a, 0) AS alpha_a, COALESCE(beta_a, 0) AS beta_a,
            COALESCE(alpha_r, 0) AS alpha_r, COALESCE(beta_r, 0) AS beta_r
     FROM tariff_plans
     WHERE id = $1`,
    [contract.tariff_plan_id]
  );
  if (!t.rows.length) throw new Error("tariff_plan_id in contract not found");
  const tariff = t.rows[0];

  // 3) fetch 15m aggs for terrain within window
  const rows = await telemetryDb.query(
    `SELECT bucket_start, point_id, samples_count,
            active_power_max,
            COALESCE(energy_total_delta, energy_import_delta, 0) AS energy_delta,
            COALESCE(reactive_energy_import_delta, 0) AS reactive_delta,
            COALESCE(power_factor_avg, 1) AS power_factor_avg
     FROM acrel_agg_15m
     WHERE terrain_id = $1 AND bucket_start >= $2 AND bucket_start < $3
     ORDER BY bucket_start ASC`,
    [terrainId, from.toISOString(), to.toISOString()]
  );

  // 4) classification HP vs HPT by time-of-day + accumulate reactive energy
  let hpKwh = 0;
  let hptKwh = 0;
  let totalKwh = 0;
  let totalReactiveKwh = 0;
  let maxDemandKw = 0;
  let pfSum = 0;
  let pfCount = 0;

  for (const r of rows.rows) {
    const bucketIso = new Date(r.bucket_start).toISOString();
    const minOfDay = minOfDayFromTs(bucketIso);

    const kwh = Number(r.energy_delta || 0);
    totalKwh += kwh;
    totalReactiveKwh += Number(r.reactive_delta || 0);

    if (minOfDay >= tariff.hp_start_min && minOfDay < tariff.hp_end_min) hpKwh += kwh;
    else if (minOfDay >= tariff.hpt_start_min && minOfDay < tariff.hpt_end_min) hptKwh += kwh;
    else hpKwh += kwh;

    const pmax = Number(r.active_power_max || 0);
    if (pmax > maxDemandKw) maxDemandKw = pmax;

    if (r.power_factor_avg != null) {
      pfSum += Number(r.power_factor_avg);
      pfCount++;
    }
  }

  const pfAvg = pfCount > 0 ? pfSum / pfCount : 1;

  // ── 5) SONABEL V2 formulas ──

  // Number of hours in the billing period
  const periodHours = (to.getTime() - from.getTime()) / 3600_000;

  // Wa = total active energy consumed (metered)
  const Wa = totalKwh;

  // Wr = total reactive energy consumed (metered)
  const Wr = totalReactiveKwh;

  // Loss coefficients
  const alphaA = Number(tariff.alpha_a);
  const betaA = Number(tariff.beta_a);
  const alphaR = Number(tariff.alpha_r);
  const betaR = Number(tariff.beta_r);

  // Ma = Active losses : αa × Wa + βa × h
  const Ma = alphaA * Wa + betaA * periodHours;

  // Mr = Reactive losses : αr × Wr + βr × h
  const Mr = alphaR * Wr + betaR * periodHours;

  // K1, K2 = proportion of HP vs HPT in total active consumption
  const K1 = Wa > 0 ? hpKwh / Wa : 0.7;
  const K2 = Wa > 0 ? hptKwh / Wa : 0.3;

  // Active loss allocation per period
  const Ma_HPL = Ma * K1;  // losses attributed to HP
  const Ma_HPT = Ma * K2;  // losses attributed to HPT

  // Billed active energy per period (metered + losses)
  const billedHpKwh = hpKwh + Ma_HPL;
  const billedHptKwh = hptKwh + Ma_HPT;

  // ── Reactive energy and power factor penalty (Kma) ──
  // Cr = total reactive consumption + losses
  const Cr = Wr + Mr;

  // Erc = reactive energy compensated by capacitor bank
  // Erc = Pc × h (capacitor power × hours)
  const Erc = capacitorPowerKw * periodHours;

  // Er = excess reactive energy not compensated
  const Er = Math.max(0, Cr - Erc);

  // P = tg(φ) = Er / (Wa + Ma)
  const WaMa = Wa + Ma;
  const tanPhi = WaMa > 0 ? Er / WaMa : 0;

  // cos(φ) = 1 / √(1 + P²)
  const cosPhi = 1 / Math.sqrt(1 + tanPhi * tanPhi);

  // Kma coefficient (power factor penalty)
  // If cos(φ) >= 0.93 → Kma = 1 (no penalty)
  // If cos(φ) < 0.93 → Kma = 1 + (tg(φ) - 0.75) / 3
  const Kma = cosPhi >= 0.93 ? 1 : Math.max(1, 1 + (tanPhi - 0.75) / 3);

  // ── 6) Cost calculations ──
  const rateHp = Number(tariff.rate_hp);
  const rateHpt = Number(tariff.rate_hpt);
  const fixedMonthly = Number(tariff.fixed_monthly);
  const primePerKw = Number(tariff.prime_per_kw);
  const vatRate = Number(tariff.vat_rate ?? 0.18);

  // Energy cost (HP + HPT on billed quantities including losses)
  const energyHpAmount = billedHpKwh * rateHp;
  const energyHptAmount = billedHptKwh * rateHpt;
  const energyAmount = energyHpAmount + energyHptAmount;

  // Prime fixe (PF) = PS × tarif_PF × Kma / 12
  // (prime_per_kw = tarif_PF, divided by 12 for monthly)
  const months = periodHours / (30 * 24) || 1;
  const demandAmount = subscribedPowerKw * primePerKw * Kma * months;

  // Dépassement (30 * (Pmax-PS) * tarifHPT)
  const exceedKw = Math.max(maxDemandKw - subscribedPowerKw, 0);
  const exceedAmount = 30 * exceedKw * rateHpt;

  // Frais fixes contrat
  const contractFees = (Number(contract.meter_rental || 0) + Number(contract.post_rental || 0) + Number(contract.maintenance || 0)) * months;

  // Subtotal HT
  const subtotal = energyAmount + demandAmount + exceedAmount + contractFees + fixedMonthly * months;

  // TDE + TDSAAE = tde_tdsaae_rate × (Wa + Ma)
  const tdeTdsaaeRate = Number(tariff.tde_tdsaae_rate ?? 2);
  const tde_tdsaae = tdeTdsaaeRate * (Wa + Ma);

  const beforeVat = subtotal + tde_tdsaae;
  const vat = beforeVat * vatRate;
  const totalAmount = beforeVat + vat;

  const breakdown = [
    { key: "HP", label: "Heures pleines (compteur)", kwh: hpKwh, rate: rateHp, amount: hpKwh * rateHp },
    { key: "HPT", label: "Heures de pointe (compteur)", kwh: hptKwh, rate: rateHpt, amount: hptKwh * rateHpt },
    { key: "MA", label: "Pertes actives (Ma)", kwh: Ma, rate: null, amount: null, detail: `αa=${alphaA}, βa=${betaA}` },
    { key: "MA_HP", label: "Ma attribué HP", kwh: Ma_HPL, rate: rateHp, amount: Ma_HPL * rateHp },
    { key: "MA_HPT", label: "Ma attribué HPT", kwh: Ma_HPT, rate: rateHpt, amount: Ma_HPT * rateHpt },
    { key: "ENERGY", label: "Total énergie (avec pertes)", kwh: billedHpKwh + billedHptKwh, rate: null, amount: energyAmount },
    { key: "PF", label: "Prime fixe × Kma", kwh: null, rate: primePerKw, amount: demandAmount, ps_kw: subscribedPowerKw, kma: Kma },
    { key: "EXCEED", label: "Dépassement puissance", kwh: null, rate: rateHpt, amount: exceedAmount, exceed_kw: exceedKw, pmax_kw: maxDemandKw },
    { key: "FIXED", label: "Prime fixe mensuelle", kwh: null, rate: null, amount: fixedMonthly * months },
    { key: "FEES", label: "Frais contrat (location/maintenance)", kwh: null, rate: null, amount: contractFees },
    { key: "TDE_TDSAAE", label: "TDE + TDSAAE", kwh: Wa + Ma, rate: tdeTdsaaeRate, amount: tde_tdsaae },
    { key: "TVA", label: "TVA", kwh: null, rate: vatRate, amount: vat },
  ];

  return {
    version: "V2",
    terrain_id: terrainId,
    period: { from: from.toISOString(), to: to.toISOString(), hours: periodHours },
    tariffVersionId: tariff.id,
    tariffVersionName: tariff.name,
    plan_code: tariff.plan_code,
    // Energy
    totalKwh: Wa,
    peakKwh: hptKwh,
    offPeakKwh: hpKwh,
    reactiveKwh: Wr,
    // Losses
    activeLosses_Ma: Ma,
    reactiveLosses_Mr: Mr,
    billedHpKwh,
    billedHptKwh,
    // Power factor
    pfAvg,
    cosPhi,
    tanPhi,
    Kma,
    capacitorPowerKw,
    excessReactiveKwh: Er,
    // Demand
    maxDemandKw,
    subscribedPowerKw,
    exceedKw,
    // Financials
    breakdown,
    totalAmount,
  };
}

new Worker(
  "ai",
  async (job) => {
    const { runId, payload } = job.data;
    await setRunStatus(runId, "running", { started_at: new Date().toISOString() });

    try {
      if (job.name === "facture") {
        const estimate = await computeFacture(payload);

        await insertJobResult(runId, job.name, estimate);

        await setRunStatus(runId, "success", {
          finished_at: new Date().toISOString(),
          result: estimate,
        });

        return { ok: true };
      }

      if (job.name === "ai.retrain_forecasts" || job.name === "forecast") {
        const mlUrl = process.env.ML_SERVICE_URL || "http://ml-service:8000";
        auditLog('info', 'ai-worker', `ML retrain started (job: ${job.name})`, { jobId: job.id });
        const resp = await fetch(`${mlUrl}/train-all`, { method: "POST" });
        const result = await resp.json();

        if (runId) {
          await insertJobResult(runId, job.name, result);
          await setRunStatus(runId, "success", {
            finished_at: new Date().toISOString(),
            result,
          });
        }

        log.info({ trained: result.trained, total: result.total }, "ML retrain-all complete");
        auditLog('info', 'ai-worker', `ML retrain complete: ${result.trained ?? 0}/${result.total ?? 0} models`, { trained: result.trained, total: result.total });
        return { ok: true };
      }

      if (job.name === "ai.detect_anomalies") {
        const mlUrl = process.env.ML_SERVICE_URL || "http://ml-service:8000";

        // Get all terrains
        const terrains = await db.query("SELECT id FROM terrains");
        const results = [];

        for (const t of terrains.rows) {
          try {
            const resp = await fetch(`${mlUrl}/anomalies/detect/${t.id}`, { method: "POST" });
            const r = await resp.json();
            results.push({ terrain_id: t.id, ...r });
          } catch (err) {
            log.warn({ terrain_id: t.id, err: err.message }, "anomaly detection failed for terrain");
            results.push({ terrain_id: t.id, error: err.message });
          }
        }

        const summary = { terrains: results.length, results };

        if (runId) {
          await insertJobResult(runId, job.name, summary);
          await setRunStatus(runId, "success", {
            finished_at: new Date().toISOString(),
            result: summary,
          });
        }

        log.info({ terrains: results.length }, "AI anomaly detection complete");
        return { ok: true };
      }

      // default mock for other ai jobs
      await new Promise((r) => setTimeout(r, 1200));

      const result = { queue: "ai", name: job.name, payload };
      await insertJobResult(runId, job.name, result);

      await setRunStatus(runId, "success", {
        finished_at: new Date().toISOString(),
        result,
      });

      return { ok: true };
    } catch (e) {
      await setRunStatus(runId, "failed", {
        finished_at: new Date().toISOString(),
        error: e.message,
      });
      throw e;
    }
  },
  { connection }
);

log.info("worker listening: ai");