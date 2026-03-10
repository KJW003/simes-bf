-- 009_agg_indexes.sql
-- Additional covering indexes for common aggregation queries

-- Terrain-level queries on 15-min aggregates
CREATE INDEX IF NOT EXISTS acrel_agg_15m_terrain_time_idx
  ON acrel_agg_15m (terrain_id, bucket_start DESC);

-- Terrain-level queries on daily aggregates
CREATE INDEX IF NOT EXISTS acrel_agg_daily_terrain_day_idx
  ON acrel_agg_daily (terrain_id, day DESC);

-- Org-level rollups
CREATE INDEX IF NOT EXISTS acrel_agg_daily_org_day_idx
  ON acrel_agg_daily (org_id, day DESC);
