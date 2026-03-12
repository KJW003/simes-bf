-- 015a_telemetry_billing_v2_agg_columns.sql
-- Add reactive energy delta + power factor avg to aggregation tables
-- (Split from 015_billing_v2_columns.sql for correct DB targeting)

ALTER TABLE acrel_agg_15m
  ADD COLUMN IF NOT EXISTS reactive_energy_import_delta DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_avg DOUBLE PRECISION;

ALTER TABLE acrel_agg_daily
  ADD COLUMN IF NOT EXISTS reactive_energy_import_delta DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_avg DOUBLE PRECISION;
