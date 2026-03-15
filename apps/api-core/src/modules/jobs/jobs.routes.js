const express = require("express");
const {corePool} = require("../../config/db");
const { pickQueue, JobTypes } = require("../../jobs/dispatch");
const { requireAuth, requireRole, verifyTerrainAccess } = require("../../shared/auth-middleware");
const { auditLog } = require("../../shared/audit-log");

const router = express.Router();

async function createRunAndEnqueue(type, payload) {
  const safePayload = payload ?? {};
  const ins = await corePool.query(
    `INSERT INTO runs (type, status, payload)
     VALUES ($1, 'queued', $2::jsonb)
     RETURNING id, type, status, created_at`,
    [type, JSON.stringify(safePayload)]
  );

  const run = ins.rows[0];
  const queue = pickQueue(type);

  await queue.add(type, { runId: run.id, payload: safePayload }, { attempts: 1 });

  return run;
}

async function findQueueJobByRunId(queue, runId) {
  if (!queue || typeof queue.getJobs !== "function") return null;

  const states = ["wait", "delayed", "prioritized", "active", "paused"];
  const jobs = await queue.getJobs(states, 0, 200);
  return jobs.find((job) => job?.data?.runId === runId) || null;
}

// GET /jobs
// - platform_super_admin: can see all runs
// - others: only runs tied to terrains in their organization
router.get("/jobs", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    if (req.userRole === "platform_super_admin") {
      const r = await corePool.query(
        `SELECT id, type, status, payload, error, created_at, started_at, finished_at
         FROM runs
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return res.json({ ok: true, count: r.rows.length, jobs: r.rows });
    }

    const r = await corePool.query(
      `SELECT r.id, r.type, r.status, r.payload, r.error, r.created_at, r.started_at, r.finished_at
       FROM runs r
       JOIN terrains t
         ON (r.payload->>'terrain_id') ~* '^[0-9a-f-]{36}$'
        AND t.id = (r.payload->>'terrain_id')::uuid
       JOIN sites s ON s.id = t.site_id
       JOIN users u ON u.organization_id = s.organization_id
      WHERE u.id = $1
      ORDER BY r.created_at DESC
      LIMIT $2`,
      [req.userId, limit]
    );

    return res.json({ ok: true, count: r.rows.length, jobs: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /jobs/cancel/:jobId
// Best effort: mark run as cancelled and remove queued BullMQ job if still waiting.
router.post("/jobs/cancel/:jobId", requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;

    const runRes = await corePool.query(
      `SELECT id, type, status, payload FROM runs WHERE id = $1 LIMIT 1`,
      [jobId]
    );
    if (!runRes.rows.length) {
      return res.status(404).json({ ok: false, error: "job not found" });
    }

    const run = runRes.rows[0];
    const terrainId = run.payload?.terrain_id || null;

    if (req.userRole !== "platform_super_admin") {
      if (!terrainId) {
        return res.status(403).json({ ok: false, error: "Access denied: job is not tied to your terrain scope" });
      }

      const access = await corePool.query(
        `SELECT t.id
         FROM terrains t
         JOIN sites s ON s.id = t.site_id
         JOIN users u ON u.organization_id = s.organization_id
         WHERE t.id = $1 AND u.id = $2
         LIMIT 1`,
        [terrainId, req.userId]
      );
      if (!access.rows.length) {
        return res.status(403).json({ ok: false, error: "Access denied" });
      }
    }

    if (["success", "failed", "cancelled"].includes(run.status)) {
      return res.status(409).json({ ok: false, error: `Cannot cancel job in status '${run.status}'` });
    }

    let queueJobRemoved = false;
    const queue = pickQueue(run.type);
    const queueJob = await findQueueJobByRunId(queue, run.id);
    if (queueJob) {
      try {
        await queueJob.remove();
        queueJobRemoved = true;
      } catch {
        queueJobRemoved = false;
      }
    }

    await corePool.query(
      `UPDATE runs
          SET status = 'cancelled',
              error = COALESCE(error, 'Cancelled by user'),
              finished_at = NOW()
        WHERE id = $1`,
      [run.id]
    );

    auditLog('warn', 'api', `Job cancelled: ${run.id}`, { runType: run.type, queueJobRemoved }, req.userId);

    return res.json({ ok: true, jobId: run.id, cancelled: true, queueJobRemoved });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/forecast", requireAuth, requireRole("platform_super_admin", "org_admin"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.FORECAST, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/facture", verifyTerrainAccess("body.terrain_id"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.FACTURE, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/audit-pv", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainAccess("body.terrain_id"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.AUDIT_PV, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/roi", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainAccess("body.terrain_id"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.ROI, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/report", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainAccess("body.terrain_id"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.REPORT, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/aggregate", requireAuth, requireRole("platform_super_admin"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.AGGREGATE, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/jobs/disk-recovery", requireAuth, requireRole("platform_super_admin"), async (req, res) => {
  try {
    const run = await createRunAndEnqueue(JobTypes.DISK_RECOVERY, req.body);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
module.exports = router;
