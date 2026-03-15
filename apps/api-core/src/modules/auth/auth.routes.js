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
const { auditLog } = require("../../shared/audit-log");
const { validate } = require("../../shared/validate");
const { loginSchema, createUserSchema, updateUserSchema, settingsSchema } = require("../../shared/schemas");
const log = require("../../config/logger");

const router = express.Router();

const TOKEN_EXPIRY = "24h";
const MAX_FAILED = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 min

// ── POST /auth/login ────────────────────────────────────────
router.post("/auth/login", validate(loginSchema), async (req, res) => {
  try {
    if (!corePool) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { email, password } = req.body;
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
        auditLog('warn', 'api', `Compte verrouillé après ${MAX_FAILED} tentatives: ${email}`, { email, locked_until: lockUntil }, user.id);
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
    log.error({ err: e.message }, "[auth/login]");
    auditLog('error', 'api', `Login error: ${e.message}`, { error: e.message });
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /auth/me ────────────────────────────────────────────
router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    if (!corePool) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { rows } = await corePool.query(
      `SELECT id, email, name, role, organization_id, site_access, avatar, active
       FROM users WHERE id = $1`,
      [req.userId]
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
    log.error({ err: e.message }, "[auth/me]");
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /auth/logout ───────────────────────────────────────
// JWT is stateless; logout is client-side token removal + audit trail.
router.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    auditLog('info', 'api', `User logout`, { userId: req.userId, role: req.userRole }, req.userId);
    return res.json({ ok: true, message: "Logged out" });
  } catch (e) {
    log.error({ err: e.message }, "[auth/logout]");
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /auth/settings ──────────────────────────────────────
router.get("/auth/settings", requireAuth, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { rows } = await corePool.query(
      `SELECT settings FROM users WHERE id = $1`,
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });
    return res.json({ ok: true, settings: rows[0].settings || {} });
  } catch (e) {
    log.error({ err: e.message }, "[auth/settings GET]");
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PUT /auth/settings ──────────────────────────────────────
router.put("/auth/settings", requireAuth, validate(settingsSchema), async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { settings } = req.body ?? {};
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ ok: false, error: "settings object required" });
    }
    const { rows } = await corePool.query(
      `UPDATE users SET settings = $2, updated_at = NOW() WHERE id = $1 RETURNING settings`,
      [req.userId, JSON.stringify(settings)]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });
    return res.json({ ok: true, settings: rows[0].settings });
  } catch (e) {
    log.error({ err: e.message }, "[auth/settings PUT]");
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PATCH /auth/settings ────────────────────────────────────
// Partial merge: merges req.body.settings into existing settings JSONB
router.patch("/auth/settings", requireAuth, validate(settingsSchema), async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { settings } = req.body ?? {};
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ ok: false, error: "settings object required" });
    }
    const { rows } = await corePool.query(
      `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
       WHERE id = $1 RETURNING settings`,
      [req.userId, JSON.stringify(settings)]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });
    return res.json({ ok: true, settings: rows[0].settings });
  } catch (e) {
    log.error({ err: e.message }, "[auth/settings PATCH]");
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /users ──────────────────────────────────────────────
router.get("/users", requireAuth, (req, res, next) => {
  // Only platform_super_admin can list all users
  if (req.userRole !== "platform_super_admin") {
    return res.status(403).json({ ok: false, error: "Forbidden: only super admin can list users" });
  }
  next();
}, async (req, res) => {
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
router.post("/users", requireAuth, (req, res, next) => {
  // Only platform_super_admin can create users
  if (req.userRole !== "platform_super_admin") {
    auditLog('warn', 'api', `Unauthorized user creation attempt`, { user: req.body?.email }, req.userId);
    return res.status(403).json({ ok: false, error: "Forbidden: only super admin can create users" });
  }
  next();
}, validate(createUserSchema), async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { email, password, name, role, organization_id, site_access, avatar } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await corePool.query(
      `INSERT INTO users (email, password_hash, name, role, organization_id, site_access, avatar)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, name, role, organization_id, site_access, avatar, active, created_at`,
      [email.toLowerCase().trim(), hash, name.trim(), role || 'operator', organization_id || null, site_access || '{}', avatar || '']
    );
    const u = rows[0];
    auditLog('info', 'api', `User created: ${email}`, { email, role, orgId: organization_id }, req.userId);
    res.status(201).json({
      id: u.id, email: u.email, name: u.name, role: u.role,
      orgId: u.organization_id, siteAccess: u.site_access || [],
      avatar: u.avatar || "", active: u.active, createdAt: u.created_at,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PUT /users/:userId ──────────────────────────────────────
router.put("/users/:userId", requireAuth, (req, res, next) => {
  // Only platform_super_admin can modify users
  if (req.userRole !== "platform_super_admin") {
    auditLog('warn', 'api', `Unauthorized user update attempt for ${req.params.userId}`, {}, req.userId);
    return res.status(403).json({ ok: false, error: "Forbidden: only super admin can modify users" });
  }
  next();
}, validate(updateUserSchema), async (req, res) => {
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
    auditLog('info', 'api', `User updated: ${userId}`, { changes: { email, name, role, active } }, req.userId);
    res.json({
      id: u.id, email: u.email, name: u.name, role: u.role,
      orgId: u.organization_id, siteAccess: u.site_access || [],
      avatar: u.avatar || "", active: u.active, createdAt: u.created_at,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── DELETE /users/:userId ───────────────────────────────────
router.delete("/users/:userId", requireAuth, (req, res, next) => {
  // Only platform_super_admin can delete users
  if (req.userRole !== "platform_super_admin") {
    auditLog('warn', 'api', `Unauthorized user deletion attempt for ${req.params.userId}`, {}, req.userId);
    return res.status(403).json({ ok: false, error: "Forbidden: only super admin can delete users" });
  }
  next();
}, async (req, res) => {
  try {
    if (!corePool) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const { userId } = req.params;
    const r = await corePool.query(`DELETE FROM users WHERE id = $1 RETURNING id, email`, [userId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "user not found" });
    auditLog('warn', 'api', `User deleted: ${r.rows[0].email}`, { userId }, req.userId);
    res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
