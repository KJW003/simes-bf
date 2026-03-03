const express = require("express");
const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ingestion-service", uptime: process.uptime() });
});

module.exports = router;
