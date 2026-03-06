const express = require('express');
const router = express.Router();
const {corePool: db, telemetryPool} = require('../../config/db');
const redis = require('../../config/redis');

router.get('/health', (req, res) => {
  res.json({ status: 'API CORE is OK' });
});

router.get('/health/db', async (req, res) => {
  try {
    const r = await db.query('SELECT NOW() as now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Pipeline health — checks all components
router.get('/health/pipeline', async (req, res) => {
  const components = [];

  // Core DB
  try {
    const t0 = Date.now();
    const r = await db.query('SELECT NOW() as now');
    components.push({ name: 'Core DB', status: 'up', latency_ms: Date.now() - t0, detail: r.rows[0].now });
  } catch (e) {
    components.push({ name: 'Core DB', status: 'down', latency_ms: null, detail: e.message });
  }

  // Telemetry DB
  if (telemetryPool) {
    try {
      const t0 = Date.now();
      const r = await telemetryPool.query('SELECT NOW() as now');
      components.push({ name: 'Telemetry DB', status: 'up', latency_ms: Date.now() - t0, detail: r.rows[0].now });
    } catch (e) {
      components.push({ name: 'Telemetry DB', status: 'down', latency_ms: null, detail: e.message });
    }
  } else {
    components.push({ name: 'Telemetry DB', status: 'disabled', latency_ms: null, detail: 'Pool not configured' });
  }

  // Redis
  if (redis) {
    try {
      const t0 = Date.now();
      await redis.ping();
      components.push({ name: 'Redis', status: 'up', latency_ms: Date.now() - t0, detail: 'PONG' });
    } catch (e) {
      components.push({ name: 'Redis', status: 'down', latency_ms: null, detail: e.message });
    }
  } else {
    components.push({ name: 'Redis', status: 'disabled', latency_ms: null, detail: 'Client not configured' });
  }

  // BullMQ queue stats (via Redis)
  if (redis) {
    try {
      const queues = ['telemetry', 'ai', 'reports'];
      for (const q of queues) {
        const waiting = await redis.llen(`bull:${q}:wait`);
        const active = await redis.llen(`bull:${q}:active`);
        const failed = await redis.zcard(`bull:${q}:failed`);
        const completed = await redis.zcard(`bull:${q}:completed`);
        components.push({
          name: `Queue: ${q}`,
          status: failed > 10 ? 'degraded' : 'up',
          latency_ms: null,
          detail: { waiting, active, failed, completed },
        });
      }
    } catch (e) {
      components.push({ name: 'BullMQ Queues', status: 'error', latency_ms: null, detail: e.message });
    }
  }

  // Recent telemetry throughput
  if (telemetryPool) {
    try {
      const r = await telemetryPool.query(`
        SELECT count(*)::int as count_1h,
               max(time) as latest
        FROM acrel_readings
        WHERE time > now() - interval '1 hour'
      `);
      components.push({
        name: 'Telemetry Throughput',
        status: r.rows[0].count_1h > 0 ? 'up' : 'warning',
        latency_ms: null,
        detail: { readings_last_hour: r.rows[0].count_1h, latest: r.rows[0].latest },
      });
    } catch (e) {
      components.push({ name: 'Telemetry Throughput', status: 'error', latency_ms: null, detail: e.message });
    }
  }

  const allUp = components.every(c => c.status === 'up' || c.status === 'disabled');
  res.json({ ok: allUp, components, checked_at: new Date().toISOString() });
});

module.exports = router;
