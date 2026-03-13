/**
 * NEW ENDPOINT: GET /results/facture/monthly
 * Monthly invoice retrieval with month selector
 * 
 * Usage:
 *   GET /results/facture/monthly?terrainId=<UUID>&year=2026&month=3
 *   → Returns stored invoice for March 2026
 *
 *   GET /results/facture/monthly?terrainId=<UUID>&mode=today
 *   → Real-time: current day consumption billed at monthly rates
 * 
 * SECURITY: verifyTerrainAccess() prevents cross-org access
 */

const express = require("express");
const router = express.Router();
const { corePool } = require("../../config/db");
const { requireAuth } = require("../../shared/auth-middleware");
const { verifyTerrainAccess } = require("../../shared/auth-middleware");
const { Queue } = require("bullmq");
const IORedis = require("ioredis");

// Connect to Redis for job submission
const redisClient = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { 
  maxRetriesPerRequest: null 
});
const aiQueue = new Queue("ai", { connection: redisClient });

/**
 * GET /results/facture/monthly
 * Retrieve monthly invoice for a specific month or today-only estimate
 */
router.get("/results/facture/monthly", 
  requireAuth,
  verifyTerrainAccess("query.terrainId"),  // Security: Verify user owns this terrain
  async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const startTime = Date.now();
    
    try {
      const { terrainId, year, month, mode } = req.query;

      // Validate terrain ID
      if (!terrainId) {
        await logAuditEvent(req.userId, 'view', 'facture_monthly', 'invalid', { error: 'missing_terrainId' }, clientIp);
        return res.status(400).json({ 
          ok: false,
          error: "terrainId parameter required"
        });
      }

      // Mode: "today" (real-time) or standard month view
      if (mode === "today") {
        // Real-time: calculate today's consumption billed at full monthly rates
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        try {
          // Create a run record first
          const runRecord = await corePool.query(
            `INSERT INTO runs (type, status, payload)
             VALUES ('facture', 'queued', $1::jsonb)
             RETURNING id`,
            [JSON.stringify({
              terrain_id: terrainId,
              year: currentYear,
              month: currentMonth,
              mode: "today"
            })]
          );
          const runId = runRecord.rows[0].id;

          // Submit job to compute today's invoice
          const job = await aiQueue.add(
            "facture",
            {
              runId,  // Pass runId so worker can track result
              payload: {
                terrain_id: terrainId,
                year: currentYear,
                month: currentMonth,
                mode: "today",  // Signal to worker
              }
            },
            {
              jobId: runId,  // Use same ID for tracking
              attempts: 1,
              removeOnComplete: 60000,  // Keep job for 60s before removal
            }
          );

          // Poll for result (check database directly instead of job state)
          let result = null;
          let attempts = 0;
          const maxAttempts = 60;  // 60 seconds max (1s per attempt)

          while (attempts < maxAttempts && !result) {
            // Check database FIRST (most reliable source)
            const runRow = await corePool.query(
              `SELECT result, status FROM runs WHERE id = $1`,
              [runId]
            );
            
            if (runRow.rows.length && runRow.rows[0].result && runRow.rows[0].status === 'success') {
              const dbResult = runRow.rows[0].result;
              result = typeof dbResult === 'string' ? JSON.parse(dbResult) : dbResult;
              break;  // Found result, exit immediately
            }
            
            // Then check job state as supplementary info
            const jobState = await job.getState().catch(() => null);
            
            if (jobState === "failed") {
              await logAuditEvent(req.userId, 'view', 'facture_today', terrainId, { 
                error: 'computation_failed',
                reason: job.failedReason 
              }, clientIp);
              return res.status(500).json({ 
                ok: false,
                error: "Computation failed",
                details: job.failedReason
              });
            }
            
            // Wait before next check
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
          }

          if (!result) {
            // Final check - fetch from DB one more time
            const finalCheck = await corePool.query(
              `SELECT result FROM runs WHERE id = $1`,
              [runId]
            );
            if (finalCheck.rows.length && finalCheck.rows[0].result) {
              const dbResult = finalCheck.rows[0].result;
              result = typeof dbResult === 'string' ? JSON.parse(dbResult) : dbResult;
            }
          }

          if (!result) {
            await logAuditEvent(req.userId, 'view', 'facture_today', terrainId, { 
              error: 'computation_timeout'
            }, clientIp);
            return res.status(503).json({ 
              ok: false,
              error: "Computation timeout - please try again"
            });
          }

          // Log successful access for audit
          await logAuditEvent(req.userId, 'view', 'facture_today', terrainId, { 
            year: currentYear, 
            month: currentMonth,
            duration_ms: Date.now() - startTime
          }, clientIp);

          // Return the actual computation result
          return res.json({
            ok: true,
            mode: "today",
            ...result,  // Spread the actual computation result (totalKwh, totalAmount, breakdown, etc.)
            computedAt: new Date().toISOString(),
          });

        } catch (err) {
          console.error("Today mode computation error:", err);
          await logAuditEvent(req.userId, 'view', 'facture_today', terrainId, { 
            error: 'exception',
            message: err.message 
          }, clientIp);
          return res.status(500).json({ 
            ok: false,
            error: "Failed to compute today's invoice"
          });
        }
      }

      // Standard mode: retrieve stored monthly invoice
      if (!year || !month || month < 1 || month > 12) {
        await logAuditEvent(req.userId, 'view', 'facture_monthly', 'invalid', { 
          error: 'invalid_parameters',
          year, 
          month 
        }, clientIp);
        return res.status(400).json({ 
          ok: false,
          error: "year and month (1-12) parameters required for standard mode"
        });
      }

      // Query facture_monthly table
      const invoiceQuery = await corePool.query(`
        SELECT 
          id,
          terrain_id,
          year,
          month,
          data,
          status,
          updated_at,
          computed_at
        FROM facture_monthly
        WHERE terrain_id = $1 AND year = $2 AND month = $3
        LIMIT 1
      `, [terrainId, parseInt(year), parseInt(month)]);

      if (!invoiceQuery.rows.length) {
        await logAuditEvent(req.userId, 'view', 'facture_monthly', terrainId, { 
          error: 'not_found',
          year: parseInt(year),
          month: parseInt(month)
        }, clientIp);
        return res.status(404).json({ 
          ok: false,
          error: `No invoice found for ${year}-${String(month).padStart(2, '0')}`
        });
      }

      const invoice = invoiceQuery.rows[0];
      const invoiceData = typeof invoice.data === 'string' ? JSON.parse(invoice.data) : invoice.data;

      // Log successful access for audit
      await logAuditEvent(req.userId, 'view', 'facture_monthly', invoice.id, { 
        year: parseInt(year), 
        month: parseInt(month),
        status: invoice.status,
        duration_ms: Date.now() - startTime
      }, clientIp);

      // Return same format as mode=today: spread invoice data directly for consistency
      res.json({
        ok: true,
        mode: "month",
        ...invoiceData,  // Spread calculation results directly (totalAmount, totalKwh, breakdown, etc.)
        computedAt: invoice.computed_at || invoice.updated_at,
        daysInMonth: getDaysInMonth(parseInt(year), parseInt(month)),
      });

    } catch (e) {
      console.error("GET /results/facture/monthly error:", e);
      await logAuditEvent(req.userId, 'view', 'facture_monthly', 'error', { 
        error: 'exception',
        message: e.message 
      }, clientIp);
      res.status(500).json({ 
        ok: false, 
        error: e.message 
      });
    }
});

