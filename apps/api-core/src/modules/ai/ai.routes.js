const express = require('express');
const router = express.Router();
const { corePool } = require('../../config/db');
const log = require('../../config/logger');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';
const ML_FETCH_TIMEOUT_MS = Math.max(1000, parseInt(process.env.ML_FETCH_TIMEOUT_MS || '15000', 10) || 15000);

async function fetchML(path, options = {}, authToken = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ML_FETCH_TIMEOUT_MS);
  try {
    const headers = options.headers || {};
    if (authToken) {
      headers.Authorization = authToken;
    }
    return await fetch(`${ML_SERVICE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function fmtDay(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function buildZeroDailyForecast(days) {
  const out = [];
  const now = new Date();
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    out.push({ day: fmtDay(d), predicted_kwh: 0, lower: 0, upper: 0 });
  }
  return out;
}

function buildHourlyFallback(terrainId, days, detail, pointId) {
  const now = new Date();
  const hourlyForecast = [];
  const dailyForecast = [];
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const day = fmtDay(d);
    const dayIso = d.toISOString().slice(0, 10);
    hourlyForecast.push({
      day,
      day_iso: dayIso,
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, predicted_kw: 0, lower: 0, upper: 0 })),
    });
    dailyForecast.push({ day, day_iso: dayIso, predicted_kwh: 0, lower: 0, upper: 0 });
  }

  return {
    terrain_id: terrainId,
    point_id: pointId || null,
    model_type: 'fallback_insufficient_data',
    confidence_level: 0,
    data_days: 0,
    daily_avg_kw: 0,
    trend_per_day: 0,
    warnings: [
      'Donnees insuffisantes pour une prevision fiable',
      detail ? `Detail: ${detail}` : 'Aucune donnee exploitable pour ce terrain',
    ],
    hourly_forecast: hourlyForecast,
    daily_forecast: dailyForecast,
    history_summary: { n_days: 0, daily_avg: 0, std_dev: 0, slope: 0 },
  };
}

function buildProfilesFallback(terrainId, pointId, detail) {
  return {
    terrain_id: terrainId,
    point_id: pointId || null,
    warnings: [
      'Profils indisponibles (donnees insuffisantes)',
      detail ? `Detail: ${detail}` : undefined,
    ].filter(Boolean),
    today: Array.from({ length: 24 }, (_, h) => ({ hour: h, kw: null })),
    yesterday: Array.from({ length: 24 }, (_, h) => ({ hour: h, kw: null })),
  };
}

function buildDailyChartFallback(terrainId, forecastDays, detail) {
  const now = new Date();
  const chartData = [];
  for (let i = 1; i <= forecastDays; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    chartData.push({
      day: fmtDay(d),
      day_iso: d.toISOString().slice(0, 10),
      actual_kwh: null,
      actual_max: null,
      predicted_kwh: 0,
      upper: 0,
      lower: 0,
      type: 'forecast',
    });
  }
  return {
    terrain_id: terrainId,
    history_days: 0,
    forecast_days: forecastDays,
    warnings: [
      'Historique insuffisant pour tracer les donnees reelles',
      detail ? `Detail: ${detail}` : undefined,
    ].filter(Boolean),
    chart_data: chartData,
  };
}

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

    const resp = await fetchML('/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terrain_id: terrainId }),
    }, req.headers.authorization);
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
    const resp = await fetchML('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terrain_id: terrainId, days }),
    }, req.headers.authorization);

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      log.error({ status: resp.status, text }, 'ml-service /predict returned non-JSON');
      return res.status(502).json({ error: 'ML service bad response', detail: text });
    }

    if (resp.status === 422) {
      // Keep UI stable when terrain has too little history.
      return res.status(200).json({
        terrain_id: terrainId,
        forecast: buildZeroDailyForecast(days),
        model_mape: null,
        model_rmse: null,
        model_type: 'insufficient_data',
        warnings: [data?.detail || 'Not enough data for ML forecast yet'],
      });
    }

    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || data,
      });
    }

    res.status(200).json(data);
  } catch (err) {
    log.error({ error: err.message }, 'ML predict failed');
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// GET /ai/model/:terrainId — model status
router.get('/ai/model/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;

    const resp = await fetchML(`/models/${terrainId}/status`, {}, req.headers.authorization);
    const data = await resp.json();
    res.status(resp.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// POST /ai/anomalies/detect/:terrainId — trigger anomaly detection
router.post('/ai/anomalies/detect/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const resp = await fetchML(`/anomalies/detect/${terrainId}`, { method: 'POST' }, req.headers.authorization);
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || data,
      });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(503).json({ error: 'ML service unavailable', detail: err.message });
  }
});

// GET /ai/anomalies/:terrainId?days=30 — get anomalies
router.get('/ai/anomalies/:terrainId', verifyTerrainAccess, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const resp = await fetchML(`/anomalies/${terrainId}?days=${days}`, {}, req.headers.authorization);
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || data,
      });
    }
    res.status(200).json(data);
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

    const days = Math.min(7, Math.max(1, parseInt(req.query.days, 10) || 1));
    const path = `/forecast/hourly/${terrainId}?${params.toString()}`;
    const resp = await fetchML(path, {}, req.headers.authorization);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) {
      log.warn({ endpoint: 'hourly', text }, 'ml-service returned non-JSON, using fallback');
      return res.status(502).json({
        error: 'ML upstream bad response',
        endpoint: '/ai/forecast/hourly/:terrainId',
        detail: text,
        fallback: buildHourlyFallback(terrainId, days, text, req.query.point_id),
      });
    }
    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || String(data),
        fallback: buildHourlyFallback(terrainId, days, data?.detail || data?.error || String(data), req.query.point_id),
      });
    }
    res.status(200).json(data);
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

    const path = `/forecast/profiles/${terrainId}?${params.toString()}`;
    const resp = await fetchML(path, {}, req.headers.authorization);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) {
      log.warn({ endpoint: 'profiles', text }, 'ml-service returned non-JSON, using fallback');
      return res.status(502).json({
        error: 'ML upstream bad response',
        endpoint: '/ai/forecast/profiles/:terrainId',
        detail: text,
        fallback: buildProfilesFallback(terrainId, req.query.point_id, text),
      });
    }
    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || String(data),
        fallback: buildProfilesFallback(terrainId, req.query.point_id, data?.detail || data?.error || String(data)),
      });
    }
    res.status(200).json(data);
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
      ml_service_url: ML_SERVICE_URL,
      fallback: buildProfilesFallback(req.params.terrainId, req.query.point_id, err.message),
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

    const forecastDays = Math.min(7, Math.max(1, parseInt(req.query.forecast_days, 10) || 3));
    const path = `/forecast/daily-chart/${terrainId}?${params.toString()}`;
    const resp = await fetchML(path, {}, req.headers.authorization);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } 
    catch (e) {
      log.warn({ endpoint: 'daily-chart', text }, 'ml-service returned non-JSON, using fallback');
      return res.status(502).json({
        error: 'ML upstream bad response',
        endpoint: '/ai/forecast/daily-chart/:terrainId',
        detail: text,
        fallback: buildDailyChartFallback(terrainId, forecastDays, text),
      });
    }
    if (!resp.ok) {
      return res.status(502).json({
        error: 'ML upstream error',
        upstream_status: resp.status,
        detail: data?.detail || data?.error || String(data),
        fallback: buildDailyChartFallback(terrainId, forecastDays, data?.detail || data?.error || String(data)),
      });
    }
    res.status(200).json(data);
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
    const fcDays = Math.min(7, Math.max(1, parseInt(req.query.forecast_days, 10) || 3));
    res.status(503).json({ 
      error: 'ML service unavailable', 
      detail: err.message,
      ml_service_url: ML_SERVICE_URL,
      fallback: buildDailyChartFallback(req.params.terrainId, fcDays, err.message),
    });
  }
});

module.exports = router;
