// ============================================================
// SIMES – Auth Routes
// POST /auth/login   → authenticate, return JWT + user
// GET  /auth/me      → return current user from JWT
// ============================================================
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { corePool } = require("../../config/db");
const { jwtSecret } = require("../../config/env");
const { requireAuth } = require("../../shared/auth-middleware");

const router = express.Router();

const TOKEN_EXPIRY = "24h";
const MAX_FAILED = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 min

// ── POST /auth/login ────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  try {
    if (!corePool) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    // Find user
    const { rows } = await corePool.query(
      `SELECT id, email, password_hash, name, role, organization_id,
              site_access, avatar, active, locked_until, failed_attempts
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, reason: "invalid" });
    }

    const user = rows[0];

    // Check active
    if (!user.active) {
      return res.status(401).json({ ok: false, reason: "invalid" });
    }

    // Check lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(401).json({
        ok: false,
        reason: "locked",
        locked_until: user.locked_until,
      });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const nextFailed = (user.failed_attempts || 0) + 1;
      const updates = { failed_attempts: nextFailed };

      if (nextFailed >= MAX_FAILED) {
        const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
        await corePool.query(
          `UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
          [nextFailed, lockUntil, user.id]
        );
        return res.status(401).json({ ok: false, reason: "locked", locked_until: lockUntil });
      }

      await corePool.query(
        `UPDATE users SET failed_attempts = $1 WHERE id = $2`,
        [nextFailed, user.id]
      );
      return res.status(401).json({ ok: false, reason: "invalid" });
    }

    // Success — reset failed attempts, update last_login_at
    await corePool.query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    // Build JWT
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      org: user.organization_id,
    };
    const token = jwt.sign(payload, jwtSecret, { expiresIn: TOKEN_EXPIRY });

    // Build user response (no password_hash!)
    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.organization_id,
      siteAccess: user.site_access || [],
      avatar: user.avatar || "",
    };

    return res.json({ ok: true, token, user: userResponse });
  } catch (e) {
    console.error("[auth/login]", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /auth/me ────────────────────────────────────────────
router.get("/auth/me", async (req, res) => {
  try {
    if (!corePool) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

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

    const { rows } = await corePool.query(
      `SELECT id, email, name, role, organization_id, site_access, avatar, active
       FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (rows.length === 0 || !rows[0].active) {
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    const u = rows[0];
    return res.json({
      ok: true,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        orgId: u.organization_id,
        siteAccess: u.site_access || [],
        avatar: u.avatar || "",
      },
    });
  } catch (e) {
    console.error("[auth/me]", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /users ──────────────────────────────────────────────
router.get("/users", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { rows } = await corePool.query(
      `SELECT id, email, name, role, organization_id, site_access, avatar, active, created_at, last_login_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.map(u => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      orgId: u.organization_id, siteAccess: u.site_access || [],
      avatar: u.avatar || "", active: u.active,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
    })));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── POST /users ─────────────────────────────────────────────
router.post("/users", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { email, password, name, role, organization_id, site_access, avatar } = req.body ?? {};
    if (!email || !password || !name) {
      return res.status(400).json({ ok: false, error: "email, password, name required" });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await corePool.query(
      `INSERT INTO users (email, password_hash, name, role, organization_id, site_access, avatar)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, name, role, organization_id, site_access, avatar, active, created_at`,
      [email.toLowerCase().trim(), hash, name.trim(), role || 'operator', organization_id || null, site_access || '{}', avatar || '']
    );
    const u = rows[0];
    res.status(201).json({
      id: u.id, email: u.email, name: u.name, role: u.role,
      orgId: u.organization_id, siteAccess: u.site_access || [],
      avatar: u.avatar || "", active: u.active, createdAt: u.created_at,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PUT /users/:userId ──────────────────────────────────────
router.put("/users/:userId", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { userId } = req.params;
    const { email, name, role, organization_id, site_access, avatar, active, password } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ ok: false, error: "name required" });

    // If password provided, hash it
    let passwordClause = '';
    const params = [userId, name.trim(), email?.toLowerCase().trim(), role, organization_id, site_access, avatar, active];
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash);
      passwordClause = `, password_hash = $${params.length}`;
    }

    const { rows, rowCount } = await corePool.query(
      `UPDATE users SET name = $2, email = COALESCE($3, email), role = COALESCE($4, role),
       organization_id = $5, site_access = COALESCE($6, site_access),
       avatar = COALESCE($7, avatar), active = COALESCE($8, active)${passwordClause}
       WHERE id = $1
       RETURNING id, email, name, role, organization_id, site_access, avatar, active, created_at`,
      params
    );
    if (rowCount === 0) return res.status(404).json({ ok: false, error: "user not found" });
    const u = rows[0];
    res.json({
      id: u.id, email: u.email, name: u.name, role: u.role,
      orgId: u.organization_id, siteAccess: u.site_access || [],
      avatar: u.avatar || "", active: u.active, createdAt: u.created_at,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── DELETE /users/:userId ───────────────────────────────────
router.delete("/users/:userId", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { userId } = req.params;
    const r = await corePool.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [userId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "user not found" });
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
