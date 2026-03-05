require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3000,
  coreDbUrl: process.env.CORE_DB_URL,
  redisUrl: process.env.REDIS_URL,
  telemetryDbUrl: process.env.TELEMETRY_DB_URL,
  jwtSecret: process.env.JWT_SECRET || (() => { console.warn('[WARN] JWT_SECRET not set – using random ephemeral secret (tokens will not survive restart)'); return require('crypto').randomBytes(32).toString('hex'); })(),
};
