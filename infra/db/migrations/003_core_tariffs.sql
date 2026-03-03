-- 003_core_tariffs.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tariff_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code TEXT NOT NULL,             -- D / E / G
  plan_code  TEXT NOT NULL,             -- D1, D2, D3, E1, E2, E3, G
  name       TEXT NOT NULL,             -- label humain
  valid_from DATE NULL,
  valid_to   DATE NULL,

  -- Heures (local time) : [start, end) en minutes dans la journée
  hp_start_min INT NOT NULL,            -- ex 0 (00:00)
  hp_end_min   INT NOT NULL,            -- ex 1020 (17:00)
  hpt_start_min INT NOT NULL,           -- ex 1020 (17:00)
  hpt_end_min   INT NOT NULL,           -- ex 1440 (24:00)

  -- Tarifs kWh (XOF/kWh)
  rate_hp  DOUBLE PRECISION NOT NULL,
  rate_hpt DOUBLE PRECISION NOT NULL,

  -- Prime fixe mensuelle (XOF)
  fixed_monthly DOUBLE PRECISION NOT NULL,

  -- Prime de puissance (XOF/kW)
  prime_per_kw DOUBLE PRECISION NOT NULL,

  -- Paramètres de calcul (V1)
  vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.18,     -- TVA 18%
  tde_tdsaae_rate DOUBLE PRECISION NOT NULL DEFAULT 2, -- dans ton doc: 2 x (...)
  penalty_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (plan_code, valid_from)
);

-- Contrat terrain (PS + plan tarifaire)
CREATE TABLE IF NOT EXISTS terrain_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL,
  tariff_plan_id UUID NOT NULL REFERENCES tariff_plans(id),
  subscribed_power_kw DOUBLE PRECISION NOT NULL,   -- PS
  meter_rental DOUBLE PRECISION NOT NULL DEFAULT 0, -- location compteur (si applicable)
  post_rental  DOUBLE PRECISION NOT NULL DEFAULT 0, -- location poste
  maintenance  DOUBLE PRECISION NOT NULL DEFAULT 0, -- entretien
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (terrain_id)
);

CREATE INDEX IF NOT EXISTS tariff_plans_group_idx ON tariff_plans(group_code);
CREATE INDEX IF NOT EXISTS terrain_contracts_terrain_idx ON terrain_contracts(terrain_id);