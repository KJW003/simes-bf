#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# SIMES-BF – Forensic data recovery via pg_dirtyread
# ═══════════════════════════════════════════════════════════════════
# This script attempts to recover deleted (purged) rows from
# acrel_readings, acrel_agg_15m, and acrel_agg_daily hypertables
# by reading dead tuples that haven't been vacuumed yet.
#
# Prerequisites:
#   - SSH access to the server running the TimescaleDB container
#   - The container name is "simes-telemetry-db"
#   - VACUUM FULL must NOT have completed on the target tables
#
# Usage:
#   chmod +x recover-dead-tuples.sh
#   ./recover-dead-tuples.sh
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

CONTAINER="simes-telemetry-db"
DB="simes_telemetry"
USER="simes"

echo "═══════════════════════════════════════════════"
echo "  SIMES-BF – pg_dirtyread recovery"
echo "═══════════════════════════════════════════════"

# ── Step 1: Disable autovacuum on target tables IMMEDIATELY ──────
echo ""
echo "[1/6] Disabling autovacuum on target tables to prevent cleanup..."
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "
  ALTER TABLE acrel_readings SET (autovacuum_enabled = false);
  ALTER TABLE acrel_agg_15m  SET (autovacuum_enabled = false);
  ALTER TABLE acrel_agg_daily SET (autovacuum_enabled = false);
"
echo "  ✓ Autovacuum disabled"

# ── Step 2: Check dead tuple counts before installing anything ───
echo ""
echo "[2/6] Checking dead tuple counts in relevant tables..."
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "
  SELECT relname, n_dead_tup, n_live_tup, last_autovacuum, last_vacuum
  FROM pg_stat_user_tables
  WHERE relname LIKE '%acrel%' OR relname LIKE '%hyper%'
  ORDER BY n_dead_tup DESC;
"

# ── Step 3: Install pg_dirtyread ─────────────────────────────────
echo ""
echo "[3/6] Installing pg_dirtyread extension..."
docker exec "$CONTAINER" bash -c '
  # Install build dependencies
  apt-get update -qq
  apt-get install -y -qq git make gcc postgresql-server-dev-16 > /dev/null 2>&1

  # Clone and compile pg_dirtyread
  cd /tmp
  if [ -d pg_dirtyread ]; then rm -rf pg_dirtyread; fi
  git clone https://github.com/df7cb/pg_dirtyread.git
  cd pg_dirtyread
  make
  make install
'
echo "  ✓ pg_dirtyread compiled and installed"

# ── Step 4: Create extension and scan for dead tuples ────────────
echo ""
echo "[4/6] Creating extension and scanning for recoverable data..."
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "
  CREATE EXTENSION IF NOT EXISTS pg_dirtyread;
"

# Count dead tuples across all chunks
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" <<'EOSQL'
-- List all chunks for acrel_readings and check dead tuple counts
DO $$
DECLARE
  chunk_rec RECORD;
  dead_count BIGINT;
  total_dead BIGINT := 0;
BEGIN
  RAISE NOTICE '── Scanning acrel_readings chunks ──';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_readings'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM pg_dirtyread(%L) AS t(
        time         timestamptz,
        org_id       uuid,
        site_id      uuid,
        terrain_id   uuid,
        point_id     uuid,
        raw          jsonb,
        voltage_a    double precision,
        voltage_b    double precision,
        voltage_c    double precision,
        voltage_ab   double precision,
        voltage_bc   double precision,
        voltage_ca   double precision,
        current_a    double precision,
        current_b    double precision,
        current_c    double precision,
        current_sum  double precision,
        aftercurrent double precision,
        active_power_a     double precision,
        active_power_b     double precision,
        active_power_c     double precision,
        active_power_total double precision,
        reactive_power_a     double precision,
        reactive_power_b     double precision,
        reactive_power_c     double precision,
        reactive_power_total double precision,
        apparent_power_a     double precision,
        apparent_power_b     double precision,
        apparent_power_c     double precision,
        apparent_power_total double precision,
        power_factor_a     double precision,
        power_factor_b     double precision,
        power_factor_c     double precision,
        power_factor_total double precision,
        frequency          double precision,
        voltage_unbalance  double precision,
        current_unbalance  double precision,
        energy_total       double precision,
        energy_import      double precision,
        energy_export      double precision,
        reactive_energy_import double precision,
        reactive_energy_export double precision,
        energy_total_a   double precision,
        energy_import_a  double precision,
        energy_export_a  double precision,
        energy_total_b   double precision,
        energy_import_b  double precision,
        energy_export_b  double precision,
        energy_total_c   double precision,
        energy_import_c  double precision,
        energy_export_c  double precision,
        energy_spike     double precision,
        energy_peak      double precision,
        energy_flat      double precision,
        energy_valley    double precision,
        thdu_a           double precision,
        thdu_b           double precision,
        thdu_c           double precision,
        thdi_a           double precision,
        thdi_b           double precision,
        thdi_c           double precision,
        temp_a           double precision,
        temp_b           double precision,
        temp_c           double precision,
        temp_n           double precision,
        di_state         bigint,
        do1_state        bigint,
        do2_state        bigint,
        alarm_state      bigint,
        rssi_lora        double precision,
        rssi_gateway     double precision,
        snr_gateway      double precision,
        f_cnt            bigint,
        dead             boolean
      ) WHERE dead = true',
      chunk_rec.full_name
    ) INTO dead_count;

    IF dead_count > 0 THEN
      RAISE NOTICE 'Chunk %: % dead tuples found!', chunk_rec.chunk_name, dead_count;
      total_dead := total_dead + dead_count;
    END IF;
  END LOOP;

  RAISE NOTICE '── Total recoverable acrel_readings rows: % ──', total_dead;
