// ============================================================
// Shared Auth Middleware
// ============================================================
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");

// Verify JWT token and attach user to request
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "No token" });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    // Attach user info to request for use in route handlers
    req.userId = decoded.sub;
    req.userRole = decoded.role;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: e.message });
  }
}

// Check if user has required role(s)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ ok: false, error: "Forbidden: insufficient permissions" });
    }
    next();
  };
}

// Verify user has access to a specific terrain via org membership
// Usage: router.post("/jobs/facture", requireAuth, verifyTerrainAccess("body.terrain_id"), handler)
function verifyTerrainAccess(locationPath = "params.terrainId") {
  return async (req, res, next) => {
    try {
      // Extract terrainId based on location path (e.g., "params.terrainId" or "body.terrain_id")
      const paths = locationPath.split(".");
      let terrainId = req;
      for (const path of paths) {
        terrainId = terrainId?.[path];
      }

      if (!terrainId) {
        return res.status(400).json({ ok: false, error: "Missing terrain identifier" });
      }

      // platform_super_admin can access all terrains
      if (req.userRole === "platform_super_admin") return next();

      // Check if user belongs to the organization that owns this terrain
      const { corePool } = require("../config/db");
      const result = await corePool.query(
        `SELECT t.id FROM terrains t
         JOIN sites s ON s.id = t.site_id
         JOIN users u ON u.organization_id = s.organization_id
         WHERE t.id = $1 AND u.id = $2
         LIMIT 1`,
        [terrainId, req.userId]
      );

      if (!result.rows.length) {
        return res.status(403).json({ ok: false, error: "Access denied: you do not have permission to access this terrain" });
      }

      next();
    } catch (err) {
      res.status(500).json({ ok: false, error: "Access check failed", detail: err.message });
    }
  };
}

module.exports = { requireAuth, requireRole, verifyTerrainAccess };
