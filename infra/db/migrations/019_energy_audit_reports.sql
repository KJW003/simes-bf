-- 019_energy_audit_reports.sql
-- Energy audit reports: server-side efficiency scoring, diagnostics & recommendations
-- Persists audit snapshots for historical comparison and PDF export

-- 1) Status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_report_status') THEN
    CREATE TYPE audit_report_status AS ENUM ('pending', 'computing', 'ready', 'failed');
  END IF;
END$$;

-- 2) Energy audit reports table
CREATE TABLE IF NOT EXISTS energy_audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,

  -- Period analyzed
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,

  -- Overall score (0-100)
  efficiency_score INT NOT NULL DEFAULT 0 CHECK (efficiency_score >= 0 AND efficiency_score <= 100),
  score_label TEXT NOT NULL DEFAULT '',

  -- Diagnostics snapshot (array of {label, status, detail})
  diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Recommendations (array of {priority, title, impact})
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Per-point metrics (array of {point_id, name, pf, thdA, vUnbal, power, score})
  point_diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- KPI summary
  -- { points_count, readings_count, pf_global, thd_max, thd_avg,
  --   v_unbalance_max, data_completeness_pct, energy_kwh, cost_estimate, co2_estimate }
  kpi JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Status
  status audit_report_status NOT NULL DEFAULT 'pending',
  error TEXT,

  -- Audit trail
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_energy_audit_terrain ON energy_audit_reports(terrain_id);
CREATE INDEX IF NOT EXISTS idx_energy_audit_status ON energy_audit_reports(status);
CREATE INDEX IF NOT EXISTS idx_energy_audit_created ON energy_audit_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_energy_audit_terrain_period ON energy_audit_reports(terrain_id, period_from DESC);
