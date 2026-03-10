const { redisUrl } = require("./env");
const log = require("../config/logger");

const redisDisabled =
  String(process.env.DISABLE_REDIS || "").toLowerCase() === "true";

if (redisDisabled || !redisUrl) {
  if (!redisUrl && !redisDisabled) {
    log.warn("[redis] REDIS_URL is missing — Redis client disabled.");
  } else {
    log.warn("[redis] DISABLE_REDIS=true — Redis client disabled.");
  }
  module.exports = null;
} else {
  const IORedis = require("ioredis");
  module.exports = new IORedis(redisUrl, { maxRetriesPerRequest: null });
}
