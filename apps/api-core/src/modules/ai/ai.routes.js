const express = require('express');
const router = express.Router();
const { corePool } = require('../../config/db');
const log = require('../../config/logger');

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

// GET /ai/forecast/:terrainId?days=7 — get forecast (auto-trains if needed)
router.get('/ai/forecast/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));

    // ml-service now auto-trains when no model exists; 404 should no longer occur
    const resp = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terrain_id: terrainId, days }),
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      log.error({ status: resp.status, text }, 'ml-service /predict returned non-JSON');
      return res.status(502).json({ error: 'ML service bad response', detail: text });
    }

    if (resp.status === 422) {
      // Insufficient data for training
      return res.status(422).json(data);
    }

    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    log.error({ error: err.message }, 'ML predict failed');
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

// POST /ai/anomalies/detect/:terrainId — trigger anomaly detection
router.post('/ai/anomalies/detect/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const resp = await fetch(`${ML_SERVICE_URL}/anomalies/detect/${terrainId}`, { method: 'POST' });
    const data = await resp.json();
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// GET /ai/anomalies/:terrainId?days=30 — get anomalies
router.get('/ai/anomalies/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const resp = await fetch(`${ML_SERVICE_URL}/anomalies/${terrainId}?days=${days}`);
    const data = await resp.json();
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Hourly Forecast Endpoints (backend-computed, replaces frontend logic)
// ──────────────────────────────────────────────────────────────────────────────

// GET /ai/forecast/hourly/:terrainId — 24-hour forecast curve (J+1 to J+7)
router.get('/ai/forecast/hourly/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const params = new URLSearchParams();
    if (req.query.days) params.set('days', Math.min(7, Math.max(1, parseInt(req.query.days, 10) || 1)).toString());
    if (req.query.point_id) params.set('point_id', req.query.point_id);
    if (req.query.history_days) params.set('history_days', Math.min(90, Math.max(7, parseInt(req.query.history_days, 10) || 14)).toString());

    const url = `${ML_SERVICE_URL}/forecast/hourly/${terrainId}?${params.toString()}`;
    const resp = await fetch(url);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) { return res.status(502).json({ error: 'ML service bad response', detail: text }); }
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    log.error({
      endpoint: '/ai/forecast/hourly/:terrainId',
      terrainId: req.params.terrainId,
      ml_service_url: ML_SERVICE_URL,
      error: err.message,
      stack: err.stack,
      code: err.code,
      errno: err.errno
    }, 'Forecast hourly endpoint error');
    res.status(503).json({ 
      error: 'ML service unavailable', 
      detail: err.message,
      ml_service_url: ML_SERVICE_URL 
    });
  }
});

// GET /ai/forecast/profiles/:terrainId — today/yesterday hourly actuals for comparison
router.get('/ai/forecast/profiles/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const params = new URLSearchParams();
    if (req.query.point_id) params.set('point_id', req.query.point_id);

    const url = `${ML_SERVICE_URL}/forecast/profiles/${terrainId}?${params.toString()}`;
    const resp = await fetch(url);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) { return res.status(502).json({ error: 'ML service bad response', detail: text }); }
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    log.error({
      endpoint: '/ai/forecast/profiles/:terrainId',
      terrainId: req.params.terrainId,
      ml_service_url: ML_SERVICE_URL,
      error: err.message,
      stack: err.stack,
      code: err.code,
      errno: err.errno
    }, 'Forecast profiles endpoint error');
    res.status(503).json({ 
      error: 'ML service unavailable', 
      detail: err.message,
      ml_service_url: ML_SERVICE_URL 
    });
  }
});

// GET /ai/forecast/daily-chart/:terrainId — combined history + forecast for chart
router.get('/ai/forecast/daily-chart/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const params = new URLSearchParams();
    if (req.query.history_days) params.set('history_days', Math.min(90, Math.max(7, parseInt(req.query.history_days, 10) || 14)).toString());
    if (req.query.forecast_days) params.set('forecast_days', Math.min(7, Math.max(1, parseInt(req.query.forecast_days, 10) || 3)).toString());

    const url = `${ML_SERVICE_URL}/forecast/daily-chart/${terrainId}?${params.toString()}`;
    const resp = await fetch(url);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) { return res.status(502).json({ error: 'ML service bad response', detail: text }); }
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    log.error({
      endpoint: '/ai/forecast/daily-chart/:terrainId',
      terrainId: req.params.terrainId,
      ml_service_url: ML_SERVICE_URL,
      error: err.message,
      stack: err.stack,
      code: err.code,
      errno: err.errno
    }, 'Forecast daily-chart endpoint error');
    res.status(503).json({ 
      error: 'ML service unavailable', 
      detail: err.message,
      ml_service_url: ML_SERVICE_URL 
    });
  }
});

module.exports = router;
