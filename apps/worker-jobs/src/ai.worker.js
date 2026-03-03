const { Worker } = require("bullmq");
const { connection, db, telemetryDb, setRunStatus, insertJobResult } = require("./shared");

if (!connection) {
  console.warn("[ai-worker] Skipped – no Redis connection.");
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
  const terrainId = payload.terrain_id;
  if (!terrainId) throw new Error("terrain_id is required");

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = payload.from && isIso(payload.from) ? new Date(payload.from) : defaultFrom;
  const to = payload.to && isIso(payload.to) ? new Date(payload.to) : now;

  // 1) contrat terrain -> PS + tariff_plan_id
  const c = await db.query(
    `SELECT terrain_id, tariff_plan_id, subscribed_power_kw, meter_rental, post_rental, maintenance
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

  // 2) tariff plan
  const t = await db.query(
    `SELECT id, group_code, plan_code, name,
            hp_start_min, hp_end_min, hpt_start_min, hpt_end_min,
            rate_hp, rate_hpt, fixed_monthly, prime_per_kw,
            vat_rate, tde_tdsaae_rate
     FROM tariff_plans
     WHERE id = $1`,
    [contract.tariff_plan_id]
  );
  if (!t.rows.length) throw new Error("tariff_plan_id in contract not found");
  const tariff = t.rows[0];

  // 3) fetch 15m aggs for terrain within window (we need per-bucket time)
  const rows = await telemetryDb.query(
    `SELECT bucket_start, point_id, samples_count,
            active_power_max,
            COALESCE(energy_import_delta, 0) AS energy_import_delta
     FROM acrel_agg_15m
     WHERE terrain_id = $1 AND bucket_start >= $2 AND bucket_start < $3
     ORDER BY bucket_start ASC`,
    [terrainId, from.toISOString(), to.toISOString()]
  );

  // 4) classification HP vs HPT by time-of-day (UTC for now)
  let hpKwh = 0;
  let hptKwh = 0;
  let totalKwh = 0;

  let maxDemandKw = 0;

  for (const r of rows.rows) {
    const bucketStart = r.bucket_start;
    const bucketIso = new Date(bucketStart).toISOString();
    const minOfDay = minOfDayFromTs(bucketIso);

    const kwh = Number(r.energy_import_delta || 0);
    totalKwh += kwh;

    if (minOfDay >= tariff.hp_start_min && minOfDay < tariff.hp_end_min) hpKwh += kwh;
    else if (minOfDay >= tariff.hpt_start_min && minOfDay < tariff.hpt_end_min) hptKwh += kwh;
    else {
      // fallback: si plages bizarres, on met en HP
      hpKwh += kwh;
    }

    const pmax = Number(r.active_power_max || 0);
    if (pmax > maxDemandKw) maxDemandKw = pmax;
  }

  // 5) coûts (V1: Kma=1, taxes simples)
  const rateHp = Number(tariff.rate_hp);
  const rateHpt = Number(tariff.rate_hpt);

  const fixedMonthly = Number(tariff.fixed_monthly);
  const primePerKw = Number(tariff.prime_per_kw);

  const vatRate = Number(tariff.vat_rate ?? 0.18);

  const energyHpAmount = hpKwh * rateHp;
  const energyHptAmount = hptKwh * rateHpt;

  const energyAmount = energyHpAmount + energyHptAmount;

  // Prime puissance (PS)
  const demandAmount = subscribedPowerKw * primePerKw;

  // Dépassement (règle doc: 30 * (Pmax-PS) * tarifHPT)
  const exceedKw = Math.max(maxDemandKw - subscribedPowerKw, 0);
  const exceedAmount = 30 * exceedKw * rateHpt;

  // Frais fixes contrat (location/maintenance)
  const contractFees = Number(contract.meter_rental || 0) + Number(contract.post_rental || 0) + Number(contract.maintenance || 0);

  // Total HT (V1)
  const subtotal = energyAmount + fixedMonthly + demandAmount + exceedAmount + contractFees;

  // TDE+TDSAAE et TVA (V1 simplifié)
  // Ton doc: TDE+TDSAAE = 2 x (Wa + Ma). On n'a pas Ma en V1 => 0.
  const tde_tdsaae = 2 * totalKwh;

  const beforeVat = subtotal + tde_tdsaae;
  const vat = beforeVat * vatRate;

  const totalAmount = beforeVat + vat;

  const breakdown = [
    { key: "HP", label: "Heures pleines", kwh: hpKwh, rate: rateHp, amount: energyHpAmount },
    { key: "HPT", label: "Heures de pointe", kwh: hptKwh, rate: rateHpt, amount: energyHptAmount },
    { key: "FIXED", label: "Prime fixe mensuelle", kwh: null, rate: null, amount: fixedMonthly },
    { key: "DEMAND", label: "Prime de puissance (PS)", kwh: null, rate: primePerKw, amount: demandAmount, ps_kw: subscribedPowerKw },
    { key: "EXCEED", label: "Dépassement puissance", kwh: null, rate: rateHpt, amount: exceedAmount, exceed_kw: exceedKw, pmax_kw: maxDemandKw },
    { key: "FEES", label: "Frais contrat (location/maintenance)", kwh: null, rate: null, amount: contractFees },
    { key: "TDE_TDSAAE", label: "TDE + TDSAAE (V1)", kwh: totalKwh, rate: null, amount: tde_tdsaae },
    { key: "TVA", label: "TVA", kwh: null, rate: vatRate, amount: vat }
  ];

  return {
    terrain_id: terrainId,
    period: { from: from.toISOString(), to: to.toISOString() },
    tariffVersionId: tariff.id,
    tariffVersionName: tariff.name,
    plan_code: tariff.plan_code,
    totalKwh,
    peakKwh: hptKwh,
    offPeakKwh: 0,      // V1 pas encore
    shoulderKwh: hpKwh, // V1 mapping
    maxDemandKw,
    subscribedPowerKw,
    breakdown,
    totalAmount
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

console.log("worker listening: ai");