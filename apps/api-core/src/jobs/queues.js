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

const redisDisabled = String(process.env.DISABLE_REDIS || "").toLowerCase() === "true";
const hasRedisUrl = Boolean(process.env.REDIS_URL);

let telemetryQueue;
let aiQueue;
let reportsQueue;

if (redisDisabled || !hasRedisUrl) {
  console.warn(
    "[jobs] Redis disabled, using no-op queues. " +
      "Set DISABLE_REDIS=false and REDIS_URL to enable BullMQ."
  );
  telemetryQueue = createNoopQueue("telemetry");
  aiQueue = createNoopQueue("ai");
  reportsQueue = createNoopQueue("reports");
} else {
  const { Queue } = require("bullmq");
  const connection = require("../config/redis");

  telemetryQueue = new Queue("telemetry", { connection });
  aiQueue = new Queue("ai", { connection });
  reportsQueue = new Queue("reports", { connection });
}

module.exports = { telemetryQueue, aiQueue, reportsQueue };
