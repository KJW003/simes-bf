-- 010_energy_total_delta.sql
-- Add energy_total_delta column to aggregation tables.
-- energy_total is the reference metric (not energy_import/export).

ALTER TABLE acrel_agg_15m
  ADD COLUMN IF NOT EXISTS energy_total_delta DOUBLE PRECISION;

ALTER TABLE acrel_agg_daily
  ADD COLUMN IF NOT EXISTS energy_total_delta DOUBLE PRECISION;

-- Backfill from existing data: energy_total_delta ≈ energy_import_delta if no prior data
UPDATE acrel_agg_15m SET energy_total_delta = energy_import_delta WHERE energy_total_delta IS NULL;
UPDATE acrel_agg_daily SET energy_total_delta = energy_import_delta WHERE energy_total_delta IS NULL;

-- Prediction storage table for forecast vs actual comparison
CREATE TABLE IF NOT EXISTS ml_predictions (
  id BIGSERIAL PRIMARY KEY,
  terrain_id UUID NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'lightgbm',
  predicted_day DATE NOT NULL,
  predicted_kwh DOUBLE PRECISION NOT NULL,
  lower_bound DOUBLE PRECISION,
  upper_bound DOUBLE PRECISION,
  actual_kwh DOUBLE PRECISION,           -- filled later by comparison job
  error_pct DOUBLE PRECISION,            -- filled later: abs(pred - actual) / actual * 100
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (terrain_id, predicted_day, model_type)
);

CREATE INDEX IF NOT EXISTS ml_predictions_terrain_day ON ml_predictions (terrain_id, predicted_day DESC);