END $$;
EOSQL

echo ""
echo "[5/6] Scanning aggregation tables..."

# Check agg tables too
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" <<'EOSQL'
DO $$
DECLARE
  chunk_rec RECORD;
  dead_count BIGINT;
  total_dead BIGINT := 0;
BEGIN
  RAISE NOTICE '── Scanning acrel_agg_15m chunks ──';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_agg_15m'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM pg_dirtyread(%L) AS t(
        bucket_start        timestamptz,
        org_id              uuid,
        site_id             uuid,
        terrain_id          uuid,
        point_id            uuid,
        samples_count       int,
        active_power_avg    double precision,
        active_power_max    double precision,
        voltage_a_avg       double precision,
        energy_import_delta double precision,
        energy_export_delta double precision,
        energy_total_delta  double precision,
        dead                boolean
      ) WHERE dead = true',
      chunk_rec.full_name
    ) INTO dead_count;

    IF dead_count > 0 THEN
      RAISE NOTICE 'Chunk %: % dead tuples found!', chunk_rec.chunk_name, dead_count;
      total_dead := total_dead + dead_count;
    END IF;
  END LOOP;
  RAISE NOTICE '── Total recoverable acrel_agg_15m rows: % ──', total_dead;
END $$;

DO $$
DECLARE
  chunk_rec RECORD;
  dead_count BIGINT;
  total_dead BIGINT := 0;
BEGIN
  RAISE NOTICE '── Scanning acrel_agg_daily chunks ──';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_agg_daily'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM pg_dirtyread(%L) AS t(
        day                 date,
        org_id              uuid,
        site_id             uuid,
        terrain_id          uuid,
        point_id            uuid,
        samples_count       int,
        active_power_avg    double precision,
        active_power_max    double precision,
        energy_import_delta double precision,
        energy_export_delta double precision,
        energy_total_delta  double precision,
        dead                boolean
      ) WHERE dead = true',
      chunk_rec.full_name
    ) INTO dead_count;

    IF dead_count > 0 THEN
      RAISE NOTICE 'Chunk %: % dead tuples found!', chunk_rec.chunk_name, dead_count;
      total_dead := total_dead + dead_count;
    END IF;
  END LOOP;
  RAISE NOTICE '── Total recoverable acrel_agg_daily rows: % ──', total_dead;
END $$;
EOSQL

# ── Step 6: Recover dead tuples ──────────────────────────────────
echo ""
echo "[6/6] Recovering dead tuples into live tables..."

docker exec "$CONTAINER" psql -U "$USER" -d "$DB" <<'EOSQL'
DO $$
DECLARE
  chunk_rec RECORD;
  recovered BIGINT;
  total_recovered BIGINT := 0;
