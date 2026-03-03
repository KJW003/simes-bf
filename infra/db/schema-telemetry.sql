-- =============================================================
-- SIMES-BF / Telemetry Database – Full schema (idempotent)
-- Target: telemetry-db (TimescaleDB on Postgres 16)
-- =============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─── 1) acrel_readings (raw time-series) ─────────────────────
CREATE TABLE IF NOT EXISTS acrel_readings (
  time TIMESTAMPTZ NOT NULL,

  org_id UUID NOT NULL,
  site_id UUID NOT NULL,
  terrain_id UUID NOT NULL,
  point_id UUID NOT NULL,

  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE acrel_readings
  -- Tensions (V)
  ADD COLUMN IF NOT EXISTS voltage_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_ab DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_bc DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_ca DOUBLE PRECISION,

  -- Courants (A)
  ADD COLUMN IF NOT EXISTS current_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_sum DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS aftercurrent DOUBLE PRECISION,

  -- Puissances actives (kW)
  ADD COLUMN IF NOT EXISTS active_power_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS active_power_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS active_power_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS active_power_total DOUBLE PRECISION,

  -- Puissances réactives (kVar)
  ADD COLUMN IF NOT EXISTS reactive_power_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reactive_power_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reactive_power_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reactive_power_total DOUBLE PRECISION,

  -- Puissances apparentes (kVA)
  ADD COLUMN IF NOT EXISTS apparent_power_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS apparent_power_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS apparent_power_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS apparent_power_total DOUBLE PRECISION,

  -- Facteurs de puissance
  ADD COLUMN IF NOT EXISTS power_factor_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS power_factor_total DOUBLE PRECISION,

  -- Fréquence & déséquilibre
  ADD COLUMN IF NOT EXISTS frequency DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS voltage_unbalance DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_unbalance DOUBLE PRECISION,

  -- Énergies globales
  ADD COLUMN IF NOT EXISTS energy_total DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_import DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_export DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reactive_energy_import DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reactive_energy_export DOUBLE PRECISION,

  -- Énergies par phase
  ADD COLUMN IF NOT EXISTS energy_total_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_import_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_export_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_total_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_import_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_export_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_total_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_import_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_export_c DOUBLE PRECISION,

  -- Tranches tarifaires SONABEL
  ADD COLUMN IF NOT EXISTS energy_spike DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_peak DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_flat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS energy_valley DOUBLE PRECISION,

  -- THD
  ADD COLUMN IF NOT EXISTS thdu_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS thdu_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS thdu_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS thdi_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS thdi_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS thdi_c DOUBLE PRECISION,

  -- Températures
  ADD COLUMN IF NOT EXISTS temp_a DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_b DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_n DOUBLE PRECISION,

  -- DI/DO/Alarm (numeric / bitmask capable)
  ADD COLUMN IF NOT EXISTS di_state BIGINT,
  ADD COLUMN IF NOT EXISTS do1_state BIGINT,
  ADD COLUMN IF NOT EXISTS do2_state BIGINT,
  ADD COLUMN IF NOT EXISTS alarm_state BIGINT,

  -- Signal radio LoRa
  ADD COLUMN IF NOT EXISTS rssi_lora DOUBLE PRECISION,

  -- Métadonnées transmission (gateway)
  ADD COLUMN IF NOT EXISTS rssi_gateway DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS snr_gateway DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS f_cnt BIGINT;

SELECT create_hypertable('acrel_readings', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS acrel_point_time_idx ON acrel_readings (point_id, time DESC);
CREATE INDEX IF NOT EXISTS acrel_site_time_idx ON acrel_readings (site_id, time DESC);
CREATE INDEX IF NOT EXISTS acrel_terrain_time_idx ON acrel_readings (terrain_id, time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_acrel_readings_point_time ON acrel_readings (point_id, time);

-- ─── 2) Aggregation: 15-minute buckets ──────────────────────
CREATE TABLE IF NOT EXISTS acrel_agg_15m (
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

  PRIMARY KEY (point_id, bucket_start)
);

SELECT create_hypertable('acrel_agg_15m', 'bucket_start', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS acrel_agg_15m_site_time_idx ON acrel_agg_15m (site_id, bucket_start DESC);

-- ─── 3) Aggregation: daily buckets ──────────────────────────
CREATE TABLE IF NOT EXISTS acrel_agg_daily (
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

  PRIMARY KEY (point_id, day)
);

CREATE INDEX IF NOT EXISTS acrel_agg_daily_site_day_idx ON acrel_agg_daily (site_id, day DESC);