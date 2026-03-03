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
      decoded = jwt.verify(token, jwtSecret);
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

module.exports = { requireAuth, requireRole };
