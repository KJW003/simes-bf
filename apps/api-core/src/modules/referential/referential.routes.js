const express = require("express");
const router = express.Router();
const {corePool: db} = require("../../config/db");

// Helpers
function bad(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

/** ORGS **/
router.post("/orgs", async (req, res) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string") return bad(res, "name is required");

    const r = await db.query(
      `INSERT INTO organizations (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [name.trim()]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/orgs", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, name, created_at
       FROM organizations
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** SITES **/
router.post("/orgs/:orgId/sites", async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, location } = req.body ?? {};
    if (!name || typeof name !== "string") return bad(res, "name is required");

    const r = await db.query(
      `INSERT INTO sites (organization_id, name, location)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, name, location, created_at`,
      [orgId, name.trim(), location ?? null]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/orgs/:orgId/sites", async (req, res) => {
  try {
    const { orgId } = req.params;
    const r = await db.query(
      `SELECT id, organization_id, name, location, created_at
       FROM sites
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [orgId]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/sites/:siteId/tree", async (req, res) => {
  try {
    const { siteId } = req.params;

    const siteR = await db.query(
      `SELECT id, organization_id, name, location, created_at
       FROM sites
       WHERE id = $1`,
      [siteId]
    );

    if (siteR.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "site not found" });
    }

    const site = siteR.rows[0];

    const terrainsR = await db.query(
      `SELECT id, site_id, name, gateway_model, gateway_id, created_at
       FROM terrains
       WHERE site_id = $1
       ORDER BY created_at DESC`,
      [siteId]
    );

    const terrainIds = terrainsR.rows.map(t => t.id);

    // Si aucun terrain (théoriquement non) => renvoyer vide
    if (terrainIds.length === 0) {
      return res.json({ site, terrains: [] });
    }

    const zonesR = await db.query(
      `SELECT id, terrain_id, name, description, created_at
       FROM zones
       WHERE terrain_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [terrainIds]
    );

    const pointsR = await db.query(
      `SELECT id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status, created_at
       FROM measurement_points
       WHERE terrain_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [terrainIds]
    );

    // Regroupements
    const zonesByTerrain = new Map();
    for (const z of zonesR.rows) {
      if (!zonesByTerrain.has(z.terrain_id)) zonesByTerrain.set(z.terrain_id, []);
      zonesByTerrain.get(z.terrain_id).push(z);
    }

    const pointsByTerrain = new Map();
    for (const p of pointsR.rows) {
      if (!pointsByTerrain.has(p.terrain_id)) pointsByTerrain.set(p.terrain_id, []);
      pointsByTerrain.get(p.terrain_id).push(p);
    }

    const terrains = terrainsR.rows.map(t => ({
      terrain: t,
      zones: zonesByTerrain.get(t.id) ?? [],
      points: pointsByTerrain.get(t.id) ?? []
    }));

    res.json({ site, terrains });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** TERRAINS **/
router.post("/sites/:siteId/terrains", async (req, res) => {
  try {
    const { siteId } = req.params;
    const { name, gateway_model, gateway_id } = req.body ?? {};
    if (!name || typeof name !== "string") return bad(res, "name is required");

    const r = await db.query(
      `INSERT INTO terrains (site_id, name, gateway_model, gateway_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, site_id, name, gateway_model, gateway_id, created_at`,
      [siteId, name.trim(), gateway_model ?? "Milesight", gateway_id ?? null]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/sites/:siteId/terrains", async (req, res) => {
  try {
    const { siteId } = req.params;
    const r = await db.query(
      `SELECT id, site_id, name, gateway_model, gateway_id, created_at
       FROM terrains
       WHERE site_id = $1
       ORDER BY created_at DESC`,
      [siteId]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** ZONES **/
router.post("/terrains/:terrainId/zones", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const { name, description } = req.body ?? {};
    if (!name || typeof name !== "string") return bad(res, "name is required");

    const r = await db.query(
      `INSERT INTO zones (terrain_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, terrain_id, name, description, created_at`,
      [terrainId, name.trim(), description ?? null]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/terrains/:terrainId/zones", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const r = await db.query(
      `SELECT id, terrain_id, name, description, created_at
       FROM zones
       WHERE terrain_id = $1
       ORDER BY created_at DESC`,
      [terrainId]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** MEASUREMENT POINTS **/
router.post("/terrains/:terrainId/points", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const {
      zone_id,
      name,
      device,
      measure_category,
      lora_dev_eui,
      modbus_addr,
      meta,
      status,
    } = req.body ?? {};

    if (!name || typeof name !== "string") return bad(res, "name is required");
    if (!device || typeof device !== "string") return bad(res, "device is required");

    const r = await db.query(
      `INSERT INTO measurement_points
       (terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       RETURNING id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status, created_at`,
      [
        terrainId,
        zone_id ?? null,
        name.trim(),
        device.trim(),
        (measure_category ?? "UNKNOWN").toUpperCase(),
        lora_dev_eui ?? null,
        modbus_addr ?? null,
        JSON.stringify(meta ?? {}),
        status ?? "active",
      ]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/terrains/:terrainId/points", async (req, res) => {
  try {
    const { terrainId } = req.params;
    const r = await db.query(
      `SELECT id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, meta, status, created_at
       FROM measurement_points
       WHERE terrain_id = $1
       ORDER BY created_at DESC`,
      [terrainId]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch("/points/:pointId/assign-zone", async (req, res) => {
  try {
    const { pointId } = req.params;
    const { zone_id } = req.body ?? {};

    // Autoriser null pour "désaffecter"
    const wantsUnassign = zone_id === null;

    // Si zone_id est undefined => erreur (client n'a rien envoyé)
    if (zone_id === undefined) {
      return res.status(400).json({ ok: false, error: "zone_id is required (can be null to unassign)" });
    }

    // 1) Récupérer le point + son terrain
    const p = await db.query(
      `SELECT id, terrain_id, zone_id, name
       FROM measurement_points
       WHERE id = $1`,
      [pointId]
    );

    if (p.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "measurement point not found" });
    }

    const point = p.rows[0];

    // 2) Si unassign => update direct
    if (wantsUnassign) {
      const up = await db.query(
        `UPDATE measurement_points
         SET zone_id = NULL
         WHERE id = $1
         RETURNING id, terrain_id, zone_id, name, device, measure_category, status`,
        [pointId]
      );
      return res.json(up.rows[0]);
    }

    // 3) Vérifier que la zone existe et appartient au même terrain
    const z = await db.query(
      `SELECT id, terrain_id, name
       FROM zones
       WHERE id = $1`,
      [zone_id]
    );

    if (z.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "zone not found" });
    }

    const zone = z.rows[0];

    if (zone.terrain_id !== point.terrain_id) {
      return res.status(409).json({
        ok: false,
        error: "zone does not belong to the same terrain as the measurement point",
        pointTerrainId: point.terrain_id,
        zoneTerrainId: zone.terrain_id,
      });
    }

    // 4) Update
    const up = await db.query(
      `UPDATE measurement_points
       SET zone_id = $2
       WHERE id = $1
       RETURNING id, terrain_id, zone_id, name, device, measure_category, status`,
      [pointId, zone_id]
    );

    res.json(up.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
module.exports = router;