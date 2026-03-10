require("dotenv").config();

const log = require('./logger');

const required = ['CORE_DB_URL', 'TELEMETRY_DB_URL', 'REDIS_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  log.fatal({ missing }, 'Missing required environment variables. Exiting.');
  process.exit(1);
}

module.exports = {
  port: process.env.PORT || 3001,
  coreDbUrl: process.env.CORE_DB_URL,
  telemetryDbUrl: process.env.TELEMETRY_DB_URL,
  redisUrl: process.env.REDIS_URL,
};
