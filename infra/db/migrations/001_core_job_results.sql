-- 001_core_job_results.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS job_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  object_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_results_run_id_idx ON job_results(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_results_type_idx ON job_results(type, created_at DESC);