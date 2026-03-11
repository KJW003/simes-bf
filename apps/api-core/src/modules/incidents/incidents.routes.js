const express = require('express');
const router = express.Router();
const { corePool: db } = require('../../config/db');
const log = require("../../config/logger");

// GET /incidents — list incidents with optional filters
router.get('/incidents', async (req, res) => {
  try {
    const { status, severity, terrain_id, source, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) { conditions.push(`i.status = $${idx++}`); params.push(status); }
    if (severity) { conditions.push(`i.severity = $${idx++}`); params.push(severity); }
    if (terrain_id) { conditions.push(`i.terrain_id = $${idx++}`); params.push(terrain_id); }
    if (source) { conditions.push(`i.source = $${idx++}`); params.push(source); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limitVal = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offsetVal = Math.max(Number(offset) || 0, 0);

    const { rows } = await db.query(`
      SELECT i.*, u.name AS assigned_name, t.name AS terrain_name
      FROM incidents i
      LEFT JOIN users u ON u.id = i.assigned_to
      LEFT JOIN terrains t ON t.id = i.terrain_id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limitVal, offsetVal]);

    const countRes = await db.query(`SELECT count(*)::int FROM incidents i ${where}`, params);

    res.json({ ok: true, incidents: rows, total: countRes.rows[0].count });
  } catch (e) {
    log.error({ err: e.message }, "[incidents] list error:");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /incidents/stats — summary counts by status/severity
router.get('/incidents/stats', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT status, severity, count(*)::int AS count
      FROM incidents
      GROUP BY status, severity
      ORDER BY status, severity
    `);
    const open = rows.filter(r => r.status === 'open').reduce((s, r) => s + r.count, 0);
    const critical = rows.filter(r => r.severity === 'critical' && r.status !== 'resolved').reduce((s, r) => s + r.count, 0);
    res.json({ ok: true, breakdown: rows, open_count: open, critical_count: critical, total: rows.reduce((s, r) => s + r.count, 0) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /incidents/:id
router.get('/incidents/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT i.*, u.name AS assigned_name, t.name AS terrain_name,
             ru.name AS resolved_by_name
      FROM incidents i
      LEFT JOIN users u ON u.id = i.assigned_to
      LEFT JOIN users ru ON ru.id = i.resolved_by
      LEFT JOIN terrains t ON t.id = i.terrain_id
      WHERE i.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Incident not found' });
    res.json({ ok: true, incident: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /incidents — create
router.post('/incidents', async (req, res) => {
  try {
    const { title, description, severity, source, terrain_id, point_id, assigned_to, metadata } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title is required' });

    const { rows } = await db.query(`
      INSERT INTO incidents (title, description, severity, source, terrain_id, point_id, assigned_to, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [title, description || '', severity || 'warning', source || '', terrain_id || null, point_id || null, assigned_to || null, metadata || {}]);

    res.status(201).json({ ok: true, incident: rows[0] });
  } catch (e) {
    log.error({ err: e.message }, "[incidents] create error:");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /incidents/:id — update (status, assign, resolve)
router.patch('/incidents/:id', async (req, res) => {
  try {
    const { status, severity, assigned_to, description, metadata } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;

    if (status) { sets.push(`status = $${idx++}`); params.push(status); }
    if (severity) { sets.push(`severity = $${idx++}`); params.push(severity); }
    if (assigned_to !== undefined) { sets.push(`assigned_to = $${idx++}`); params.push(assigned_to || null); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(metadata); }

    if (status === 'resolved') {
      sets.push(`resolved_at = now()`);
      sets.push(`resolved_by = $${idx++}`);
      params.push(req.user?.id || null);
    }

    sets.push('updated_at = now()');
    params.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE incidents SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Incident not found' });
    res.json({ ok: true, incident: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
