-- 015: Anomaly analysis state tracking + UNIQUE constraint
-- Prevents duplicate anomalies across multiple scans
-- Tracks analysis window per terrain for efficient incremental detection

-- Add UNIQUE constraint to prevent duplicate anomalies
-- (terrain_id, anomaly_date, anomaly_type uniquely identifies an anomaly)
ALTER TABLE energy_anomalies
ADD CONSTRAINT uq_anomaly_unique UNIQUE (terrain_id, anomaly_date, anomaly_type);

-- Create table to track last analysis per terrain
-- This enables sliding-window analysis: only check NEW data since last_analyzed_until
CREATE TABLE IF NOT EXISTS anomaly_analysis_state (
  terrain_id UUID PRIMARY KEY REFERENCES terrains(id) ON DELETE CASCADE,
  
  -- When the analysis was last completed
  last_analysis_time TIMESTAMPTZ DEFAULT NOW(),
  
  -- The analysis covered readings up to this timestamp
  -- Next analysis should start from this point
  last_analyzed_until TIMESTAMPTZ DEFAULT NOW() - INTERVAL '48 hours',
  
  -- For auditing
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_state_time 
  ON anomaly_analysis_state (last_analysis_time DESC);
