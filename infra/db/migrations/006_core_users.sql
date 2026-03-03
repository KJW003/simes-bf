-- 006_core_users.sql
-- Users table + admin seed (idempotent)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Role enum
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

-- 2) Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'operator',
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  site_access UUID[] DEFAULT '{}',          -- restrict operator to specific sites (empty = all)
  avatar TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  locked_until TIMESTAMPTZ NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS users_org_idx ON users (organization_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- 3) Seed : platform super admin
--    email: admin@simes.bf   password: admin1234
INSERT INTO users (email, password_hash, name, role, organization_id)
VALUES (
  'admin@simes.bf',
  '$2b$10$i3gIdausWED.7Qw96CVJ4OBF1.M.WiMk6EqrClYcyQ04VV3l6T4Yu',
  'SIMES Admin',
  'platform_super_admin',
  NULL
)
ON CONFLICT (email) DO NOTHING;

-- 4) Seed : org admin for first org (created later by hand or migration)
--    email: marie.kone@isge.bf   password: demo1234
INSERT INTO users (email, password_hash, name, role, organization_id)
SELECT
  'marie.kone@isge.bf',
  '$2b$10$kgsTF/qiJb7xrdE0SJPCreyOCqd5ZAC857zPGnlDrhATiSBiYJHpS',
  'Marie Koné',
  'org_admin',
  o.id
FROM organizations o WHERE o.name = 'ISGE'
ON CONFLICT (email) DO NOTHING;

-- 5) Seed : operator
--    email: i.ouedraogo@isge.bf   password: demo1234
INSERT INTO users (email, password_hash, name, role, organization_id)
SELECT
  'i.ouedraogo@isge.bf',
  '$2b$10$kgsTF/qiJb7xrdE0SJPCreyOCqd5ZAC857zPGnlDrhATiSBiYJHpS',
  'Ibrahim Ouédraogo',
  'operator',
  o.id
FROM organizations o WHERE o.name = 'ISGE'
ON CONFLICT (email) DO NOTHING;
