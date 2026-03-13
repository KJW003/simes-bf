-- =============================================================
-- Migration: Monthly Invoicing System
-- Adds tables for storing computed monthly factures
-- =============================================================

-- ─── 1) Monthly Invoice Storage ──────────────────────────────
CREATE TABLE IF NOT EXISTS facture_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  
  -- Computed data snapshot (from worker)
  data JSONB NOT NULL,  -- { breakdown, totalAmount, totalKwh, etc. }
  
  -- Status tracking
  status VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  
  -- Audit trail
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: one invoice per terrain per month
  UNIQUE (terrain_id, year, month)
);

CREATE INDEX IF NOT EXISTS facture_monthly_terrain_idx ON facture_monthly(terrain_id);
CREATE INDEX IF NOT EXISTS facture_monthly_period_idx ON facture_monthly(year, month);
CREATE INDEX IF NOT EXISTS facture_monthly_updated_idx ON facture_monthly(updated_at DESC);

-- ─── 2) Daily Update Log (for audit; optional monitoring) ────
CREATE TABLE IF NOT EXISTS facture_daily_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  
  -- When this update happened
  update_date DATE NOT NULL,
  
  -- Data range included in this update
  data_from TIMESTAMPTZ NOT NULL,
  data_to TIMESTAMPTZ NOT NULL,
  
  -- Some metrics from the update
  consumption_added_kwh NUMERIC(12, 2),
  power_peak_kw NUMERIC(8, 3),
  
  -- Update info
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Track which system triggered it
  triggered_by VARCHAR DEFAULT 'scheduler',  -- 'scheduler' | 'manual' | 'recompute'
  
  UNIQUE (terrain_id, year, month, update_date)
);

CREATE INDEX IF NOT EXISTS facture_daily_updates_terrain_idx ON facture_daily_updates(terrain_id);
CREATE INDEX IF NOT EXISTS facture_daily_updates_period_idx ON facture_daily_updates(year, month);
CREATE INDEX IF NOT EXISTS facture_daily_updates_triggered_idx ON facture_daily_updates(triggered_by);

-- ─── 3) Computed Facture Results (persisted runs) ───────────
-- This stores the actual computed result for retrieval
CREATE TABLE IF NOT EXISTS facture_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  
  -- Period information
  year INT NOT NULL,
  month INT,  -- NULL if adhoc period
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  
  -- Result data
  result JSONB NOT NULL,  -- { breakdown, totalAmount, totalKwh, version, etc. }
  
  -- Metadata
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode VARCHAR DEFAULT 'month'  -- 'month' | 'adhoc' | 'today'
);

CREATE INDEX IF NOT EXISTS facture_results_terrain_idx ON facture_results(terrain_id);
CREATE INDEX IF NOT EXISTS facture_results_period_idx ON facture_results(year, month);
CREATE INDEX IF NOT EXISTS facture_results_run_idx ON facture_results(run_id);

-- ─── 4) Audit Log for Facture Operations ────────────────────
CREATE TABLE IF NOT EXISTS audit_facture (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,  -- org_id (for multi-tenancy restrictions)
  user_id UUID,
  action VARCHAR NOT NULL,  -- 'view', 'list', 'download', 'recompute', 'update'
  resource_type VARCHAR,  -- 'facture_monthly', 'facture_today', 'facture_months', etc.
  resource_id VARCHAR,  -- Can be UUID or string identifier
  details JSONB,  -- { terrainId, year, month, error, duration_ms, etc. }
  client_ip VARCHAR,  -- IP address of requesting client
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_facture_tenant_idx ON audit_facture(tenant_id);
CREATE INDEX IF NOT EXISTS audit_facture_user_idx ON audit_facture(user_id);
CREATE INDEX IF NOT EXISTS audit_facture_action_idx ON audit_facture(action);
CREATE INDEX IF NOT EXISTS audit_facture_resource_idx ON audit_facture(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_facture_timestamp_idx ON audit_facture(timestamp DESC);

-- ─── Comment Summary ────────────────────────────────────────
/*
FACTURE_MONTHLY:
  - Single invoice per terrain per month
  - Computed automatically each night via scheduler
  - Status: 'draft' (being updated) → 'finalized' (end of month)
  - Data: { breakdown[], totalAmount, totalKwh, Kma, cosPhi, ... }

FACTURE_DAILY_UPDATES:
  - Audit trail showing when each month's invoice was updated
  - Use for: tracking data completeness, debugging timing issues
  - Optional: Can populate via scheduler's post-compute hook

FACTURE_RESULTS:
  - Stores results of all computation runs (monthly or ad-hoc)
  - Links to runs table for full job metadata
  - Used when user requests specific period

AUDIT_FACTURE:
  - Security: who accessed which invoice, when, from where
  - Required for compliance (Burkina Faso regulations)
  - Keyed by tenant (org) to prevent cross-org data leaks
*/
