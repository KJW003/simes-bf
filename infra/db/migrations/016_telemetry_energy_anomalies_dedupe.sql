-- 016: Deduplicate anomalies and enforce semantic uniqueness.
-- Prevent repeated runs from inserting the same anomaly signal endlessly.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY terrain_id, anomaly_date, anomaly_type, COALESCE(point_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM energy_anomalies
)
DELETE FROM energy_anomalies ea
USING ranked r
WHERE ea.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_energy_anomalies_semantic
  ON energy_anomalies (
    terrain_id,
    anomaly_date,
    anomaly_type,
    COALESCE(point_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
