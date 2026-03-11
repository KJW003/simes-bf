-- 013_backfill_agg_from_readings.sql
-- Re-aggregate acrel_agg_daily and acrel_agg_15m from raw acrel_readings.
-- Needed because the telemetry worker failed after migration 010 added
-- energy_total_delta — older days have only ~15 samples instead of ~1300+.
-- Uses ON CONFLICT DO UPDATE to overwrite the bad rows.

-- 1) Re-aggregate daily buckets from raw readings
INSERT INTO acrel_agg_daily (
  day, org_id, site_id, terrain_id, point_id,
  samples_count,
  active_power_avg, active_power_max,
  energy_import_delta, energy_export_delta, energy_total_delta
)
SELECT
  (time_bucket('1 day', time))::date AS day,
  org_id, site_id, terrain_id, point_id,
  COUNT(*)::int AS samples_count,
  AVG(active_power_total) AS active_power_avg,
  MAX(active_power_total) AS active_power_max,
  GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS energy_import_delta,
  GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS energy_export_delta,
  GREATEST(MAX(energy_total) - MIN(energy_total), 0)   AS energy_total_delta
FROM acrel_readings
WHERE time < CURRENT_DATE  -- don't touch today (still accumulating)
GROUP BY day, org_id, site_id, terrain_id, point_id
ON CONFLICT (point_id, day)
DO UPDATE SET
  org_id             = EXCLUDED.org_id,
  site_id            = EXCLUDED.site_id,
  terrain_id         = EXCLUDED.terrain_id,
  samples_count      = EXCLUDED.samples_count,
  active_power_avg   = EXCLUDED.active_power_avg,
  active_power_max   = EXCLUDED.active_power_max,
  energy_import_delta = EXCLUDED.energy_import_delta,
  energy_export_delta = EXCLUDED.energy_export_delta,
  energy_total_delta  = EXCLUDED.energy_total_delta;

-- 2) Re-aggregate 15-minute buckets from raw readings
INSERT INTO acrel_agg_15m (
  bucket_start, org_id, site_id, terrain_id, point_id,
  samples_count,
  active_power_avg, active_power_max,
  voltage_a_avg,
  energy_import_delta, energy_export_delta, energy_total_delta
)
SELECT
  time_bucket('15 minutes', time) AS bucket_start,
  org_id, site_id, terrain_id, point_id,
  COUNT(*)::int AS samples_count,
  AVG(active_power_total) AS active_power_avg,
  MAX(active_power_total) AS active_power_max,
  AVG(voltage_a) AS voltage_a_avg,
  GREATEST(MAX(energy_import) - MIN(energy_import), 0) AS energy_import_delta,
  GREATEST(MAX(energy_export) - MIN(energy_export), 0) AS energy_export_delta,
  GREATEST(MAX(energy_total) - MIN(energy_total), 0)   AS energy_total_delta
FROM acrel_readings
WHERE time < CURRENT_DATE
GROUP BY bucket_start, org_id, site_id, terrain_id, point_id
ON CONFLICT (point_id, bucket_start)
DO UPDATE SET
  org_id             = EXCLUDED.org_id,
  site_id            = EXCLUDED.site_id,
  terrain_id         = EXCLUDED.terrain_id,
  samples_count      = EXCLUDED.samples_count,
  active_power_avg   = EXCLUDED.active_power_avg,
  active_power_max   = EXCLUDED.active_power_max,
  voltage_a_avg      = EXCLUDED.voltage_a_avg,
  energy_import_delta = EXCLUDED.energy_import_delta,
  energy_export_delta = EXCLUDED.energy_export_delta,
  energy_total_delta  = EXCLUDED.energy_total_delta;
