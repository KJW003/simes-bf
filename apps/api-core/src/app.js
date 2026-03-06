const express = require('express');
const cors = require('cors');
const { requireAuth } = require('./shared/auth-middleware');

const authRoutes = require('./modules/auth/auth.routes');
const healthRoutes = require('./modules/health/health.routes');
const jobsRoutes = require("./modules/jobs/jobs.routes");
const runsRoutes = require("./modules/runs/runs.routes");
const referentialRoutes = require("./modules/referential/referential.routes");
const resultsRoutes = require("./modules/results/results.routes");
const tariffsRoutes = require("./modules/tariffs/tariffs.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const telemetryRoutes = require("./modules/telemetry/telemetry.routes");
const listenerRoutes = require("./modules/test-listener/test-listener.routes");
const incidentsRoutes = require("./modules/incidents/incidents.routes");
const logsRoutes = require("./modules/logs/logs.routes");

const app = express();

// ── Security middleware ─────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── Request logging ─────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ── Public routes (no auth) ─────────────────────────────────
app.use('/', authRoutes);
app.use('/', healthRoutes);

// ── Protected routes (require JWT) ──────────────────────────
app.use("/", requireAuth, referentialRoutes);
app.use("/", requireAuth, jobsRoutes);
app.use("/", requireAuth, resultsRoutes);
app.use("/", requireAuth, tariffsRoutes);
app.use("/", adminRoutes);  // admin routes already have their own requireAuth per-route
app.use("/", requireAuth, telemetryRoutes);
app.use("/runs", requireAuth, runsRoutes);
app.use("/", requireAuth, incidentsRoutes);
app.use("/", requireAuth, logsRoutes);

//Debug only
app.use("/test-listener", listenerRoutes);

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

module.exports = app;
