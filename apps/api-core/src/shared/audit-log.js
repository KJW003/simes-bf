// ============================================================
// Centralized audit logging — writes to audit_logs table
// ============================================================
const { corePool } = require("../config/db");
const log = require("../config/logger");

/**
 * Write an audit log entry to the database.
 * @param {'info'|'warn'|'error'} level
 * @param {'api'|'ingestion'|'worker'|'system'} source
 * @param {string} message
 * @param {object} [metadata]
 * @param {string|null} [userId]
 */
async function auditLog(level, source, message, metadata = {}, userId = null) {
  if (!corePool) return; // DB not available
  try {
    await corePool.query(
      `INSERT INTO audit_logs (level, source, message, metadata, user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [level, source, message, JSON.stringify(metadata), userId]
    );
  } catch (e) {
    // Never let logging break the caller
    log.error({ err: e.message }, 'audit-log insert failed');
  }
}

module.exports = { auditLog };
