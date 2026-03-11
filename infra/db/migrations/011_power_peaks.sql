-- 011: Power peaks historical table
-- Stores daily max active power per measurement point for historical access

CREATE TABLE IF NOT EXISTS power_peaks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  terrain_id  UUID NOT NULL,
  point_id    UUID NOT NULL,
  peak_date   DATE NOT NULL,
  max_power   DOUBLE PRECISION NOT NULL,
  peak_time   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (point_id, peak_date)
);

CREATE INDEX IF NOT EXISTS idx_power_peaks_terrain_date
  ON power_peaks (terrain_id, peak_date DESC);
