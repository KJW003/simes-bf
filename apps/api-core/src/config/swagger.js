module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SIMES-BF API',
    version: '1.0.0',
    description: 'Energy monitoring platform – REST API for core operations, telemetry, admin, and AI services.',
  },
  servers: [
    { url: '/api', description: 'Default (behind reverse proxy)' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: { type: 'string' },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Site: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          organization_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          location: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Terrain: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          site_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          gateway_model: { type: 'string' },
          gateway_id: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Zone: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          terrain_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      },
      MeasurementPoint: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          terrain_id: { type: 'string', format: 'uuid' },
          zone_id: { type: 'string', format: 'uuid', nullable: true },
          name: { type: 'string' },
          device: { type: 'string' },
          measure_category: { type: 'string', enum: ['LOAD', 'PV', 'BATTERY', 'GRID', 'UNKNOWN'] },
          lora_dev_eui: { type: 'string', nullable: true },
          modbus_addr: { type: 'integer', nullable: true },
          ct_ratio: { type: 'number', default: 1 },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['operator', 'manager', 'org_admin', 'platform_super_admin'] },
          orgId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      Reading: {
        type: 'object',
        properties: {
          time: { type: 'string', format: 'date-time' },
          point_id: { type: 'string', format: 'uuid' },
          active_power: { type: 'number' },
          voltage_a: { type: 'number' },
          current_a: { type: 'number' },
          energy_import: { type: 'number' },
          frequency: { type: 'number' },
          power_factor: { type: 'number' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Auth ─────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, token: { type: 'string' }, user: { $ref: '#/components/schemas/User' } } } } } },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user',
        responses: { 200: { description: 'Current user', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, user: { $ref: '#/components/schemas/User' } } } } } } },
      },
    },

    // ── Health ────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: { 200: { description: 'Service healthy' } },
      },
    },

    // ── Organizations ────────────────────────────────────
    '/orgs': {
      get: {
        tags: ['Referential'],
        summary: 'List all organizations',
        responses: { 200: { description: 'Array of organizations', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Organization' } } } } } },
      },
      post: {
        tags: ['Referential'],
        summary: 'Create an organization',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
        responses: { 201: { description: 'Created' } },
      },
    },

    // ── Sites ────────────────────────────────────────────
    '/orgs/{orgId}/sites': {
      get: {
        tags: ['Referential'],
        summary: 'List sites for an organization',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Array of sites' } },
      },
      post: {
        tags: ['Referential'],
        summary: 'Create a site',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, location: { type: 'string' } } } } } },
        responses: { 201: { description: 'Created' } },
      },
    },

    // ── Terrains ─────────────────────────────────────────
    '/sites/{siteId}/terrains': {
      get: {
        tags: ['Referential'],
        summary: 'List terrains for a site',
        parameters: [{ name: 'siteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Array of terrains' } },
      },
    },

    // ── Zones & Points ───────────────────────────────────
    '/terrains/{terrainId}/zones': {
      get: { tags: ['Referential'], summary: 'List zones', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Array of zones' } } },
      post: { tags: ['Referential'], summary: 'Create a zone', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { 201: { description: 'Created' } } },
    },
    '/terrains/{terrainId}/points': {
      get: { tags: ['Referential'], summary: 'List measurement points', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Array of points' } } },
      post: { tags: ['Referential'], summary: 'Create a measurement point', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'device'], properties: { name: { type: 'string' }, device: { type: 'string' }, measure_category: { type: 'string' }, zone_id: { type: 'string' }, modbus_addr: { type: 'integer' }, lora_dev_eui: { type: 'string' }, ct_ratio: { type: 'number' } } } } } }, responses: { 201: { description: 'Created' } } },
    },

    // ── Telemetry ────────────────────────────────────────
    '/terrains/{terrainId}/overview': {
      get: {
        tags: ['Telemetry'],
        summary: 'Full terrain overview (zones + points + counts)',
        parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Terrain overview with zones and points' } },
      },
    },
    '/terrains/{terrainId}/readings': {
      get: {
        tags: ['Telemetry'],
        summary: 'Query readings for a terrain (paginated, time-filtered)',
        parameters: [
          { name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'point_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 500 } },
        ],
        responses: { 200: { description: 'Readings array' } },
      },
    },
    '/terrains/{terrainId}/readings/latest': {
      get: {
        tags: ['Telemetry'],
        summary: 'Latest reading per point for a terrain',
        parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Latest readings per point' } },
      },
    },
    '/terrains/{terrainId}/dashboard': {
      get: {
        tags: ['Telemetry'],
        summary: 'Dashboard aggregated data for a terrain',
        parameters: [
          { name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Dashboard data with energy statistics' } },
      },
    },

    // ── Admin ────────────────────────────────────────────
    '/admin/gateways': {
      get: { tags: ['Admin'], summary: 'List registered gateways', responses: { 200: { description: 'Array of gateways' } } },
    },
    '/admin/gateways/{gatewayId}/map': {
      put: {
        tags: ['Admin'],
        summary: 'Map a gateway to a terrain',
        parameters: [{ name: 'gatewayId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['terrain_id'], properties: { terrain_id: { type: 'string', format: 'uuid' } } } } } },
        responses: { 200: { description: 'Mapping created' } },
      },
    },
    '/admin/gateways/{gatewayId}/provision': {
      post: {
        tags: ['Admin'],
        summary: 'Auto-provision: scan gateway devices and create measurement points',
        parameters: [{ name: 'gatewayId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { terrain_id: { type: 'string' }, device_model: { type: 'string', default: 'ADW300' }, default_category: { type: 'string', default: 'LOAD' } } } } } },
        responses: { 200: { description: 'Provisioning result with created/skipped devices' } },
      },
    },
    '/admin/incoming': {
      get: { tags: ['Admin'], summary: 'List incoming messages (raw stream)', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['unmapped', 'mapped', 'ignored'] } }], responses: { 200: { description: 'Array of incoming messages' } } },
    },

    // ── Incidents ────────────────────────────────────────
    '/terrains/{terrainId}/incidents': {
      get: { tags: ['Incidents'], summary: 'List incidents for a terrain', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Incidents array' } } },
      post: { tags: ['Incidents'], summary: 'Create an incident manually', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 201: { description: 'Created' } } },
    },

    // ── Tariffs ──────────────────────────────────────────
    '/terrains/{terrainId}/contract': {
      get: { tags: ['Tariffs'], summary: 'Get terrain contract (tariff plan, subscribed power)', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Contract details' } } },
      put: { tags: ['Tariffs'], summary: 'Upsert terrain contract', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated' } } },
    },
    '/tariff-plans': {
      get: { tags: ['Tariffs'], summary: 'List all tariff plans', responses: { 200: { description: 'Tariff plans array' } } },
    },

    // ── AI / Forecasting ─────────────────────────────────
    '/ai/forecast/{terrainId}': {
      get: {
        tags: ['AI'],
        summary: 'Request energy consumption forecast',
        parameters: [
          { name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 30, default: 7 } },
        ],
        responses: { 200: { description: 'Forecast result' } },
      },
    },

    // ── Logs ─────────────────────────────────────────────
    '/terrains/{terrainId}/logs': {
      get: { tags: ['System'], summary: 'Get audit logs for a terrain', parameters: [{ name: 'terrainId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Logs array' } } },
    },
  },
};
