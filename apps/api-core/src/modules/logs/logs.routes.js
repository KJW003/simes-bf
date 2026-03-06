const express = require('express');
const router = express.Router();
const { corePool: db } = require('../../config/db');

// GET /logs — list audit logs with filters
router.get('/logs', async (req, res) => {
  try {
    const { level, source, search, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (level) { conditions.push(`level = $${idx++}`); params.push(level); }
    if (source) { conditions.push(`source = $${idx++}`); params.push(source); }
    if (search) { conditions.push(`message ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limitVal = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offsetVal = Math.max(Number(offset) || 0, 0);

    const { rows } = await db.query(`
      SELECT l.*, u.name AS user_name
      FROM audit_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limitVal, offsetVal]);

    const countRes = await db.query(`SELECT count(*)::int FROM audit_logs ${where}`, params);

    res.json({ ok: true, logs: rows, total: countRes.rows[0].count });
  } catch (e) {
    console.error('[logs] list error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /logs/stats — counts by level
router.get('/logs/stats', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT level, count(*)::int AS count
      FROM audit_logs
      WHERE created_at > now() - interval '24 hours'
      GROUP BY level
    `);
    res.json({ ok: true, stats: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