BEGIN
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '  RECOVERING acrel_readings dead tuples';
  RAISE NOTICE '════════════════════════════════════════';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_readings'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'INSERT INTO acrel_readings (
        time, org_id, site_id, terrain_id, point_id, raw,
        voltage_a, voltage_b, voltage_c,
        voltage_ab, voltage_bc, voltage_ca,
        current_a, current_b, current_c, current_sum, aftercurrent,
        active_power_a, active_power_b, active_power_c, active_power_total,
        reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
        apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
        power_factor_a, power_factor_b, power_factor_c, power_factor_total,
        frequency, voltage_unbalance, current_unbalance,
        energy_total, energy_import, energy_export,
        reactive_energy_import, reactive_energy_export,
        energy_total_a, energy_import_a, energy_export_a,
        energy_total_b, energy_import_b, energy_export_b,
        energy_total_c, energy_import_c, energy_export_c,
        energy_spike, energy_peak, energy_flat, energy_valley,
        thdu_a, thdu_b, thdu_c,
        thdi_a, thdi_b, thdi_c,
        temp_a, temp_b, temp_c, temp_n,
        di_state, do1_state, do2_state, alarm_state,
        rssi_lora, rssi_gateway, snr_gateway, f_cnt
      )
      SELECT
        time, org_id, site_id, terrain_id, point_id, raw,
        voltage_a, voltage_b, voltage_c,
        voltage_ab, voltage_bc, voltage_ca,
        current_a, current_b, current_c, current_sum, aftercurrent,
        active_power_a, active_power_b, active_power_c, active_power_total,
        reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total,
        apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total,
        power_factor_a, power_factor_b, power_factor_c, power_factor_total,
        frequency, voltage_unbalance, current_unbalance,
        energy_total, energy_import, energy_export,
        reactive_energy_import, reactive_energy_export,
        energy_total_a, energy_import_a, energy_export_a,
        energy_total_b, energy_import_b, energy_export_b,
        energy_total_c, energy_import_c, energy_export_c,
        energy_spike, energy_peak, energy_flat, energy_valley,
        thdu_a, thdu_b, thdu_c,
        thdi_a, thdi_b, thdi_c,
        temp_a, temp_b, temp_c, temp_n,
        di_state, do1_state, do2_state, alarm_state,
        rssi_lora, rssi_gateway, snr_gateway, f_cnt
      FROM pg_dirtyread(%L) AS t(
        time         timestamptz,
        org_id       uuid,
        site_id      uuid,
        terrain_id   uuid,
        point_id     uuid,
        raw          jsonb,
        voltage_a    double precision,
        voltage_b    double precision,
        voltage_c    double precision,
        voltage_ab   double precision,
        voltage_bc   double precision,
        voltage_ca   double precision,
        current_a    double precision,
        current_b    double precision,
        current_c    double precision,
        current_sum  double precision,
        aftercurrent double precision,
        active_power_a     double precision,
        active_power_b     double precision,
        active_power_c     double precision,
        active_power_total double precision,
        reactive_power_a     double precision,
        reactive_power_b     double precision,
        reactive_power_c     double precision,
        reactive_power_total double precision,
        apparent_power_a     double precision,
        apparent_power_b     double precision,
        apparent_power_c     double precision,
        apparent_power_total double precision,
        power_factor_a     double precision,
        power_factor_b     double precision,
        power_factor_c     double precision,
        power_factor_total double precision,
        frequency          double precision,
        voltage_unbalance  double precision,
        current_unbalance  double precision,
        energy_total       double precision,
        energy_import      double precision,
        energy_export      double precision,
        reactive_energy_import double precision,
        reactive_energy_export double precision,
        energy_total_a   double precision,
        energy_import_a  double precision,
        energy_export_a  double precision,
        energy_total_b   double precision,
        energy_import_b  double precision,
        energy_export_b  double precision,
        energy_total_c   double precision,
        energy_import_c  double precision,
        energy_export_c  double precision,
        energy_spike     double precision,
        energy_peak      double precision,
        energy_flat      double precision,
        energy_valley    double precision,
        thdu_a           double precision,
        thdu_b           double precision,
        thdu_c           double precision,
        thdi_a           double precision,
        thdi_b           double precision,
        thdi_c           double precision,
        temp_a           double precision,
        temp_b           double precision,
        temp_c           double precision,
        temp_n           double precision,
        di_state         bigint,
        do1_state        bigint,
        do2_state        bigint,
        alarm_state      bigint,
        rssi_lora        double precision,
        rssi_gateway     double precision,
        snr_gateway      double precision,
        f_cnt            bigint,
        dead             boolean
      ) WHERE dead = true
      ON CONFLICT (point_id, time) DO NOTHING',
      chunk_rec.full_name
    );

    GET DIAGNOSTICS recovered = ROW_COUNT;
    IF recovered > 0 THEN
      RAISE NOTICE 'Chunk %: % rows recovered', chunk_rec.chunk_name, recovered;
      total_recovered := total_recovered + recovered;
    END IF;
  END LOOP;

  RAISE NOTICE '═══ Total acrel_readings recovered: % rows ═══', total_recovered;
