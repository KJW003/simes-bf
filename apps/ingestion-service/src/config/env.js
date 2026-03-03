require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3001,
  coreDbUrl: process.env.CORE_DB_URL,
  telemetryDbUrl: process.env.TELEMETRY_DB_URL,
  redisUrl: process.env.REDIS_URL,
};
