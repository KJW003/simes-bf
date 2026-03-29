const express = require("express");
const router = express.Router();
const {corePool: db} = require("../../config/db");
const { requireAuth, requireRole } = require("../../shared/auth-middleware");
const { validate } = require("../../shared/validate");
const { nameSchema, siteSchema, terrainSchema, zoneSchema, createPointSchema, updatePointSchema, assignZoneSchema } = require("../../shared/schemas");
const { auditLog } = require("../../shared/audit-log");

// Helpers
function bad(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

// ── Middleware: Verify user is org_admin of orgId ──
async function verifyOrgOwnership(req, res, next) {
  try {
    const { orgId } = req.params;
    if (!orgId) return res.status(400).json({ ok: false, error: "Missing orgId" });
    
    // platform_super_admin can do anything
    if (req.userRole === "platform_super_admin") return next();
    
    // org_admin must belong to this org
    if (req.userRole !== "org_admin") {
      return res.status(403).json({ ok: false, error: "Only org_admin can manage orgs" });
    }
    
    const result = await db.query(
      `SELECT id FROM users WHERE id = $1 AND organization_id = $2`,
      [req.userId, orgId]
    );
    
    if (!result.rows.length) {
      auditLog('warn', 'api', `Unauthorized org access attempt for org ${orgId}`, { orgId }, req.userId);
      return res.status(403).json({ ok: false, error: "Access denied: you do not own this organization" });
    }
    
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: "Access check failed", detail: e.message });
  }
}

// ── Middleware: Verify user owns the site's organization ──
async function verifySiteOwnership(req, res, next) {
  try {
    const { siteId } = req.params;
    if (!siteId) return res.status(400).json({ ok: false, error: "Missing siteId" });

    if (req.userRole === "platform_super_admin") return next();
    if (req.userRole !== "org_admin") {
      return res.status(403).json({ ok: false, error: "Only org_admin can manage sites" });
    }

    const result = await db.query(
      `SELECT s.id
       FROM sites s
       JOIN users u ON u.organization_id = s.organization_id
       WHERE s.id = $1 AND u.id = $2
       LIMIT 1`,
      [siteId, req.userId]
    );

    if (!result.rows.length) {
      auditLog('warn', 'api', `Unauthorized site access attempt for site ${siteId}`, { siteId }, req.userId);
      return res.status(403).json({ ok: false, error: "Access denied: you do not own this site" });
    }

    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: "Access check failed", detail: e.message });
  }
}

// ── Middleware: Verify user owns the terrain's organization ──
async function verifyTerrainOwnership(req, res, next) {
  try {
    const { terrainId } = req.params;
    if (!terrainId) return res.status(400).json({ ok: false, error: "Missing terrainId" });

    if (req.userRole === "platform_super_admin") return next();
    if (req.userRole !== "org_admin") {
      return res.status(403).json({ ok: false, error: "Only org_admin can manage terrains" });
    }

    const result = await db.query(
      `SELECT t.id
       FROM terrains t
       JOIN sites s ON s.id = t.site_id
       JOIN users u ON u.organization_id = s.organization_id
       WHERE t.id = $1 AND u.id = $2
       LIMIT 1`,
      [terrainId, req.userId]
    );

    if (!result.rows.length) {
      auditLog('warn', 'api', `Unauthorized terrain access attempt for terrain ${terrainId}`, { terrainId }, req.userId);
      return res.status(403).json({ ok: false, error: "Access denied: you do not own this terrain" });
    }

    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: "Access check failed", detail: e.message });
  }
}

