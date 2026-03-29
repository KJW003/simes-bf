-- Migration 021: Hierarchical measurement points
-- Adds parent_id (tree), node_type (structural role), is_billing (aggregation flag)
-- Fully retrocompatible: defaults keep existing behavior intact (ESSAKANE)

-- 1) Node type enum
DO $$ BEGIN
  CREATE TYPE node_type AS ENUM ('source', 'tableau', 'depart', 'charge');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Add columns
ALTER TABLE measurement_points
  ADD COLUMN IF NOT EXISTS parent_id  UUID REFERENCES measurement_points(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS node_type  node_type NOT NULL DEFAULT 'charge',
  ADD COLUMN IF NOT EXISTS is_billing BOOLEAN NOT NULL DEFAULT true;

-- 3) Constraints
DO $$ BEGIN
  ALTER TABLE measurement_points ADD CONSTRAINT chk_no_self_parent CHECK (parent_id IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) Index for tree queries
CREATE INDEX IF NOT EXISTS idx_mp_parent_id ON measurement_points(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_billing ON measurement_points(terrain_id, is_billing) WHERE is_billing = true AND status = 'active';

-- 5) View: billing points (source of truth for global aggregation)
CREATE OR REPLACE VIEW billing_points AS
  SELECT *
  FROM measurement_points
  WHERE is_billing = true
    AND status = 'active';

-- 6) Function: detect circular parent references (max depth 10)
CREATE OR REPLACE FUNCTION check_point_no_cycle()
RETURNS TRIGGER AS $$
DECLARE
  current_id UUID;
  depth INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  current_id := NEW.parent_id;
  WHILE current_id IS NOT NULL AND depth < 10 LOOP
    IF current_id = NEW.id THEN
      RAISE EXCEPTION 'Circular parent reference detected for point %', NEW.id;
    END IF;
    SELECT parent_id INTO current_id FROM measurement_points WHERE id = current_id;
    depth := depth + 1;
  END LOOP;
  IF depth >= 10 THEN
    RAISE EXCEPTION 'Hierarchy too deep (max 10 levels) for point %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_point_no_cycle ON measurement_points;
CREATE TRIGGER trg_point_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON measurement_points
  FOR EACH ROW EXECUTE FUNCTION check_point_no_cycle();
