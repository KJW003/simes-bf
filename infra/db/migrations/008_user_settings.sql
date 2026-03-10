-- ============================================================
-- Migration 008: Add settings JSONB column to users table
-- Stores all user preferences (theme, tariffs, map config,
-- alarm rules, widget layout) for cross-browser sync.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.settings IS 'User preferences blob: preferences, mapConfig, alarmRules, widgetLayout';
