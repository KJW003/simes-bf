-- 015_billing_v2_columns.sql
-- Add columns needed for SONABEL billing V2:
-- 1. Reactive energy delta + power factor avg in aggregation tables
-- 2. Loss coefficients in tariff_plans
-- 3. Capacitor power in terrain_contracts

-- ── acrel_agg_15m: reactive energy + power factor ──
ALTER TABLE acrel_agg_15m
  ADD COLUMN IF NOT EXISTS reactive_energy_import_delta DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_avg DOUBLE PRECISION;

ALTER TABLE acrel_agg_daily
  ADD COLUMN IF NOT EXISTS reactive_energy_import_delta DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_avg DOUBLE PRECISION;

-- ── tariff_plans: loss coefficients for SONABEL billing ──
-- αa, βa = active loss coefficients
-- αr, βr = reactive loss coefficients
ALTER TABLE tariff_plans
  ADD COLUMN IF NOT EXISTS alpha_a DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beta_a  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alpha_r DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beta_r  DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ── terrain_contracts: capacitor battery power (Pc) ──
ALTER TABLE terrain_contracts
  ADD COLUMN IF NOT EXISTS capacitor_power_kw DOUBLE PRECISION NOT NULL DEFAULT 0;
