-- 015b_core_billing_v2_tariff_columns.sql
-- Add loss coefficients to tariff_plans + capacitor power to terrain_contracts
-- (Split from 015_billing_v2_columns.sql for correct DB targeting)

ALTER TABLE tariff_plans
  ADD COLUMN IF NOT EXISTS alpha_a DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beta_a  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alpha_r DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beta_r  DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE terrain_contracts
  ADD COLUMN IF NOT EXISTS capacitor_power_kw DOUBLE PRECISION NOT NULL DEFAULT 0;
