const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const log = require("./config/logger");
const healthRoutes = require("./routes/health.routes");
const ingestionRoutes = require("./routes/ingestion.routes");

const app = express();

app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
}));

app.use(express.json({ limit: '512kb' }));

// Rate limit ingestion to prevent abuse (100 req/min per IP)
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' },
});
app.use('/milesight', ingestLimiter);

app.use("/", healthRoutes);
app.use("/", ingestionRoutes);

// Global error handler
app.use((err, req, res, next) => {
  log.error({ method: req.method, path: req.path, err: err.message }, 'unhandled error');
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

module.exports = app;
