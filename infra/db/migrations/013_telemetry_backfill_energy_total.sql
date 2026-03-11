-- Migration 013: Backfill energy_total_delta from energy_import_delta
-- where energy_total_delta is NULL (historical data before energy_total was populated)
--
-- This handles the case where the Acrel ADW300 codec or gateway configuration
-- did not include the EP register (energy_total), leaving it NULL in acrel_readings
-- while energy_import (EPI) was always populated.

BEGIN;

-- 1) Backfill acrel_agg_15m
UPDATE acrel_agg_15m
SET energy_total_delta = energy_import_delta
WHERE energy_total_delta IS NULL
  AND energy_import_delta IS NOT NULL;

-- 2) Backfill acrel_agg_daily
UPDATE acrel_agg_daily
SET energy_total_delta = energy_import_delta
WHERE energy_total_delta IS NULL
  AND energy_import_delta IS NOT NULL;

COMMIT;
