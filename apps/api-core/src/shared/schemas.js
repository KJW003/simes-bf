const { z } = require('zod');

// ── Auth ────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email('Invalid email').max(255),
  password: z.string().min(1, 'Password required').max(255),
});

// ── Users ───────────────────────────────────────────────────
const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6, 'Password must be at least 6 characters').max(255),
  name: z.string().min(1).max(255).transform(s => s.trim()),
  role: z.enum(['platform_super_admin', 'org_admin', 'manager', 'operator']).optional().default('operator'),
  organization_id: z.string().uuid().nullable().optional(),
  site_access: z.any().optional(),
  avatar: z.string().max(500).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  email: z.string().email().max(255).optional(),
  role: z.enum(['platform_super_admin', 'org_admin', 'manager', 'operator']).optional(),
  organization_id: z.string().uuid().nullable().optional(),
  site_access: z.any().optional(),
  avatar: z.string().max(500).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(255).optional(),
});

// ── Referential ─────────────────────────────────────────────
const nameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).transform(s => s.trim()),
});

const siteSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  location: z.string().max(500).nullable().optional(),
});

const terrainSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  gateway_model: z.string().max(100).optional(),
  gateway_id: z.string().max(100).nullable().optional(),
});

const zoneSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  description: z.string().max(1000).nullable().optional(),
});

// ── Points ──────────────────────────────────────────────────
const NODE_TYPES = ['source', 'tableau', 'depart', 'charge'];

const createPointSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  device: z.string().min(1).max(255),
  zone_id: z.string().uuid().nullable().optional(),
  measure_category: z.string().max(100).optional().default('UNKNOWN'),
  lora_dev_eui: z.string().max(100).nullable().optional(),
  modbus_addr: z.string().max(100).nullable().optional(),
  ct_ratio: z.number().positive().optional().default(1),
  meta: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional().default('active'),
  // Hierarchical fields
  parent_id: z.string().uuid().nullable().optional(),
  node_type: z.enum(NODE_TYPES).optional().default('charge'),
  is_billing: z.boolean().optional().default(true),
});

const updatePointSchema = z.object({
  name: z.string().min(1).max(255).transform(s => s.trim()),
  device: z.string().max(255).optional(),
  zone_id: z.string().uuid().nullable().optional(),
  measure_category: z.string().max(100).optional(),
  lora_dev_eui: z.string().max(100).nullable().optional(),
  modbus_addr: z.string().max(100).nullable().optional(),
  ct_ratio: z.number().positive().optional(),
  meta: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional(),
  // Hierarchical fields
  parent_id: z.string().uuid().nullable().optional(),
  node_type: z.enum(NODE_TYPES).optional(),
  is_billing: z.boolean().optional(),
});

const assignZoneSchema = z.object({
  zone_id: z.string().uuid().nullable(),
});

// ── Settings ────────────────────────────────────────────────
const settingsSchema = z.object({
  settings: z.object({}).passthrough().optional(),
}).passthrough();

module.exports = {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  nameSchema,
  siteSchema,
  terrainSchema,
  zoneSchema,
  createPointSchema,
  updatePointSchema,
  assignZoneSchema,
  settingsSchema,
};
