-- 020_solar_scenarios.sql
-- Solar PV pre-dimensioning scenarios and simulation results
-- Supports 4 methods: average load, peak demand, theoretical production, available surface

CREATE TABLE IF NOT EXISTS solar_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,

  -- Identification
  name TEXT NOT NULL DEFAULT 'Scénario PV',
  method TEXT NOT NULL DEFAULT 'average_load'
    CHECK (method IN ('average_load', 'peak_demand', 'theoretical_production', 'available_surface')),

  -- Common input parameters
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- average_load:   { hsp, eta_sys, k_sec, p_module, autonomy_days, battery_capacity_ah, system_voltage }
  -- peak_demand:    { hsp, eta_sys, k_sec, p_module, cos_phi, k_ond }
  -- theoretical:    { p_inst, gj, t_lever, t_coucher, pr, eta_mod, eta_inv, gamma_t, t_amb, t_noct }
  -- available_surface: { s_tot, k_occ, s_mod, p_module, hsp, pr, e_demand }

  -- Common computed results
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { e_jour, p_pv_kwc, n_modules, p_pv_final_kwc,
  --   e_prod_kwh, coverage_pct, delta_e,
  --   p_ond_kw, s_ond_kva, p_surge_kw, load_factor,
  --   nb_batteries, battery_capacity_wh,
  --   inverter_clipping_ok, production_profile, soc_profile }

  -- Financial summary (optional)
  financial JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { install_cost, annual_savings, payback_years, roi_25y, npv, lcoe, co2_avoided_kg }

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'computing', 'ready', 'failed')),
  error TEXT,

  -- Metadata
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_solar_scenarios_terrain ON solar_scenarios(terrain_id);
CREATE INDEX IF NOT EXISTS idx_solar_scenarios_status ON solar_scenarios(status);
CREATE INDEX IF NOT EXISTS idx_solar_scenarios_created ON solar_scenarios(created_at DESC);
