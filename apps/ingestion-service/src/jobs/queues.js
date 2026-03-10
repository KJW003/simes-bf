function createNoopQueue(name) {
  return {
    name,
    async add(jobName, data) {
      return {
        id: `noop-${Date.now()}`,
        name: jobName,
        data,
        queueName: name,
        noRedis: true,
      };
    },
  };
}

const log = require("../config/logger");
const redisDisabled = String(process.env.DISABLE_REDIS || "").toLowerCase() === "true";
const hasRedisUrl = Boolean(process.env.REDIS_URL);

let telemetryQueue;

if (redisDisabled || !hasRedisUrl) {
  log.warn(
    "[jobs] Redis disabled, using no-op queue. " +
      "Set DISABLE_REDIS=false and REDIS_URL to enable BullMQ."
  );
  telemetryQueue = createNoopQueue("telemetry");
} else {
  const { Queue } = require("bullmq");
  const connection = require("../config/redis");
  telemetryQueue = new Queue("telemetry", { connection });
}

module.exports = { telemetryQueue };
