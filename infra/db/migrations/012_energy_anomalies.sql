-- 012: Energy anomalies table
-- Stores detected energy anomalies from ML anomaly detection

CREATE TABLE IF NOT EXISTS energy_anomalies (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  terrain_id    UUID NOT NULL,
  point_id      UUID,
  anomaly_date  DATE NOT NULL,
  anomaly_type  VARCHAR(50) NOT NULL,  -- 'residual', 'isolation_forest', 'threshold'
  severity      VARCHAR(20) NOT NULL DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
  score         DOUBLE PRECISION,
  expected_kwh  DOUBLE PRECISION,
  actual_kwh    DOUBLE PRECISION,
  deviation_pct DOUBLE PRECISION,
  description   TEXT,
  resolved      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_terrain_date
  ON energy_anomalies (terrain_id, anomaly_date DESC);

CREATE INDEX IF NOT EXISTS idx_anomalies_type
  ON energy_anomalies (anomaly_type, terrain_id);
