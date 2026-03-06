-- 007_core_incidents_and_logs.sql
-- Incidents tracking + system audit logs tables (idempotent)

-- 1) Severity enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_severity') THEN
    CREATE TYPE incident_severity AS ENUM ('info', 'warning', 'critical');
  END IF;
END$$;

-- 2) Status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status') THEN
    CREATE TYPE incident_status AS ENUM ('open', 'acknowledged', 'resolved');
  END IF;
END$$;

-- 3) Incidents table
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  severity incident_severity NOT NULL DEFAULT 'warning',
  status incident_status NOT NULL DEFAULT 'open',
  source TEXT DEFAULT '',            -- e.g. 'telemetry', 'gateway', 'manual'
  terrain_id UUID REFERENCES terrains(id) ON DELETE SET NULL,
  point_id UUID REFERENCES measurement_points(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_severity_idx ON incidents (severity);
CREATE INDEX IF NOT EXISTS incidents_terrain_idx ON incidents (terrain_id);
CREATE INDEX IF NOT EXISTS incidents_created_idx ON incidents (created_at DESC);

-- 4) System audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',    -- info, warn, error
  source TEXT NOT NULL DEFAULT 'api',    -- api, ingestion, worker, system
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_level_idx ON audit_logs (level);
CREATE INDEX IF NOT EXISTS audit_logs_source_idx ON audit_logs (source);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
