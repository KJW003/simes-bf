-- =============================================================
-- Migration 014: Trash tables for purge safety
-- Backs up deleted data before purge with 30-day TTL
-- =============================================================

-- ─── Purge batches registry ─────────────────────────────────
CREATE TABLE IF NOT EXISTS purge_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID,                    -- user_id who triggered
  point_ids UUID[] NOT NULL,
  date_from TIMESTAMPTZ,              -- null = no lower bound
  date_to TIMESTAMPTZ,                -- null = no upper bound
  counts JSONB NOT NULL DEFAULT '{}', -- { readings, agg_15m, agg_daily }
  restored_at TIMESTAMPTZ             -- set when data is restored
);

-- ─── Trash: acrel_readings ──────────────────────────────────
CREATE TABLE IF NOT EXISTS acrel_readings_trash (
  purge_batch_id UUID NOT NULL REFERENCES purge_batches(id) ON DELETE CASCADE,
  -- original columns
  time TIMESTAMPTZ NOT NULL,
  org_id UUID NOT NULL,
  site_id UUID NOT NULL,
  terrain_id UUID NOT NULL,
  point_id UUID NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  voltage_a DOUBLE PRECISION,
  voltage_b DOUBLE PRECISION,
  voltage_c DOUBLE PRECISION,
  voltage_ab DOUBLE PRECISION,
  voltage_bc DOUBLE PRECISION,
  voltage_ca DOUBLE PRECISION,
  current_a DOUBLE PRECISION,
  current_b DOUBLE PRECISION,
  current_c DOUBLE PRECISION,
  current_sum DOUBLE PRECISION,
  aftercurrent DOUBLE PRECISION,
  active_power_a DOUBLE PRECISION,
  active_power_b DOUBLE PRECISION,
  active_power_c DOUBLE PRECISION,
  active_power_total DOUBLE PRECISION,
  reactive_power_a DOUBLE PRECISION,
  reactive_power_b DOUBLE PRECISION,
  reactive_power_c DOUBLE PRECISION,
  reactive_power_total DOUBLE PRECISION,
  apparent_power_a DOUBLE PRECISION,
  apparent_power_b DOUBLE PRECISION,
  apparent_power_c DOUBLE PRECISION,
  apparent_power_total DOUBLE PRECISION,
  power_factor_a DOUBLE PRECISION,
  power_factor_b DOUBLE PRECISION,
  power_factor_c DOUBLE PRECISION,
  power_factor_total DOUBLE PRECISION,
  frequency DOUBLE PRECISION,
  voltage_unbalance DOUBLE PRECISION,
  current_unbalance DOUBLE PRECISION,
  energy_total DOUBLE PRECISION,
  energy_import DOUBLE PRECISION,
  energy_export DOUBLE PRECISION,
  reactive_energy_import DOUBLE PRECISION,
  reactive_energy_export DOUBLE PRECISION,
  energy_total_a DOUBLE PRECISION,
  energy_import_a DOUBLE PRECISION,
  energy_export_a DOUBLE PRECISION,
  energy_total_b DOUBLE PRECISION,
  energy_import_b DOUBLE PRECISION,
  energy_export_b DOUBLE PRECISION,
  energy_total_c DOUBLE PRECISION,
  energy_import_c DOUBLE PRECISION,
  energy_export_c DOUBLE PRECISION,
  energy_spike DOUBLE PRECISION,
  energy_peak DOUBLE PRECISION,
  energy_flat DOUBLE PRECISION,
  energy_valley DOUBLE PRECISION,
  thdu_a DOUBLE PRECISION,
  thdu_b DOUBLE PRECISION,
  thdu_c DOUBLE PRECISION,
  thdi_a DOUBLE PRECISION,
  thdi_b DOUBLE PRECISION,
  thdi_c DOUBLE PRECISION,
  temp_a DOUBLE PRECISION,
  temp_b DOUBLE PRECISION,
  temp_c DOUBLE PRECISION,
  temp_n DOUBLE PRECISION,
  di_state BIGINT,
  do1_state BIGINT,
  do2_state BIGINT,
  alarm_state BIGINT,
  rssi_lora DOUBLE PRECISION,
  rssi_gateway DOUBLE PRECISION,
  snr_gateway DOUBLE PRECISION,
  f_cnt BIGINT
);

CREATE INDEX IF NOT EXISTS trash_readings_batch_idx ON acrel_readings_trash (purge_batch_id);

-- ─── Trash: acrel_agg_15m ───────────────────────────────────
CREATE TABLE IF NOT EXISTS acrel_agg_15m_trash (
  purge_batch_id UUID NOT NULL REFERENCES purge_batches(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  org_id UUID NOT NULL,
  site_id UUID NOT NULL,
  terrain_id UUID NOT NULL,
  point_id UUID NOT NULL,
  samples_count INT NOT NULL,
  active_power_avg DOUBLE PRECISION,
  active_power_max DOUBLE PRECISION,
  voltage_a_avg DOUBLE PRECISION,
  energy_import_delta DOUBLE PRECISION,
  energy_export_delta DOUBLE PRECISION,
  energy_total_delta DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS trash_agg15m_batch_idx ON acrel_agg_15m_trash (purge_batch_id);

-- ─── Trash: acrel_agg_daily ─────────────────────────────────
CREATE TABLE IF NOT EXISTS acrel_agg_daily_trash (
  purge_batch_id UUID NOT NULL REFERENCES purge_batches(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  org_id UUID NOT NULL,
  site_id UUID NOT NULL,
  terrain_id UUID NOT NULL,
  point_id UUID NOT NULL,
  samples_count INT NOT NULL,
  active_power_avg DOUBLE PRECISION,
  active_power_max DOUBLE PRECISION,
  energy_import_delta DOUBLE PRECISION,
  energy_export_delta DOUBLE PRECISION,
  energy_total_delta DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS trash_agg_daily_batch_idx ON acrel_agg_daily_trash (purge_batch_id);
