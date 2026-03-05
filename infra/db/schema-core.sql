-- =============================================================
-- SIMES-BF / Core Database – Full schema (idempotent)
-- Target: core-db (Postgres 16)
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1) Organizations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2) Sites ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS sites_org_idx ON sites(organization_id);

-- ─── 3) Terrains (1 terrain = 1 gateway Milesight) ──────────
CREATE TABLE IF NOT EXISTS terrains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gateway_model TEXT DEFAULT 'Milesight',
  gateway_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, name)
);

CREATE INDEX IF NOT EXISTS terrains_site_idx ON terrains(site_id);

-- ─── 4) Zones ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (terrain_id, name)
);

CREATE INDEX IF NOT EXISTS zones_terrain_idx ON zones(terrain_id);

-- ─── 5) Measurement Points ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'measure_category') THEN
    CREATE TYPE measure_category AS ENUM (
      'LOAD', 'GRID', 'PV', 'BATTERY', 'GENSET', 'UNKNOWN'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS measurement_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  device TEXT NOT NULL,
  measure_category measure_category NOT NULL DEFAULT 'UNKNOWN',
  lora_dev_eui TEXT,
  modbus_addr INTEGER,
  ct_ratio DOUBLE PRECISION NOT NULL DEFAULT 1,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (terrain_id, name),
  UNIQUE (terrain_id, lora_dev_eui),
  UNIQUE (terrain_id, modbus_addr)
);

CREATE INDEX IF NOT EXISTS mp_terrain_idx ON measurement_points(terrain_id);
CREATE INDEX IF NOT EXISTS mp_zone_idx ON measurement_points(zone_id);
CREATE INDEX IF NOT EXISTS mp_category_idx ON measurement_points(measure_category);

-- ─── 6) Runs (job execution tracker) ────────────────────────
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_type_idx ON runs(type, created_at DESC);

-- ─── 7) Job Results ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  object_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_results_run_id_idx ON job_results(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_results_type_idx ON job_results(type, created_at DESC);

-- ─── 8) Tariff Plans ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariff_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  name TEXT NOT NULL,
  valid_from DATE NULL,
  valid_to DATE NULL,
  hp_start_min INT NOT NULL,
  hp_end_min INT NOT NULL,
  hpt_start_min INT NOT NULL,
  hpt_end_min INT NOT NULL,
  rate_hp DOUBLE PRECISION NOT NULL,
  rate_hpt DOUBLE PRECISION NOT NULL,
  fixed_monthly DOUBLE PRECISION NOT NULL,
  prime_per_kw DOUBLE PRECISION NOT NULL,
  vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.18,
  tde_tdsaae_rate DOUBLE PRECISION NOT NULL DEFAULT 2,
  penalty_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (plan_code, valid_from)
);

CREATE INDEX IF NOT EXISTS tariff_plans_group_idx ON tariff_plans(group_code);

-- ─── 9) Terrain Contracts ───────────────────────────────────
CREATE TABLE IF NOT EXISTS terrain_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  tariff_plan_id UUID NOT NULL REFERENCES tariff_plans(id),
  subscribed_power_kw DOUBLE PRECISION NOT NULL,
  meter_rental DOUBLE PRECISION NOT NULL DEFAULT 0,
  post_rental DOUBLE PRECISION NOT NULL DEFAULT 0,
  maintenance DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (terrain_id)
);

CREATE INDEX IF NOT EXISTS terrain_contracts_terrain_idx ON terrain_contracts(terrain_id);

-- ─── 10) Incoming Messages ──────────────────────────────────
CREATE TABLE IF NOT EXISTS incoming_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gateway_id TEXT NULL,
  topic TEXT NULL,
  device_key TEXT NULL,
  modbus_addr INT NULL,
  dev_eui TEXT NULL,
  status TEXT NOT NULL DEFAULT 'unmapped',
  mapped_terrain_id UUID NULL,
  mapped_point_id UUID NULL,
  payload_raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS incoming_messages_received_idx ON incoming_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS incoming_messages_gateway_idx ON incoming_messages (gateway_id, received_at DESC);
CREATE INDEX IF NOT EXISTS incoming_messages_status_idx ON incoming_messages (status, received_at DESC);

-- ─── 11) Gateway Registry ───────────────────────────────────
CREATE TABLE IF NOT EXISTS gateway_registry (
  gateway_id TEXT PRIMARY KEY,
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_registry_terrain_idx ON gateway_registry (terrain_id);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_registry_terrain_unique ON gateway_registry (terrain_id);

-- ─── 12) Device Registry ────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  device_key TEXT NOT NULL,
  modbus_addr INT NULL,
  dev_eui TEXT NULL,
  point_id UUID NOT NULL REFERENCES measurement_points(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NULL,
  UNIQUE (terrain_id, device_key)
);

CREATE INDEX IF NOT EXISTS device_registry_point_idx ON device_registry (point_id);
CREATE INDEX IF NOT EXISTS device_registry_last_seen_idx ON device_registry (last_seen_at DESC);

-- ─── 13) Users ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'platform_super_admin',
      'org_admin',
      'operator',
      'manager'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'operator',
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  site_access UUID[] DEFAULT '{}',
  avatar TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  locked_until TIMESTAMPTZ NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS users_org_idx ON users (organization_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- ─── 14) Seed : default admin ───────────────────────────────
-- admin@simes.bf / admin1234
INSERT INTO users (email, password_hash, name, role, organization_id)
VALUES (
  'admin@simes.bf',
  '$2b$10$i3gIdausWED.7Qw96CVJ4OBF1.M.WiMk6EqrClYcyQ04VV3l6T4Yu',
  'SIMES Admin',
  'platform_super_admin',
  NULL
)
ON CONFLICT (email) DO NOTHING;

-- ─── 15) Seed : SONABEL tariffs 2023-10 ─────────────────────
INSERT INTO tariff_plans
(group_code, plan_code, name, valid_from, hp_start_min, hp_end_min, hpt_start_min, hpt_end_min, rate_hp, rate_hpt, fixed_monthly, prime_per_kw)
VALUES
('D','D1','D1 Non industriel (SONABEL 2023-10)', '2023-10-01', 0,1020, 1020,1440, 88,165, 8538, 2882),
('D','D2','D2 Industriel (SONABEL 2023-10)',     '2023-10-01', 0,1020, 1020,1440, 75,140, 7115, 2402),
('D','D3','D3 Spécial (SONABEL 2023-10)',        '2023-10-01', 0,1020, 1020,1440, 160,160,8538, 2882),
('E','E1','E1 Non industriel (SONABEL 2023-10)', '2023-10-01', 0,1020, 1020,1440, 64,139, 8538, 5903),
('E','E2','E2 Industriel (SONABEL 2023-10)',     '2023-10-01', 0,1020, 1020,1440, 54,118, 7115, 5366),
('E','E3','E3 Spécial (SONABEL 2023-10)',        '2023-10-01', 0,1020, 1020,1440, 160,160,8538, 5903),
('G','G','G (SONABEL 2023-10)',                  '2023-10-01', 0,600,  600,1440, 70,140, 7115, 5366)
ON CONFLICT DO NOTHING;