END $$;

-- ── Recover acrel_agg_15m ──
DO $$
DECLARE
  chunk_rec RECORD;
  recovered BIGINT;
  total_recovered BIGINT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '  RECOVERING acrel_agg_15m dead tuples';
  RAISE NOTICE '════════════════════════════════════════';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_agg_15m'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'INSERT INTO acrel_agg_15m (
        bucket_start, org_id, site_id, terrain_id, point_id,
        samples_count, active_power_avg, active_power_max,
        voltage_a_avg, energy_import_delta, energy_export_delta, energy_total_delta
      )
      SELECT
        bucket_start, org_id, site_id, terrain_id, point_id,
        samples_count, active_power_avg, active_power_max,
        voltage_a_avg, energy_import_delta, energy_export_delta, energy_total_delta
      FROM pg_dirtyread(%L) AS t(
        bucket_start        timestamptz,
        org_id              uuid,
        site_id             uuid,
        terrain_id          uuid,
        point_id            uuid,
        samples_count       int,
        active_power_avg    double precision,
        active_power_max    double precision,
        voltage_a_avg       double precision,
        energy_import_delta double precision,
        energy_export_delta double precision,
        energy_total_delta  double precision,
        dead                boolean
      ) WHERE dead = true
      ON CONFLICT (point_id, bucket_start) DO NOTHING',
      chunk_rec.full_name
    );

    GET DIAGNOSTICS recovered = ROW_COUNT;
    IF recovered > 0 THEN
      RAISE NOTICE 'Chunk %: % rows recovered', chunk_rec.chunk_name, recovered;
      total_recovered := total_recovered + recovered;
    END IF;
  END LOOP;

  RAISE NOTICE '═══ Total acrel_agg_15m recovered: % rows ═══', total_recovered;
END $$;

-- ── Recover acrel_agg_daily ──
DO $$
DECLARE
  chunk_rec RECORD;
  recovered BIGINT;
  total_recovered BIGINT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '  RECOVERING acrel_agg_daily dead tuples';
  RAISE NOTICE '════════════════════════════════════════';

  FOR chunk_rec IN
    SELECT chunk_schema || '.' || chunk_name AS full_name, chunk_name
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'acrel_agg_daily'
    ORDER BY range_start DESC
  LOOP
    EXECUTE format(
      'INSERT INTO acrel_agg_daily (
        day, org_id, site_id, terrain_id, point_id,
        samples_count, active_power_avg, active_power_max,
        energy_import_delta, energy_export_delta, energy_total_delta
      )
      SELECT
        day, org_id, site_id, terrain_id, point_id,
        samples_count, active_power_avg, active_power_max,
        energy_import_delta, energy_export_delta, energy_total_delta
      FROM pg_dirtyread(%L) AS t(
        day                 date,
        org_id              uuid,
        site_id             uuid,
        terrain_id          uuid,
        point_id            uuid,
        samples_count       int,
        active_power_avg    double precision,
        active_power_max    double precision,
        energy_import_delta double precision,
        energy_export_delta double precision,
        energy_total_delta  double precision,
        dead                boolean
      ) WHERE dead = true
      ON CONFLICT (point_id, day) DO NOTHING',
      chunk_rec.full_name
    );

    GET DIAGNOSTICS recovered = ROW_COUNT;
    IF recovered > 0 THEN
      RAISE NOTICE 'Chunk %: % rows recovered', chunk_rec.chunk_name, recovered;
      total_recovered := total_recovered + recovered;
    END IF;
  END LOOP;

  RAISE NOTICE '═══ Total acrel_agg_daily recovered: % rows ═══', total_recovered;
END $$;
EOSQL

# ── Re-enable autovacuum ─────────────────────────────────────────
echo ""
echo "Re-enabling autovacuum..."
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "
  ALTER TABLE acrel_readings SET (autovacuum_enabled = true);
  ALTER TABLE acrel_agg_15m  SET (autovacuum_enabled = true);
  ALTER TABLE acrel_agg_daily SET (autovacuum_enabled = true);
"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Recovery complete!"
echo "═══════════════════════════════════════════════"
echo ""
echo "If dead tuples were found and recovered, the data"
echo "is now back in the live tables. You can verify with:"
echo "  docker exec $CONTAINER psql -U $USER -d $DB \\"
echo "    -c \"SELECT count(*) FROM acrel_readings;\""
echo ""
echo "If 0 dead tuples were found, autovacuum or VACUUM"
echo "has already cleaned up the deleted rows permanently."