/** ORGS **/
router.post("/orgs", requireAuth, requireRole("platform_super_admin"), validate(nameSchema), async (req, res) => {
  try {
    const { name } = req.body;

    const r = await db.query(
      `INSERT INTO organizations (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [name.trim()]
    );

    auditLog('info', 'api', `Organization created: ${name}`, { name }, req.userId);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/orgs", requireAuth, async (req, res) => {
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

/** ALL SITES (platform view) **/
router.get("/sites", requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.id, s.organization_id, s.name, s.location, s.created_at, o.name AS org_name
       FROM sites s LEFT JOIN organizations o ON o.id = s.organization_id
       ORDER BY s.created_at DESC LIMIT 500`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/** ALL TERRAINS (platform view) **/
router.get("/terrains", requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT t.id, t.site_id, t.name, t.gateway_model, t.gateway_id, t.created_at,
              s.name AS site_name, o.name AS org_name, o.id AS org_id
       FROM terrains t
       LEFT JOIN sites s ON s.id = t.site_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       ORDER BY t.created_at DESC LIMIT 500`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/orgs/:orgId", requireAuth, requireRole("platform_super_admin"), validate(nameSchema), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name } = req.body;
    const r = await db.query(
      `UPDATE organizations SET name = $2 WHERE id = $1 RETURNING id, name, created_at`,
      [orgId, name.trim()]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "org not found" });
    auditLog('info', 'api', `Organization updated: ${orgId}`, { orgId, name }, req.userId);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/orgs/:orgId", requireAuth, requireRole("platform_super_admin"), async (req, res) => {
  try {
    const { orgId } = req.params;
    const r = await db.query(`DELETE FROM organizations WHERE id = $1 RETURNING id`, [orgId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "org not found" });
    auditLog('warn', 'api', `Organization deleted: ${orgId}`, { orgId }, req.userId);
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/** SITES **/
router.post("/orgs/:orgId/sites", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyOrgOwnership, validate(siteSchema), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, location } = req.body;

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

router.get("/orgs/:orgId/sites", requireAuth, async (req, res) => {
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

router.put("/sites/:siteId", requireAuth, requireRole("platform_super_admin", "org_admin"), verifySiteOwnership, validate(siteSchema), async (req, res) => {
  try {
    const { siteId } = req.params;
    const { name, location } = req.body;
    const r = await db.query(
      `UPDATE sites SET name = $2, location = $3 WHERE id = $1
       RETURNING id, organization_id, name, location, created_at`,
      [siteId, name.trim(), location ?? null]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "site not found" });
    auditLog('info', 'api', `Site updated: ${siteId}`, { siteId, name }, req.userId);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/sites/:siteId", requireAuth, requireRole("platform_super_admin", "org_admin"), verifySiteOwnership, async (req, res) => {
  try {
    const { siteId } = req.params;
    const r = await db.query(`DELETE FROM sites WHERE id = $1 RETURNING id`, [siteId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "site not found" });
    auditLog('warn', 'api', `Site deleted: ${siteId}`, { siteId }, req.userId);
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/sites/:siteId/tree", requireAuth, async (req, res) => {
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
router.post("/sites/:siteId/terrains", requireAuth, requireRole("platform_super_admin", "org_admin"), verifySiteOwnership, validate(terrainSchema), async (req, res) => {
  try {
    const { siteId } = req.params;
    const { name, gateway_model, gateway_id } = req.body;

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

router.get("/sites/:siteId/terrains", requireAuth, async (req, res) => {
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

router.put("/terrains/:terrainId", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainOwnership, validate(terrainSchema), async (req, res) => {
  try {
    const { terrainId } = req.params;
    const { name, gateway_model, gateway_id } = req.body;
    const r = await db.query(
      `UPDATE terrains SET name = $2, gateway_model = COALESCE($3, gateway_model), gateway_id = COALESCE($4, gateway_id)
       WHERE id = $1 RETURNING id, site_id, name, gateway_model, gateway_id, created_at`,
      [terrainId, name.trim(), gateway_model ?? null, gateway_id ?? null]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "terrain not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/terrains/:terrainId", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainOwnership, async (req, res) => {
  try {
    const { terrainId } = req.params;

    // Before deleting: revert incoming_messages whose gateway was mapped to this terrain
    await db.query(
      `UPDATE incoming_messages
       SET status = 'unmapped', mapped_terrain_id = NULL, mapped_point_id = NULL
       WHERE mapped_terrain_id = $1 AND status = 'mapped'`,
      [terrainId]
    );

    // FK CASCADE will auto-delete gateway_registry + device_registry entries for this terrain
    const r = await db.query(`DELETE FROM terrains WHERE id = $1 RETURNING id`, [terrainId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "terrain not found" });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/** ZONES **/
router.post("/terrains/:terrainId/zones", requireAuth, requireRole("platform_super_admin", "org_admin"), verifyTerrainOwnership, validate(zoneSchema), async (req, res) => {
  try {
    const { terrainId } = req.params;
    const { name, description } = req.body;

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

router.get("/terrains/:terrainId/zones", requireAuth, async (req, res) => {
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

router.put("/zones/:zoneId", requireAuth, requireRole("platform_super_admin", "org_admin"), validate(zoneSchema), async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { name, description } = req.body;
    const r = await db.query(
      `UPDATE zones SET name = $2, description = $3 WHERE id = $1
       RETURNING id, terrain_id, name, description, created_at`,
      [zoneId, name.trim(), description ?? null]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "zone not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/zones/:zoneId", requireAuth, requireRole("platform_super_admin", "org_admin"), async (req, res) => {
  try {
    const { zoneId } = req.params;
    // Unassign points from this zone first
    await db.query(`UPDATE measurement_points SET zone_id = NULL WHERE zone_id = $1`, [zoneId]);
    const r = await db.query(`DELETE FROM zones WHERE id = $1 RETURNING id`, [zoneId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "zone not found" });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/** MEASUREMENT POINTS **/
router.post("/terrains/:terrainId/points", requireAuth, requireRole("platform_super_admin", "org_admin"), validate(createPointSchema), async (req, res) => {
  try {
    const { terrainId } = req.params;
    const {
      zone_id,
      name,
      device,
      measure_category,
      lora_dev_eui,
      modbus_addr,
      ct_ratio,
      meta,
      status,
      parent_id,
      node_type,
      is_billing,
    } = req.body;

    // Validate parent belongs to same terrain
    if (parent_id) {
      const parentCheck = await db.query(
        `SELECT id FROM measurement_points WHERE id = $1 AND terrain_id = $2`,
        [parent_id, terrainId]
      );
      if (parentCheck.rowCount === 0) {
        return res.status(400).json({ ok: false, error: "parent_id must belong to the same terrain" });
      }
    }

    const r = await db.query(
      `INSERT INTO measurement_points
       (terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr, ct_ratio, meta, status, parent_id, node_type, is_billing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
       RETURNING id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr,
                 COALESCE(ct_ratio, 1) AS ct_ratio, meta, status, created_at, parent_id, node_type, is_billing`,
      [
        terrainId,
        zone_id ?? null,
        name.trim(),
        device.trim(),
        (measure_category ?? "UNKNOWN").toUpperCase(),
        lora_dev_eui ?? null,
        modbus_addr ?? null,
        ct_ratio ?? 1,
        JSON.stringify(meta ?? {}),
        status ?? "active",
        parent_id ?? null,
        node_type ?? "charge",
        is_billing !== undefined ? is_billing : true,
      ]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/terrains/:terrainId/points", requireAuth, async (req, res) => {
  try {
    const { terrainId } = req.params;
    const r = await db.query(
      `SELECT id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr,
              COALESCE(ct_ratio, 1) AS ct_ratio, meta, status, created_at,
              parent_id, node_type, is_billing
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

router.put("/points/:pointId", requireAuth, requireRole("platform_super_admin", "org_admin"), validate(updatePointSchema), async (req, res) => {
  try {
    const { pointId } = req.params;
    const { name, device, measure_category, lora_dev_eui, modbus_addr, ct_ratio, meta, status, zone_id,
            parent_id, node_type, is_billing } = req.body;

    // Validate parent belongs to same terrain (if changing parent)
    if (parent_id !== undefined && parent_id !== null) {
      const ptTerrain = await db.query(`SELECT terrain_id FROM measurement_points WHERE id = $1`, [pointId]);
      if (ptTerrain.rowCount > 0) {
        const parentCheck = await db.query(
          `SELECT id FROM measurement_points WHERE id = $1 AND terrain_id = $2`,
          [parent_id, ptTerrain.rows[0].terrain_id]
        );
        if (parentCheck.rowCount === 0) {
          return res.status(400).json({ ok: false, error: "parent_id must belong to the same terrain" });
        }
      }
    }

    const r = await db.query(
      `UPDATE measurement_points
       SET name = $2, device = COALESCE($3, device), measure_category = COALESCE($4, measure_category),
           lora_dev_eui = COALESCE($5, lora_dev_eui), modbus_addr = COALESCE($6, modbus_addr),
           ct_ratio = COALESCE($7, ct_ratio),
           meta = COALESCE($8::jsonb, meta), status = COALESCE($9, status), zone_id = COALESCE($10, zone_id),
           parent_id = $11, node_type = COALESCE($12, node_type), is_billing = COALESCE($13, is_billing)
       WHERE id = $1
       RETURNING id, terrain_id, zone_id, name, device, measure_category, lora_dev_eui, modbus_addr,
                 COALESCE(ct_ratio, 1) AS ct_ratio, meta, status, created_at, parent_id, node_type, is_billing`,
      [pointId, name.trim(), device, measure_category, lora_dev_eui, modbus_addr, ct_ratio,
       meta ? JSON.stringify(meta) : null, status, zone_id,
       parent_id !== undefined ? parent_id : null, node_type, is_billing]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "point not found" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/points/:pointId", requireAuth, requireRole("platform_super_admin", "org_admin"), async (req, res) => {
  try {
    const { pointId } = req.params;

    // Get all device_keys that were mapped to this point (for cascade cleanup)
    const devicesPointedHere = await db.query(
      `SELECT DISTINCT device_key FROM device_registry WHERE point_id = $1`,
      [pointId]
    );

    // Revert incoming_messages that were mapped to this point → back to 'unmapped'
    await db.query(
      `UPDATE incoming_messages
       SET status = 'unmapped', mapped_terrain_id = NULL, mapped_point_id = NULL
       WHERE mapped_point_id = $1 AND status = 'mapped'`,
      [pointId]
    );

    // Also revert messages for devices that were registered to this point
    // (this handles the cascade: device_registry entries will be deleted via FK)
    if (devicesPointedHere.rows.length > 0) {
      const deviceKeys = devicesPointedHere.rows.map(r => r.device_key);
      await db.query(
        `UPDATE incoming_messages
         SET status = 'unmapped', mapped_point_id = NULL, mapped_terrain_id = NULL
         WHERE device_key = ANY($1) AND mapped_point_id = $2`,
        [deviceKeys, pointId]
      );
    }

    // FK CASCADE will auto-delete device_registry entries for this point
    const r = await db.query(`DELETE FROM measurement_points WHERE id = $1 RETURNING id`, [pointId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "point not found" });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.patch("/points/:pointId/assign-zone", validate(assignZoneSchema), async (req, res) => {
  try {
    const { pointId } = req.params;
    const { zone_id } = req.body;

    // Autoriser null pour "désaffecter"
    const wantsUnassign = zone_id === null;

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