-- Migration: Backfill acrel_agg_daily from acrel_readings
-- Purpose: Fix the daily aggregation table with complete, accurate day-based data
-- This aggregates entire UTC days (00:00 - 23:59) from raw readings

-- Truncate old incomplete data (keeping the schema)
TRUNCATE TABLE acrel_agg_daily;

-- Backfill all historical days from acrel_readings
INSERT INTO acrel_agg_daily (
  day, org_id, site_id, terrain_id, point_id,
  samples_count,
  active_power_avg, active_power_max,
  energy_import_delta, energy_export_delta, energy_total_delta,
  reactive_energy_import_delta, power_factor_avg
)
SELECT
  (DATE_TRUNC('day', time AT TIME ZONE 'UTC'))::date AS day,
  org_id, site_id, terrain_id, point_id,
  COUNT(*)::int AS samples_count,
  AVG(active_power_total) AS active_power_avg,
  MAX(active_power_total) AS active_power_max,
  GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS energy_import_delta,
  GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS energy_export_delta,
  GREATEST(MAX(energy_total) - MIN(energy_total), 0) AS energy_total_delta,
  GREATEST(MAX(reactive_energy_import) - MIN(reactive_energy_import), 0) AS reactive_energy_import_delta,
  AVG(power_factor_total) AS power_factor_avg
FROM acrel_readings
WHERE time >= (CURRENT_DATE - INTERVAL '365 days')  -- Last year of data
GROUP BY day, org_id, site_id, terrain_id, point_id
ORDER BY day, org_id, site_id, terrain_id, point_id;

-- Log result
SELECT 'Daily aggregation backfilled: ' || COUNT(*) || ' rows' AS result
FROM acrel_agg_daily;
