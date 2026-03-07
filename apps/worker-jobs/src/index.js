require("./telemetry.worker");
require("./ai.worker");
require("./reports.worker");

// Setup background cleanup scheduler
const { setupScheduler } = require("./scheduler");
console.log("[index] Starting scheduler setup...");
setupScheduler().catch(err => console.error("[index] Scheduler setup error:", err));


