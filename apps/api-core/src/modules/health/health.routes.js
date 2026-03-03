const express = require('express');
const router = express.Router();
const {corePool: db} = require('../../config/db');

router.get('/health', (req, res) => {
  res.json({ status: 'API CORE is OK' });
});

router.get('/health/db', async (req, res) => {
  try {
    const r = await db.query('SELECT NOW() as now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
