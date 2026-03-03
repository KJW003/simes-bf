-- 005_core_incoming_and_mapping.sql
-- Flux entrants + mapping admin (idempotent)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Raw incoming messages (store ALWAYS, mapped or not)
CREATE TABLE IF NOT EXISTS incoming_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- gateway identity (may come from topic or payload)
  gateway_id TEXT NULL,
  topic TEXT NULL,

  -- device identity (we prioritize modbus addr as requested)
  device_key TEXT NULL,         -- e.g. "modbus:1" or "deveui:70B3D57..."
  modbus_addr INT NULL,
  dev_eui TEXT NULL,

  status TEXT NOT NULL DEFAULT 'unmapped', -- unmapped | mapped | ignored

  -- mapping result (optional until admin maps)
  mapped_terrain_id UUID NULL,
  mapped_point_id UUID NULL,

  payload_raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS incoming_messages_received_idx ON incoming_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS incoming_messages_gateway_idx ON incoming_messages (gateway_id, received_at DESC);
CREATE INDEX IF NOT EXISTS incoming_messages_status_idx ON incoming_messages (status, received_at DESC);

-- 2) Gateway registry : 1 Milesight = 1 terrain
CREATE TABLE IF NOT EXISTS gateway_registry (
  gateway_id TEXT PRIMARY KEY,
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Device registry : device_key scoped by terrain (modbus addr repeats across terrains)
CREATE TABLE IF NOT EXISTS device_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terrain_id UUID NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  device_key TEXT NOT NULL,      -- "modbus:1" or "deveui:..."
  modbus_addr INT NULL,
  dev_eui TEXT NULL,
  point_id UUID NOT NULL REFERENCES measurement_points(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NULL,

  UNIQUE (terrain_id, device_key)
);

CREATE INDEX IF NOT EXISTS gateway_registry_terrain_idx ON gateway_registry (terrain_id);\nCREATE UNIQUE INDEX IF NOT EXISTS gateway_registry_terrain_unique ON gateway_registry (terrain_id);
CREATE INDEX IF NOT EXISTS device_registry_point_idx ON device_registry (point_id);
CREATE INDEX IF NOT EXISTS device_registry_last_seen_idx ON device_registry (last_seen_at DESC);