/**
 * GET /results/facture/monthly/months
 * List available months for a terrain (for month selector UI)
 */
router.get("/results/facture/monthly/months",
  requireAuth,
  verifyTerrainAccess("query.terrainId"),
  async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    try {
      const { terrainId } = req.query;

      if (!terrainId) {
        await logAuditEvent(req.userId, 'list', 'facture_months', 'invalid', { error: 'missing_terrainId' }, clientIp);
        return res.status(400).json({ 
          ok: false,
          error: "terrainId required"
        });
      }

      // Get all months with invoices for this terrain
      const monthsQuery = await corePool.query(`
        SELECT DISTINCT year, month, updated_at, status
        FROM facture_monthly
        WHERE terrain_id = $1
        ORDER BY year DESC, month DESC
        LIMIT 24  -- Last 24 months
      `, [terrainId]);

      // Log successful access
      await logAuditEvent(req.userId, 'list', 'facture_months', terrainId, { 
        months_count: monthsQuery.rows.length 
      }, clientIp);

      res.json({
        ok: true,
        months: monthsQuery.rows.map(row => ({
          year: row.year,
          month: row.month,
          display: `${row.year}-${String(row.month).padStart(2, '0')}`,
          status: row.status,
          lastUpdated: row.updated_at,
        })),
      });

    } catch (e) {
      console.error("GET /results/facture/monthly/months error:", e);
      await logAuditEvent(req.userId, 'list', 'facture_months', 'error', { 
        error: 'exception',
        message: e.message 
      }, clientIp);
      res.status(500).json({ 
        ok: false,
        error: e.message
      });
    }
});

/**
 * Helper: Log audit event to database
 */
async function logAuditEvent(userId, action, resourceType, resourceId, details, clientIp) {
  try {
    await corePool.query(`
      INSERT INTO audit_facture (user_id, action, resource_type, resource_id, details, client_ip, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [userId, action, resourceType, resourceId, JSON.stringify(details), clientIp]);
  } catch (err) {
    console.error("Error logging audit event:", err);
    // Don't throw - audit logging shouldn't break the request
  }
}

// Helper function: days in month
function getDaysInMonth(year, month) {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return isLeap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

module.exports = router;
