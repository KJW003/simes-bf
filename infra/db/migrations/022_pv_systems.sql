-- Migration 022: PV Systems hierarchy
-- Allows grouping measurement points into logical PV systems
-- Example: System "Toiture sud" contains 2 onduleurs (2 points PV)

-- 1) Create pv_systems table
CREATE TABLE IF NOT EXISTS pv_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  location TEXT,                          -- "toit sud", "parking", etc
  installed_capacity_kwc DECIMAL(10, 2),  -- kWc installed
  installation_date DATE,
  expected_tilt_degrees INT,              -- optimal angle for Ouagadougou ~12°
  expected_orientation VARCHAR(50),       -- N, NE, E, SE, S, SW, W, NW
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Add pv_system_id to measurement_points
ALTER TABLE measurement_points
  ADD COLUMN IF NOT EXISTS pv_system_id UUID REFERENCES pv_systems(id) ON DELETE SET NULL;

-- 3) Constraints
DO $$ BEGIN
  ALTER TABLE pv_systems ADD CONSTRAINT chk_pv_capacity_positive CHECK (installed_capacity_kwc IS NULL OR installed_capacity_kwc > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE pv_systems ADD CONSTRAINT chk_pv_tilt_range CHECK (expected_tilt_degrees IS NULL OR (expected_tilt_degrees >= 0 AND expected_tilt_degrees <= 90));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_pv_systems_terrain ON pv_systems(terrain_id);
CREATE INDEX IF NOT EXISTS idx_mp_pv_system ON measurement_points(pv_system_id) WHERE pv_system_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_pv_category_system ON measurement_points(terrain_id, measure_category, pv_system_id)
  WHERE measure_category = 'PV' AND pv_system_id IS NOT NULL;

-- 5) View: PV systems with point counts
CREATE OR REPLACE VIEW pv_systems_overview AS
  SELECT
    ps.id, ps.terrain_id, ps.name, ps.description, ps.location,
    ps.installed_capacity_kwc, ps.installation_date,
    ps.expected_tilt_degrees, ps.expected_orientation,
    ps.created_at, ps.updated_at,
    COUNT(DISTINCT mp.id) AS point_count,
    COUNT(DISTINCT CASE WHEN mp.status = 'active' THEN mp.id END) AS active_point_count
  FROM pv_systems ps
  LEFT JOIN measurement_points mp ON mp.pv_system_id = ps.id
  GROUP BY ps.id;
