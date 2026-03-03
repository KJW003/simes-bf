const { redisUrl } = require("./env");

const redisDisabled =
  String(process.env.DISABLE_REDIS || "").toLowerCase() === "true";

if (redisDisabled || !redisUrl) {
  if (!redisUrl && !redisDisabled) {
    console.warn("[redis] REDIS_URL is missing — Redis client disabled.");
  } else {
    console.warn("[redis] DISABLE_REDIS=true — Redis client disabled.");
  }
  module.exports = null;
} else {
  const IORedis = require("ioredis");
  module.exports = new IORedis(redisUrl, { maxRetriesPerRequest: null });
}
