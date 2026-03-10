#!/usr/bin/env node
/**
 * SIMES-BF Database Migration Runner
 *
 * Applies numbered SQL migration files from infra/db/migrations/
 * to the target database, tracked via a schema_migrations table.
 *
 * Usage:
 *   node migrate.js [--db core|telemetry]    Apply pending migrations
 *   node migrate.js --status                 Show migration status
 *
 * Environment:
 *   CORE_DB_URL       – connection string for core-db
 *   TELEMETRY_DB_URL  – connection string for telemetry-db
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

function getPool(target) {
  const url = target === 'telemetry'
    ? process.env.TELEMETRY_DB_URL
    : process.env.CORE_DB_URL;
  if (!url) {
    console.error(`Missing ${target === 'telemetry' ? 'TELEMETRY_DB_URL' : 'CORE_DB_URL'} env var`);
    process.exit(1);
  }
  return new Pool({ connectionString: url });
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function fileChecksum(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function getAppliedMigrations(pool) {
  const r = await pool.query('SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename');
  return new Map(r.rows.map(row => [row.filename, row]));
}

async function runMigrations(target) {
  const pool = getPool(target);
  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const files = getMigrationFiles();

    // Filter by target: core migrations = 0xx_core_*, telemetry = 0xx_telemetry_* | 0xx_agg_*
    const targetFiles = files.filter(f => {
      const lower = f.toLowerCase();
      if (target === 'telemetry') return lower.includes('telemetry') || lower.includes('agg');
      return !lower.includes('telemetry') || lower.includes('core');
    });

    let appliedCount = 0;
    for (const file of targetFiles) {
      if (applied.has(file)) {
        const expectedChecksum = fileChecksum(path.join(MIGRATIONS_DIR, file));
        if (applied.get(file).checksum !== expectedChecksum) {
          console.warn(`⚠ Checksum mismatch for ${file} (was modified after applying)`);
        }
        continue;
      }

      const filepath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filepath, 'utf-8');
      const checksum = fileChecksum(filepath);

      console.log(`Applying: ${file}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
        appliedCount++;
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file}: ${err.message}`);
        process.exit(1);
      } finally {
        client.release();
      }
    }

    if (appliedCount === 0) {
      console.log(`${target}-db: all migrations already applied`);
    } else {
      console.log(`${target}-db: ${appliedCount} migration(s) applied`);
    }
  } finally {
    await pool.end();
  }
}

async function showStatus() {
  for (const target of ['core', 'telemetry']) {
    const url = target === 'telemetry' ? process.env.TELEMETRY_DB_URL : process.env.CORE_DB_URL;
    if (!url) { console.log(`${target}-db: not configured`); continue; }

    const pool = new Pool({ connectionString: url });
    try {
      await ensureMigrationsTable(pool);
      const applied = await getAppliedMigrations(pool);
      const files = getMigrationFiles();

      console.log(`\n── ${target}-db ──`);
      for (const file of files) {
        const row = applied.get(file);
        const status = row ? `✓ applied ${new Date(row.applied_at).toISOString().slice(0, 16)}` : '○ pending';
        console.log(`  ${status}  ${file}`);
      }
    } finally {
      await pool.end();
    }
  }
}

// ── CLI ──
require('dotenv').config();

const args = process.argv.slice(2);
if (args.includes('--status')) {
  showStatus().catch(e => { console.error(e); process.exit(1); });
} else {
  const target = args.includes('--db')
    ? args[args.indexOf('--db') + 1]
    : 'core';
  if (!['core', 'telemetry'].includes(target)) {
    console.error('Usage: node migrate.js [--db core|telemetry] | --status');
    process.exit(1);
  }
  runMigrations(target).catch(e => { console.error(e); process.exit(1); });
}
