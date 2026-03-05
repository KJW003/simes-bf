-- =============================================================
-- Migration 007: Add CT ratio to measurement_points
-- The Acrel meter reports raw current (I), but when used with
-- a CT (Current Transformer), the actual current = I × CT.
-- All current-derived measurements must be multiplied by CT.
-- =============================================================

ALTER TABLE measurement_points
  ADD COLUMN IF NOT EXISTS ct_ratio DOUBLE PRECISION NOT NULL DEFAULT 1;

COMMENT ON COLUMN measurement_points.ct_ratio
  IS 'Current Transformer ratio. Raw I from Acrel is multiplied by this value. Default 1 = no CT.';

-- Also add FK that was missing on terrain_contracts
ALTER TABLE terrain_contracts
  DROP CONSTRAINT IF EXISTS terrain_contracts_terrain_id_fkey;

ALTER TABLE terrain_contracts
  ADD CONSTRAINT terrain_contracts_terrain_id_fkey
  FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE CASCADE;

-- Add missing indexes for aggregation queries
CREATE INDEX IF NOT EXISTS acrel_agg_15m_terrain_idx ON acrel_agg_15m (terrain_id, bucket_start DESC);
CREATE INDEX IF NOT EXISTS acrel_agg_daily_terrain_idx ON acrel_agg_daily (terrain_id, day DESC);
