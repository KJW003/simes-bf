CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) sites
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS sites_org_idx ON sites(organization_id);

-- 3) terrains (1 terrain = 1 gateway Milesight)
CREATE TABLE IF NOT EXISTS terrains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gateway_model TEXT DEFAULT 'Milesight',
  gateway_id TEXT, -- serial / EUI / custom identifier
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, name)
);

CREATE INDEX IF NOT EXISTS terrains_site_idx ON terrains(site_id);

-- 4) zones (belong to terrain)
CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (terrain_id, name)
);

CREATE INDEX IF NOT EXISTS zones_terrain_idx ON zones(terrain_id);

-- 5) measurement_points (energimeters)
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

  device TEXT NOT NULL, -- ADW300 / Shelly / etc.
  measure_category measure_category NOT NULL DEFAULT 'UNKNOWN',

  lora_dev_eui TEXT,
  modbus_addr INTEGER,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- éviter doublons évidents
  UNIQUE (terrain_id, name),
  UNIQUE (terrain_id, lora_dev_eui),
  UNIQUE (terrain_id, modbus_addr)
);

CREATE INDEX IF NOT EXISTS mp_terrain_idx ON measurement_points(terrain_id);
CREATE INDEX IF NOT EXISTS mp_zone_idx ON measurement_points(zone_id);
CREATE INDEX IF NOT EXISTS mp_category_idx ON measurement_points(measure_category);
