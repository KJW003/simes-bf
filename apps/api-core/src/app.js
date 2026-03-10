const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { requireAuth } = require('./shared/auth-middleware');
const { auditLog } = require('./shared/audit-log');
const log = require('./config/logger');

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
const aiRoutes = require("./modules/ai/ai.routes");

const app = express();

// ── Trust proxy (required for rate-limiting behind reverse proxy like Traefik)
app.set('trust proxy', 1);

// ── Security middleware ─────────────────────────────────────
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts, please try again later' },
});
app.use('/auth/login', authLimiter);

// ── Request logging ─────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/health') {
      log.info({ method: req.method, path: req.path, status: res.statusCode, ms }, 'request');
      // Log errors and slow requests to audit_logs
      if (res.statusCode >= 500) {
        auditLog('error', 'api', `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`, {
          method: req.method, path: req.path, status: res.statusCode, ms,
        }, req.userId || null);
      } else if (res.statusCode >= 400) {
        auditLog('warn', 'api', `${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`, {
          method: req.method, path: req.path, status: res.statusCode, ms,
        }, req.userId || null);
      }
    }
  });
  next();
});

// ── Public routes (no auth) ─────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
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
app.use("/", requireAuth, aiRoutes);

//Debug only
app.use("/test-listener", listenerRoutes);

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, next) => {
  log.error({ method: req.method, path: req.path, err: err.message }, 'unhandled error');
  auditLog('error', 'api', `Unhandled error: ${req.method} ${req.path} — ${err.message}`, {
    method: req.method, path: req.path, stack: (err.stack || '').slice(0, 500),
  }, req.userId || null);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    ok: false,
    error: status >= 500 ? 'Internal server error' : err.message,
  });
});

module.exports = app;
