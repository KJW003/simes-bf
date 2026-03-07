// ============================================================
// Worker audit logging — writes to audit_logs table via core DB
// ============================================================
const { db } = require("./shared");

/**
 * Write an audit log entry to the database from worker context.
 * @param {'info'|'warn'|'error'} level
 * @param {'worker'|'system'} source
 * @param {string} message
 * @param {object} [metadata]
 */
async function auditLog(level, source, message, metadata = {}) {
  if (!db) return;
  try {
    await db.query(
      `INSERT INTO audit_logs (level, source, message, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [level, source, message, JSON.stringify(metadata)]
    );
  } catch (e) {
    console.error("[audit-log/worker] insert failed:", e.message);
  }
}

module.exports = { auditLog };
