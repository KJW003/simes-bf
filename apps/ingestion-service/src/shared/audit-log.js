// ============================================================
// Ingestion service audit logging — writes to audit_logs table
// ============================================================
const { corePool } = require("../config/db");

/**
 * Write an audit log entry to the database from ingestion context.
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [metadata]
 */
async function auditLog(level, message, metadata = {}) {
  if (!corePool) return;
  try {
    await corePool.query(
      `INSERT INTO audit_logs (level, source, message, metadata)
       VALUES ($1, 'ingestion', $2, $3::jsonb)`,
      [level, message, JSON.stringify(metadata)]
    );
  } catch (e) {
    console.error("[audit-log/ingestion] insert failed:", e.message);
  }
}

module.exports = { auditLog };
