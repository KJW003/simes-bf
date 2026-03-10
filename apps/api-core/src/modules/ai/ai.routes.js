const express = require('express');
const router = express.Router();
const { corePool } = require('../../config/db');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';

// Verify user has access to terrain via org membership
async function verifyTerrainAccess(req, res, next) {
  try {
    const { terrainId } = req.params;
    if (!terrainId) return res.status(400).json({ error: 'Missing terrainId' });

    // platform_super_admin can access all terrains
    if (req.userRole === 'platform_super_admin') return next();

    const result = await corePool.query(
      `SELECT t.id FROM terrains t
       JOIN sites s ON s.id = t.site_id
       JOIN users u ON u.organization_id = s.organization_id
       WHERE t.id = $1 AND u.id = $2
       LIMIT 1`,
      [terrainId, req.userId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: 'Access denied: you do not belong to this terrain\'s organisation' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Access check failed', detail: err.message });
  }
}

// POST /ai/train/:terrainId — trigger model training
router.post('/ai/train/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;

    const resp = await fetch(`${ML_SERVICE_URL}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terrain_id: terrainId }),
    });
    const data = await resp.json();
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// GET /ai/forecast/:terrainId?days=7 — get forecast
router.get('/ai/forecast/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));

    const resp = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terrain_id: terrainId, days }),
    });

    if (resp.status === 404) {
      return res.status(404).json({ error: 'No model trained for this terrain' });
    }

    const data = await resp.json();
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// GET /ai/model/:terrainId — model status
router.get('/ai/model/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;

    const resp = await fetch(`${ML_SERVICE_URL}/models/${terrainId}/status`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

module.exports = router;
