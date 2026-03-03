-- 002_telemetry_acrel_agg.sql
-- Agrégations SIMES V1 : 15min + daily (idempotent)

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

SELECT create_hypertable('acrel_agg_15m', 'bucket_start', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS acrel_agg_15m_site_time_idx ON acrel_agg_15m (site_id, bucket_start DESC);
CREATE INDEX IF NOT EXISTS acrel_agg_daily_site_day_idx ON acrel_agg_daily (site_id, day DESC);