const { Worker } = require("bullmq");
const { connection, db, telemetryDb, setRunStatus, insertJobResult } = require("./shared");
const log = require("./config/logger");
const { auditLog } = require("./audit-log");

if (!connection) {
  log.warn("ai-worker skipped – no Redis connection");
  return;
}

// Helper: Get number of days in a month
function getDaysInMonth(year, month) {
  if (month === 2) {
    // February: check for leap year
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
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

  // ─── Determine billing period ──────────────────────────────
  // NEW: Support month-based, today-only, and adhoc periods
  
  let from, to, billingMode = 'adhoc';
  
  // Special case: mode="today" means just today's consumption
  if (payload.mode === 'today') {
    const today = new Date();
    billingMode = 'today';
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0));
    
  } else if (payload.year && typeof payload.month === 'number') {
    // Month-based billing (default for historical invoices)
    const year = Number(payload.year);
    const month = Number(payload.month);
    
    if (month < 1 || month > 12) throw new Error("Month must be 1-12");
    
    billingMode = 'month';
    from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));  // 1st of month, 00:00 UTC
    
    // To = 1st of NEXT month (so this month's data is [from, to))
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    to = new Date(Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0, 0));
    
  } else if (payload.from || payload.to) {
    // Ad-hoc period (backward compatibility)
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    from = payload.from && isIso(payload.from) ? new Date(payload.from) : defaultFrom;
    to = payload.to && isIso(payload.to) ? new Date(payload.to) : now;
    billingMode = 'adhoc';
    
  } else {
    // Default: last 30 days (for backward compatibility)
    const now = new Date();
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    to = now;
  }

  log.info({
    terrainId,
    billingMode,
    from: from.toISOString(),
    to: to.toISOString(),
    year: payload.year,
    month: payload.month,
  }, `Computing facture: ${billingMode} period`);

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

  // 3a) Ensure 15m + daily aggregations are up-to-date for the billing period
  log.info({ terrainId, from: from.toISOString(), to: to.toISOString() }, "Pre-aggregating data for facture period");
  const aggParams = [from.toISOString(), to.toISOString(), terrainId];

  await telemetryDb.query(`
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
    WHERE time >= $1 AND time < $2 AND terrain_id = $3
    GROUP BY bucket_start, org_id, site_id, terrain_id, point_id
    ON CONFLICT (point_id, bucket_start)
    DO UPDATE SET
      samples_count = EXCLUDED.samples_count,
      active_power_avg = EXCLUDED.active_power_avg,
      active_power_max = EXCLUDED.active_power_max,
      voltage_a_avg = EXCLUDED.voltage_a_avg,
      energy_import_delta = EXCLUDED.energy_import_delta,
      energy_export_delta = EXCLUDED.energy_export_delta,
      energy_total_delta = EXCLUDED.energy_total_delta,
      reactive_energy_import_delta = EXCLUDED.reactive_energy_import_delta,
      power_factor_avg = EXCLUDED.power_factor_avg
  `, aggParams);

  await telemetryDb.query(`
    INSERT INTO acrel_agg_daily (
      day, org_id, site_id, terrain_id, point_id,
      samples_count,
      active_power_avg, active_power_max,
      energy_import_delta, energy_export_delta, energy_total_delta,
      reactive_energy_import_delta, power_factor_avg
    )
    SELECT
      (time_bucket('1 day', time))::date AS day,
      org_id, site_id, terrain_id, point_id,
      COUNT(*)::int AS samples_count,
      AVG(active_power_total) AS active_power_avg,
      MAX(active_power_total) AS active_power_max,
      (MAX(energy_import) - MIN(energy_import)) AS energy_import_delta,
      (MAX(energy_export) - MIN(energy_export)) AS energy_export_delta,
      (MAX(energy_total) - MIN(energy_total)) AS energy_total_delta,
      (MAX(reactive_energy_import) - MIN(reactive_energy_import)) AS reactive_energy_import_delta,
      AVG(power_factor_total) AS power_factor_avg
    FROM acrel_readings
    WHERE time >= $1 AND time < $2 AND terrain_id = $3
    GROUP BY day, org_id, site_id, terrain_id, point_id
    ON CONFLICT (point_id, day)
    DO UPDATE SET
      samples_count = EXCLUDED.samples_count,
      active_power_avg = EXCLUDED.active_power_avg,
      active_power_max = EXCLUDED.active_power_max,
      energy_import_delta = EXCLUDED.energy_import_delta,
      energy_export_delta = EXCLUDED.energy_export_delta,
      energy_total_delta = EXCLUDED.energy_total_delta,
      reactive_energy_import_delta = EXCLUDED.reactive_energy_import_delta,
      power_factor_avg = EXCLUDED.power_factor_avg
  `, aggParams);

  log.info("Pre-aggregation complete for facture period");

  // 3b) Get billing point IDs (avoids double-counting hierarchical sub-points)
  const billingPts = await db.query(
    `SELECT id FROM measurement_points WHERE terrain_id = $1 AND status = 'active' AND is_billing = true`,
    [terrainId]
  );
  const billingIds = billingPts.rows.map(r => r.id);

  if (billingIds.length === 0) {
    throw new Error("No billing measurement points found for terrain");
  }

  // 3c) fetch 15m aggs for billing points within window
  const rows = await telemetryDb.query(
    `SELECT bucket_start, point_id, samples_count,
            active_power_max,
            COALESCE(energy_total_delta, energy_import_delta, 0) AS energy_delta,
            COALESCE(reactive_energy_import_delta, 0) AS reactive_delta,
            COALESCE(power_factor_avg, 1) AS power_factor_avg
     FROM acrel_agg_15m
     WHERE terrain_id = $1 AND bucket_start >= $2 AND bucket_start < $3
       AND point_id = ANY($4)
     ORDER BY bucket_start ASC`,
    [terrainId, from.toISOString(), to.toISOString(), billingIds]
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

  // K1 = Consommation Heure Pleine (kWh), K2 = Consommation Heure Pointe (kWh)
  // Wa = K1 + K2
  const K1 = hpKwh;   // HPL
  const K2 = hptKwh;  // HPT

  // Ma_HPL = Ma × (K1 / Wa), Ma_HPT = Ma × (K2 / Wa)
  const Ma_HPL = Wa > 0 ? Ma * (K1 / Wa) : 0;
  const Ma_HPT = Wa > 0 ? Ma * (K2 / Wa) : 0;

  // Conso_HPL = K1 + Ma_HPL, Conso_HPT = K2 + Ma_HPT
  const billedHpKwh = K1 + Ma_HPL;
  const billedHptKwh = K2 + Ma_HPT;

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
  // Si cosφ > 0.93 → Kma = 1 (pas de pénalité)
  // Si cosφ ≤ 0.93 → Kma = 1 + (P - 0.75) / 3
  const Kma = cosPhi > 0.93 ? 1 : Math.max(1, 1 + (tanPhi - 0.75) / 3);

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

  // Prime fixe (PF) = (PS × Tarif_PF × Kma) / 12
  // prime_per_kw = tarif_PF annuel, diviser par 12 pour mensualiser
  
  // For month-based billing: always use months = 1 (full monthly charge)
  // For today-only: prorate to 1/30 of monthly charge
  // For adhoc billing: prorate based on actual period length
  let months = 1;
  if (billingMode === 'today') {
    months = periodHours / (24 * 30) || 1;  // 1 day / 30 days = ~1/30
  } else if (billingMode === 'adhoc') {
    months = periodHours / (30 * 24) || 1;  // Prorate for adhoc periods
  }
  
  const demandAmount = (subscribedPowerKw * primePerKw * Kma / 12) * months;

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
    { key: "K1", label: "K1 — Conso. Heure Pleine (HPL)", kwh: K1, rate: rateHp, amount: null },
    { key: "K2", label: "K2 — Conso. Heure Pointe (HPT)", kwh: K2, rate: rateHpt, amount: null },
    { key: "WA", label: "Wa — Total active energy", kwh: Wa, rate: null, amount: null, detail: "K1 + K2" },
    { key: "WR", label: "Wr — Total reactive energy", kwh: Wr, rate: null, amount: null },
    { key: "MA", label: "Ma — Pertes actives (αa×Wa + βa×h)", kwh: Ma, rate: null, amount: null, detail: `αa=${alphaA}, βa=${betaA}, h=${periodHours.toFixed(0)}` },
    { key: "MR", label: "Mr — Pertes réactives (αr×Wr + βr×h)", kwh: Mr, rate: null, amount: null, detail: `αr=${alphaR}, βr=${betaR}, h=${periodHours.toFixed(0)}` },
    { key: "MA_HPL", label: "Ma attribué HPL (Ma × K1/Wa)", kwh: Ma_HPL, rate: rateHp, amount: Ma_HPL * rateHp },
    { key: "MA_HPT", label: "Ma attribué HPT (Ma × K2/Wa)", kwh: Ma_HPT, rate: rateHpt, amount: Ma_HPT * rateHpt },
    { key: "CONSO_HPL", label: "Conso. facturée HPL (K1+Ma_HPL)", kwh: billedHpKwh, rate: rateHp, amount: energyHpAmount },
    { key: "CONSO_HPT", label: "Conso. facturée HPT (K2+Ma_HPT)", kwh: billedHptKwh, rate: rateHpt, amount: energyHptAmount },
    { key: "CR", label: "Cr — Total reactive (Wr + Mr)", kwh: Cr, rate: null, amount: null },
    { key: "ERC", label: "Erc — Reactive compensated (Pc × h)", kwh: Erc, rate: null, amount: null, detail: `Pc=${capacitorPowerKw} kW` },
    { key: "ER", label: "Er — Excess reactive (max(0, Cr-Erc))", kwh: Er, rate: null, amount: null },
    { key: "COSPHI", label: "cos φ (power factor)", kwh: null, rate: cosPhi, amount: null, detail: `tan φ=${tanPhi.toFixed(4)}, Kma=${Kma.toFixed(4)}` },
    { key: "PF", label: "Prime fixe (PS×Tarif_PF×Kma/12)", kwh: null, rate: primePerKw, amount: demandAmount, ps_kw: subscribedPowerKw, kma: Kma },
    { key: "EXCEED", label: "Dépassement puissance (30×ΔP×HPT)", kwh: null, rate: rateHpt, amount: exceedAmount, exceed_kw: exceedKw, pmax_kw: maxDemandKw },
    { key: "FIXED", label: "Prime fixe mensuelle", kwh: null, rate: null, amount: fixedMonthly * months },
    { key: "FEES", label: "Location compteur / poste / entretien", kwh: null, rate: null, amount: contractFees },
    { key: "TDE_TDSAAE", label: "TDE + TDSAAE", kwh: Wa + Ma, rate: tdeTdsaaeRate, amount: tde_tdsaae },
    { key: "TVA", label: "TVA (18%)", kwh: null, rate: vatRate, amount: vat },
  ];

  return {
    version: "V2",
    terrain_id: terrainId,
    billingMode,  // 'month' or 'adhoc'
    year: payload.year,
    month: payload.month,
    period: { from: from.toISOString(), to: to.toISOString(), hours: periodHours },
    tariffVersionId: tariff.id,
    tariffVersionName: tariff.name,
    plan_code: tariff.plan_code,
    // Energy (spec naming)
    totalKwh: Wa,
    K1: K1,        // HPL kWh
    K2: K2,        // HPT kWh
    Wa,            // Total active energy (K1 + K2)
    Wr,            // Total reactive energy
    peakKwh: K2,
    offPeakKwh: K1,
    reactiveKwh: Wr,
    // Active losses
    activeLosses_Ma: Ma,
    Ma_HPL,
    Ma_HPT,
    billedHpKwh,
    billedHptKwh,
    // Reactive losses
    reactiveLosses_Mr: Mr,
    Cr,            // Total reactive consumption (Wr + Mr)
    Erc,           // Reactive compensated by capacitor
    Er,            // Excess reactive energy
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
    // Loss coefficients
    alphaA,
    betaA,
    alphaR,
    betaR,
    // Financials
    breakdown,
    totalAmount,
    beforeVat,
    vat,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SOLAR SCENARIO — 4 dimensioning methods
// ═══════════════════════════════════════════════════════════════

async function computeSolarScenario(payload) {
  const { terrain_id, scenario_id, method, params } = payload;
  if (!terrain_id) throw new Error("terrain_id is required");
  if (!scenario_id) throw new Error("scenario_id is required");

  // Mark as computing
  await db.query(
    `UPDATE solar_scenarios SET status = 'computing', updated_at = now() WHERE id = $1`,
    [scenario_id]
  );

  // Fetch last 24h of readings for load curve
  const now = new Date();
  const from24h = new Date(now.getTime() - 24 * 3600_000);

  const readingsRes = await telemetryDb.query(
    `SELECT time, point_id, active_power_total, energy_total, energy_import, power_factor_total
     FROM acrel_readings
     WHERE terrain_id = $1 AND time >= $2 AND time < $3
     ORDER BY time ASC`,
    [terrain_id, from24h.toISOString(), now.toISOString()]
  );

  // Aggregate power per timestep (sum all points)
  const powerByTime = new Map();
  for (const r of readingsRes.rows) {
    const t = new Date(r.time).toISOString();
    const p = Number(r.active_power_total || 0);
    powerByTime.set(t, (powerByTime.get(t) || 0) + p);
  }
  const powerTimeSeries = [...powerByTime.values()]; // kW values
  const dt = 15 / 60; // 0.25h (15min intervals)

  // Energy delta from readings (same as audit)
  const energyByPoint = new Map();
  for (const r of readingsRes.rows) {
    const val = r.energy_total != null ? Number(r.energy_total) : r.energy_import != null ? Number(r.energy_import) : NaN;
    if (isNaN(val)) continue;
    const pid = String(r.point_id);
    const entry = energyByPoint.get(pid);
    if (!entry) energyByPoint.set(pid, { min: val, max: val });
    else { entry.min = Math.min(entry.min, val); entry.max = Math.max(entry.max, val); }
  }
  let measuredEnergyKwh = 0;
  for (const { min, max } of energyByPoint.values()) measuredEnergyKwh += Math.max(0, max - min);

  // Fallback: compute E_jour from power integration if energy delta is too small
  const E_jour_integrated = powerTimeSeries.reduce((s, p) => s + p * dt, 0);
  const E_jour = measuredEnergyKwh > 0 ? measuredEnergyKwh : E_jour_integrated;

  // PF average
  const pfValues = readingsRes.rows.map(r => r.power_factor_total).filter(v => v != null).map(Number);
  const cos_phi_measured = pfValues.length ? pfValues.reduce((s, v) => s + v, 0) / pfValues.length : 0.90;

  const P_max = powerTimeSeries.length ? Math.max(...powerTimeSeries) : 0;
  const P_moy = E_jour / 24;

  let results = {};
  let financial = {};

  // ── Method: Average Load ──────────────────────────────────────
  if (method === "average_load") {
    const { hsp, eta_sys, k_sec, p_module, autonomy_days, battery_capacity_ah, system_voltage,
            lever_soleil, coucher_soleil, rendement_onduleur, profondeur_decharge } = params;

    const E_PV = E_jour / eta_sys;
    const P_PV = E_PV / hsp;
    const P_PV_final = P_PV * k_sec;
    const N_modules = Math.ceil((P_PV_final * 1000) / p_module);
    const puissance_crete_Wc = N_modules * p_module;

    // Battery sizing
    const energie_necessaire_Wh = (E_jour * 1000) / rendement_onduleur;
    const capacite_batterie_Wh = (energie_necessaire_Wh * autonomy_days) / profondeur_decharge;
    const capacite_batterie_Ah = capacite_batterie_Wh / system_voltage;
    const nb_batteries = Math.ceil(capacite_batterie_Ah / battery_capacity_ah);

    // Inverter sizing
    const puissance_onduleur_W = P_max * 1000 * 1.25;
    const courant_mppt_A = (puissance_crete_Wc / system_voltage) * 1.25;

    // Production simulation (sinusoidal irradiance model)
    const duree_jour = coucher_soleil - lever_soleil;
    const IRRADIANCE_MAX = 1000;
    const TEMP_COEFF = -0.004;
    const TEMP_AMBIANTE = 35;
    const TEMP_NOCT = 45;

    const productionProfile = [];
    const socProfile = [];
    const capacite_totale_Wh = nb_batteries * battery_capacity_ah * system_voltage;
    let soc = capacite_totale_Wh * 0.5;
    const soc_min = capacite_totale_Wh * (1 - profondeur_decharge);
    let prodTotalWh = 0;
    let surplusWh = 0;
    let deficitWh = 0;

    for (let h = 0; h < 24; h += 0.25) {
      const irradiance = (h >= lever_soleil && h <= coucher_soleil)
        ? IRRADIANCE_MAX * Math.sin(Math.PI * (h - lever_soleil) / duree_jour)
        : 0;
      const temp_cellule = TEMP_AMBIANTE + (TEMP_NOCT - 20) * (irradiance / 800);
      const facteur_temp = 1 + TEMP_COEFF * (temp_cellule - 25);
      const production_W = Math.max(puissance_crete_Wc * (irradiance / IRRADIANCE_MAX) * facteur_temp * eta_sys, 0);

      // Approximate consumption at this hour from average
      const idx = Math.floor(h / 0.25);
      const conso_W = idx < powerTimeSeries.length ? powerTimeSeries[idx] * 1000 : P_moy * 1000;
      const bilan_W = production_W - conso_W;
      const energie_pas = bilan_W * 0.25;

      if (energie_pas > 0) {
        soc = Math.min(soc + energie_pas * eta_sys, capacite_totale_Wh);
        surplusWh += energie_pas;
      } else {
        soc = Math.max(soc + energie_pas, soc_min);
        deficitWh += Math.abs(energie_pas);
      }

      prodTotalWh += production_W * 0.25;
      productionProfile.push({ hour: h, production_w: Math.round(production_W), consumption_w: Math.round(conso_W), irradiance: Math.round(irradiance) });
      socProfile.push({ hour: h, soc_pct: Math.round((soc / capacite_totale_Wh) * 100) });
    }

    const taux_couverture = E_jour > 0 ? Math.min((prodTotalWh / 1000) / E_jour * 100, 100) : 0;

    results = {
      e_jour_kwh: round2(E_jour),
      e_pv_kwh: round2(E_PV),
      p_pv_kwc: round2(P_PV),
      p_pv_final_kwc: round2(P_PV_final),
      n_modules: N_modules,
      puissance_crete_kwc: round2(puissance_crete_Wc / 1000),
      nb_batteries,
      battery_capacity_wh: Math.round(capacite_totale_Wh),
      battery_capacity_ah: Math.round(capacite_batterie_Ah),
      inverter_w: Math.round(puissance_onduleur_W),
      mppt_current_a: Math.round(courant_mppt_A),
      production_total_kwh: round2(prodTotalWh / 1000),
      coverage_pct: round2(taux_couverture),
      surplus_kwh: round2(surplusWh / 1000),
      deficit_kwh: round2(deficitWh / 1000),
      soc_end_pct: socProfile.length ? socProfile[socProfile.length - 1].soc_pct : 0,
      production_profile: productionProfile,
      soc_profile: socProfile,
    };
  }

  // ── Method: Peak Demand ───────────────────────────────────────
  if (method === "peak_demand") {
    const { hsp, eta_sys, k_sec, p_module, cos_phi, k_ond } = params;

    const FC = P_max > 0 ? P_moy / P_max : 0;
    const P_ond = k_ond * P_max;
    const S_ond = cos_phi > 0 ? P_ond / cos_phi : P_ond;
    const P_surge = 2 * P_ond;

    const P_PV_pic = (E_jour / eta_sys / hsp) * k_sec;
    const N_modules = Math.ceil((P_PV_pic * 1000) / p_module);
    const puissance_crete_Wc = N_modules * p_module;

    const ratio_ond_pv = P_PV_pic > 0 ? P_ond / P_PV_pic : 0;
    const inverter_clipping_ok = ratio_ond_pv >= 0.80;

    results = {
      e_jour_kwh: round2(E_jour),
      p_max_kw: round2(P_max),
      p_moy_kw: round2(P_moy),
      load_factor: round2(FC),
      p_ond_kw: round2(P_ond),
      s_ond_kva: round2(S_ond),
      p_surge_kw: round2(P_surge),
      p_pv_pic_kwc: round2(P_PV_pic),
      n_modules: N_modules,
      puissance_crete_kwc: round2(puissance_crete_Wc / 1000),
      ratio_ond_pv: round2(ratio_ond_pv),
      inverter_clipping_ok,
      cos_phi_measured: round2(cos_phi_measured),
    };
  }

  // ── Method: Theoretical Production ────────────────────────────
  if (method === "theoretical_production") {
    const { gj, t_lever, t_coucher, pr, eta_mod, eta_inv, gamma_t, t_amb, t_noct } = params;
    const p_inst = params.p_inst || (results.puissance_crete_kwc || 10); // kWc

    const t_midi = (t_lever + t_coucher) / 2;
    const sigma = (t_coucher - t_lever) / 6;
    const G_STC = 1.0; // kW/m²

    // G_max normalized so integral of G(t) = Gj
    const G_max = gj / (sigma * Math.sqrt(2 * Math.PI));

    const eta_tot = eta_mod * eta_inv;
    const productionProfile = [];
    let E_th_integral = 0;
    let P_prod_max = 0;

    for (let h = 0; h < 24; h += 0.25) {
      const G_t = (h >= t_lever && h <= t_coucher)
        ? G_max * Math.exp(-Math.pow(h - t_midi, 2) / (2 * sigma * sigma))
        : 0;

      const T_cell = t_amb + (t_noct - 20) * (G_t / 0.8);
      const f_T = 1 + gamma_t * (T_cell - 25);
      const P_prod = Math.max(p_inst * (G_t / G_STC) * eta_tot * f_T, 0);

      E_th_integral += G_t * 0.25;
      if (P_prod > P_prod_max) P_prod_max = P_prod;

      productionProfile.push({
        hour: h,
        irradiance_kw_m2: round4(G_t),
        temp_cell: round2(T_cell),
        f_temp: round4(f_T),
        production_kw: round2(P_prod),
      });
    }

    const E_th = p_inst * E_th_integral;
    const E_reelle = E_th * pr;
    const HSP_calc = E_th_integral;

    results = {
      p_inst_kwc: round2(p_inst),
      e_th_kwh: round2(E_th),
      e_reelle_kwh: round2(E_reelle),
      p_prod_max_kw: round2(P_prod_max),
      t_pic_h: round2(t_midi),
      hsp_calc: round2(HSP_calc),
      production_profile: productionProfile,
    };
  }

  // ── Method: Available Surface ─────────────────────────────────
  if (method === "available_surface") {
    const { s_tot, k_occ, s_mod, p_module, hsp, pr } = params;
    const e_demand = params.e_demand || E_jour;

    const S_utile = s_tot * k_occ;
    const N_mod_max = Math.floor(S_utile / s_mod);
    const P_inst_max = (N_mod_max * p_module) / 1000;
    const E_prod = P_inst_max * hsp * pr;
    const TC = e_demand > 0 ? (E_prod / e_demand) * 100 : 0;
    const Delta_E = E_prod - e_demand;

    results = {
      s_utile_m2: round2(S_utile),
      n_mod_max: N_mod_max,
      p_inst_max_kwc: round2(P_inst_max),
      e_prod_kwh: round2(E_prod),
      e_demand_kwh: round2(e_demand),
      coverage_pct: round2(TC),
      delta_e_kwh: round2(Delta_E),
    };
  }

  // ── Financial estimates (common to all methods) ───────────────
  const pvKwc = results.puissance_crete_kwc || results.p_pv_final_kwc || results.p_inst_max_kwc || results.p_inst_kwc || 0;
  const annualProdKwh = (results.e_reelle_kwh || results.production_total_kwh || results.e_prod_kwh || E_jour) * 365;
  const installCostPerKwc = params.install_cost_per_kwc || 750000; // XOF
  const electricityRate = params.electricity_rate || 110; // XOF/kWh
  const degradation = params.panel_degradation_pct || 0.5;

  if (pvKwc > 0) {
    const installCost = pvKwc * installCostPerKwc;
    const annualSavings = annualProdKwh * electricityRate;
    const paybackYears = annualSavings > 0 ? installCost / annualSavings : Infinity;

    // 25-year NPV (discount rate 8%)
    const discountRate = params.discount_rate || 0.08;
    let npv = -installCost;
    let totalSavings25y = 0;
    for (let y = 1; y <= 25; y++) {
      const yearProd = annualSavings * Math.pow(1 - degradation / 100, y);
      npv += yearProd / Math.pow(1 + discountRate, y);
      totalSavings25y += yearProd;
    }

    const roi25y = installCost > 0 ? ((totalSavings25y - installCost) / installCost) * 100 : 0;
    const co2Factor = 0.5; // kg CO2 per kWh (grid average for Burkina Faso)
    const co2AvoidedKg = annualProdKwh * co2Factor;

    financial = {
      install_cost_xof: Math.round(installCost),
      annual_production_kwh: Math.round(annualProdKwh),
      annual_savings_xof: Math.round(annualSavings),
      payback_years: round2(paybackYears),
      roi_25y_pct: round2(roi25y),
      npv_xof: Math.round(npv),
      co2_avoided_kg_year: Math.round(co2AvoidedKg),
    };
  }

  // ── Persist results ───────────────────────────────────────────
  await db.query(
    `UPDATE solar_scenarios
     SET results = $2::jsonb,
         financial = $3::jsonb,
         status = 'ready',
         computed_at = now(),
         updated_at = now(),
         error = NULL
     WHERE id = $1`,
    [scenario_id, JSON.stringify(results), JSON.stringify(financial)]
  );

  return {
    scenario_id,
    terrain_id,
    method,
    results,
    financial,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

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
        if (!resp.ok) {
          throw new Error(`ML train-all failed (${resp.status}): ${result?.detail || result?.error || JSON.stringify(result)}`);
        }

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
            if (!resp.ok) {
              throw new Error(`ML anomalies/detect failed (${resp.status}): ${r?.detail || r?.error || JSON.stringify(r)}`);
            }
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

      if (job.name === "ai.update_monthly_invoices") {
        // Daily job: Update all terrains' current-month invoices with data through yesterday
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;  // 1-12

        // Get all terrains with active contracts
        const terrains = await db.query(`
          SELECT DISTINCT t.id
          FROM terrains t
          JOIN terrain_contracts tc ON t.id = tc.terrain_id
        `);

        const updateResults = [];
        let successCount = 0;
        let failureCount = 0;

        log.info({ terrainCount: terrains.rows.length, year: currentYear, month: currentMonth }, 
          "Starting monthly invoice update for all terrains");

        for (const { id: terrainId } of terrains.rows) {
          try {
            // Compute this month's invoice
            const facture = await computeFacture({
              terrain_id: terrainId,
              year: currentYear,
              month: currentMonth,
            });

            // Upsert into facture_monthly
            const updateResult = await db.query(`
              INSERT INTO facture_monthly (terrain_id, year, month, data, status, updated_at, computed_at)
              VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
              ON CONFLICT (terrain_id, year, month)
              DO UPDATE SET
                data = $4,
                updated_at = NOW()
              RETURNING id
            `, [terrainId, currentYear, currentMonth, JSON.stringify(facture), 'draft']);

            // Log the daily update
            await db.query(`
              INSERT INTO facture_daily_updates (
                terrain_id, year, month, update_date,
                data_from, data_to,
                consumption_added_kwh,
                triggered_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (terrain_id, year, month, update_date) DO NOTHING
            `, [
              terrainId,
              currentYear,
              currentMonth,
              new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()).toISOString().split('T')[0],
              new Date(Date.UTC(currentYear, currentMonth - 1, 1)).toISOString(),
              new Date(Date.UTC(currentYear, currentMonth % 12, (currentMonth % 12) === 0 ? 0 : 1)).toISOString(),
              facture.totalKwh,
              'scheduler',
            ]);

            updateResults.push({ terrainId, status: 'success', totalAmount: facture.totalAmount });
            successCount++;

          } catch (err) {
            log.warn({ terrainId, error: err.message, year: currentYear, month: currentMonth },
              "Failed to update monthly invoice for terrain");
            updateResults.push({ terrainId, status: 'error', error: err.message });
            failureCount++;
          }
        }

        const summary = {
          year: currentYear,
          month: currentMonth,
          total: terrains.rows.length,
          successCount,
          failureCount,
          updates: updateResults,
          timestamp: now.toISOString(),
        };

        if (runId) {
          await insertJobResult(runId, job.name, summary);
          await setRunStatus(runId, "success", {
            finished_at: new Date().toISOString(),
            result: summary,
          });
        }

        log.info(summary, "Monthly invoice update complete");
        return { ok: true, ...summary };
      }

      if (job.name === "solar_scenario") {
        const result = await computeSolarScenario(payload);
        await insertJobResult(runId, job.name, result);
        await setRunStatus(runId, "success", {
          finished_at: new Date().toISOString(),
          result,
        });
        log.info({ scenario_id: payload.scenario_id, method: payload.method }, "Solar scenario computed");
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
      // Mark solar scenario as failed if applicable
      if (payload?.scenario_id) {
        try {
          await db.query(
            `UPDATE solar_scenarios SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
            [payload.scenario_id, e.message]
          );
        } catch (dbErr) {
          log.error({ err: dbErr.message }, "Failed to mark solar scenario as failed");
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

log.info("worker listening: ai");