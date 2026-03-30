// ============================================================
// SIMES – API Client
// ============================================================
// Central fetch wrapper reading VITE_API_URL from env.
// Every method returns typed data or throws on error.
// ============================================================

const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

interface ApiRequestError extends Error {
  status?: number;
  body?: unknown;
  fallback?: unknown;
}

function fallbackFromError<T>(err: unknown): T | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const candidate = err as { fallback?: unknown };
  return candidate.fallback as T | undefined;
}

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs: number = 30000): Promise<T> {
  const url = `${BASE}${path}`;
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add timeout abort signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const bodyRecord = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
      const message = typeof bodyRecord.error === 'string' ? bodyRecord.error : `API ${res.status}`;
      const error = new Error(message) as ApiRequestError;
      error.status = res.status;
      error.body = body;
      if ('fallback' in bodyRecord) {
        error.fallback = bodyRecord.fallback;
      }
      throw error;
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function logUiAction(action: string, metadata?: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') {
  try {
    await request<{ ok: boolean }>('/logs/ui', {
      method: 'POST',
      body: JSON.stringify({ action, level, metadata: metadata ?? {} }),
    }, 8000);
  } catch {
    // Do not break UX if audit call fails.
  }
}

// ─── Referential ───────────────────────────────────────────

export interface ApiOrg {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiSite {
  id: string;
  organization_id: string;
  name: string;
  location: string | null;
  created_at: string;
}

export interface ApiTerrain {
  id: string;
  site_id: string;
  name: string;
  gateway_model: string | null;
  gateway_id: string | null;
  created_at: string;
}

export interface ApiZone {
  id: string;
  terrain_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export type NodeType = 'source' | 'tableau' | 'depart' | 'charge';

export interface ApiMeasurementPoint {
  id: string;
  terrain_id: string;
  zone_id: string | null;
  name: string;
  device: string;
  measure_category: string;
  lora_dev_eui: string | null;
  modbus_addr: string | null;
  ct_ratio: number;
  meta: Record<string, unknown>;
  status: string;
  created_at: string;
  // Hierarchical fields
  parent_id: string | null;
  node_type: NodeType;
  is_billing: boolean;
  // PV system assignment
  pv_system_id: string | null;
}

export interface ApiPvSystem {
  id: string;
  terrain_id: string;
  name: string;
  description?: string;
  location?: string;
  installed_capacity_kwc?: number;
  installation_date?: string;
  expected_tilt_degrees?: number;
  expected_orientation?: string;
  created_at: string;
  updated_at: string;
  point_count?: number;
  active_point_count?: number;
  points?: ApiMeasurementPoint[];
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string | null;
  siteAccess: string[];
  avatar: string;
  active?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

/**
 * Point data from terrain overview endpoint
 */
export interface TerrainOverviewPoint {
  id: string;
  name: string;
  readings?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Zone data from terrain overview endpoint
 */
export interface TerrainOverviewZone {
  id: string;
  name: string;
  [key: string]: unknown;
}

// ── Energy Audit Types ──
export interface ApiAuditReport {
  id: string;
  terrain_id: string;
  terrain_name?: string;
  run_id: string | null;
  period_from: string;
  period_to: string;
  efficiency_score: number;
  score_label: string;
  diagnostics: Array<{ label: string; status: 'ok' | 'warning' | 'critical'; detail: string }>;
  recommendations: Array<{ priority: 'Haute' | 'Moyenne' | 'Basse'; title: string; impact: string; points?: string[] }>;
  point_diagnostics: Array<{ point_id: string; name: string; pf: number | null; thdA: number | null; vUnbal: number | null; power: number; score: number }>;
  kpi: {
    points_count: number;
    readings_count: number;
    pf_global: number | null;
    thd_max: number;
    thd_avg: number | null;
    v_unbalance_max: number;
    data_completeness_pct: number;
    energy_kwh: number;
  };
  status: 'pending' | 'computing' | 'ready' | 'failed';
  error: string | null;
  requested_by: string | null;
  created_at: string;
  computed_at: string | null;
}

// ── Solar Scenario Types ──
export interface ApiSolarScenario {
  id: string;
  terrain_id: string;
  terrain_name?: string;
  run_id: string | null;
  name: string;
  method: 'average_load' | 'peak_demand' | 'theoretical_production' | 'available_surface';
  params: Record<string, number>;
  results: Record<string, unknown>;
  financial: {
    install_cost_xof?: number;
    annual_production_kwh?: number;
    annual_savings_xof?: number;
    payback_years?: number;
    roi_25y_pct?: number;
    npv_xof?: number;
    co2_avoided_kg_year?: number;
  };
  status: 'draft' | 'computing' | 'ready' | 'failed';
  error: string | null;
  created_by: string | null;
  created_at: string;
  computed_at: string | null;
}

export const api = {
  // ── Auth ──
  login: (email: string, password: string) =>
    request<{ ok: boolean; token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, 60000),  // 60s timeout for bcrypt verification

  me: () => request<{ ok: boolean; user: ApiUser }>('/auth/me'),

  logout: () => request<{ ok: boolean; message: string }>('/auth/logout', { method: 'POST' }),

  // ── User Settings (server-side persistence) ──
  getSettings: () => request<{ ok: boolean; settings: Record<string, unknown> }>('/auth/settings'),
  saveSettings: (settings: Record<string, unknown>) =>
    request<{ ok: boolean; settings: Record<string, unknown> }>('/auth/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),
  patchSettings: (settings: Record<string, unknown>) =>
    request<{ ok: boolean; settings: Record<string, unknown> }>('/auth/settings', {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    }),

  // ── Orgs ──
  getOrgs: () => request<ApiOrg[]>('/orgs'),
  createOrg: (name: string) =>
    request<ApiOrg>('/orgs', { method: 'POST', body: JSON.stringify({ name }) }),
  updateOrg: (orgId: string, name: string) =>
    request<ApiOrg>(`/orgs/${orgId}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteOrg: (orgId: string) =>
    request<{ ok: boolean; deleted: string }>(`/orgs/${orgId}`, { method: 'DELETE' }),

  // ── Sites ──
  getAllSites: () => request<Array<ApiSite & { org_name?: string }>>('/sites'),
  getSites: (orgId: string) => request<ApiSite[]>(`/orgs/${orgId}/sites`),
  createSite: (orgId: string, name: string, location?: string) =>
    request<ApiSite>(`/orgs/${orgId}/sites`, {
      method: 'POST',
      body: JSON.stringify({ name, location }),
    }),
  updateSite: (siteId: string, name: string, location?: string) =>
    request<ApiSite>(`/sites/${siteId}`, { method: 'PUT', body: JSON.stringify({ name, location }) }),
  deleteSite: (siteId: string) =>
    request<{ ok: boolean; deleted: string }>(`/sites/${siteId}`, { method: 'DELETE' }),

  // ── Terrains ──
  getAllTerrains: () => request<Array<ApiTerrain & { site_name?: string; org_name?: string; org_id?: string }>>('/terrains'),
  getTerrains: (siteId: string) => request<ApiTerrain[]>(`/sites/${siteId}/terrains`),
  createTerrain: (siteId: string, name: string, gateway_id?: string) =>
    request<ApiTerrain>(`/sites/${siteId}/terrains`, {
      method: 'POST',
      body: JSON.stringify({ name, gateway_id }),
    }),
  updateTerrain: (terrainId: string, name: string) =>
    request<ApiTerrain>(`/terrains/${terrainId}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteTerrain: (terrainId: string) =>
    request<{ ok: boolean; deleted: string }>(`/terrains/${terrainId}`, { method: 'DELETE' }),

  // ── Site tree ──
  getSiteTree: (siteId: string) =>
    request<{ site: ApiSite; terrains: Array<{ terrain: ApiTerrain; zones: ApiZone[]; points: ApiMeasurementPoint[] }> }>(
      `/sites/${siteId}/tree`,
    ),

  // ── Zones ──
  getZones: (terrainId: string) => request<ApiZone[]>(`/terrains/${terrainId}/zones`),
  createZone: (terrainId: string, name: string, description?: string) =>
    request<ApiZone>(`/terrains/${terrainId}/zones`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updateZone: (zoneId: string, name: string, description?: string) =>
    request<ApiZone>(`/zones/${zoneId}`, { method: 'PUT', body: JSON.stringify({ name, description }) }),
  deleteZone: (zoneId: string) =>
    request<{ ok: boolean; deleted: string }>(`/zones/${zoneId}`, { method: 'DELETE' }),

  // ── Points ──
  getPoints: (terrainId: string) =>
    request<ApiMeasurementPoint[]>(`/terrains/${terrainId}/points`),

  assignZone: (pointId: string, zoneId: string | null) =>
    request<ApiMeasurementPoint>(`/points/${pointId}/assign-zone`, {
      method: 'PATCH',
      body: JSON.stringify({ zone_id: zoneId }),
    }),

  updatePoint: (pointId: string, data: {
    name: string; device?: string; measure_category?: string; status?: string; ct_ratio?: number;
    parent_id?: string | null; node_type?: NodeType; is_billing?: boolean;
  }) =>
    request<ApiMeasurementPoint>(`/points/${pointId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePoint: (pointId: string) =>
    request<{ ok: boolean; deleted: string }>(`/points/${pointId}`, { method: 'DELETE' }),

  // ── Dashboard ──
  getDashboard: (terrainId: string) =>
    request<{
      ok: boolean;
      terrain_id: string;
      points_count: number;
      power_now_kw: number;
      energy_today: { total_kwh: number; import_kwh: number; export_kwh: number; net_kwh: number };
      last_update: string | null;
    }>(`/terrains/${terrainId}/dashboard`),

  // ── Telemetry readings ──
  getLatestReadings: (terrainId: string) =>
    request<{
      ok: boolean;
      terrain_id: string;
      count: number;
      readings: Array<{
        point_id: string;
        time: string;
        voltage_a: number; voltage_b: number; voltage_c: number;
        current_a: number; current_b: number; current_c: number;
        active_power_total: number;
        reactive_power_total: number;
        apparent_power_total: number;
        power_factor_total: number;
        frequency: number;
        energy_import: number;
        energy_export: number;
        energy_total: number;
        point: ApiMeasurementPoint | null;
      }>;
    }>(`/terrains/${terrainId}/readings/latest`),

  getReadings: (terrainId: string, params?: { from?: string; to?: string; point_id?: string; limit?: number; cols?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.point_id) qs.set('point_id', params.point_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cols) qs.set('cols', params.cols);
    const q = qs.toString();
    return request<{
      ok: boolean;
      terrain_id: string;
      count: number;
      readings: Array<Record<string, unknown>>;
    }>(`/terrains/${terrainId}/readings${q ? `?${q}` : ''}`);
  },

  getChartData: (terrainId: string, params: { from?: string; to?: string; bucket: '15m' | 'daily'; point_id?: string }) => {
    const qs = new URLSearchParams();
    qs.set('bucket', params.bucket);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.point_id) qs.set('point_id', params.point_id);
    return request<{
      ok: boolean;
      terrain_id: string;
      bucket: string;
      count: number;
      data: Array<Record<string, unknown>>;
    }>(`/terrains/${terrainId}/chart-data?${qs.toString()}`);
  },

  getEnergyHistory: (terrainId: string, params: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    return request<{
      ok: boolean;
      terrain_id: string;
      count: number;
      data: Array<{ day: string; energy_total_delta: number; points_count: number }>;
    }>(`/terrains/${terrainId}/energy-history?${qs.toString()}`);
  },

  // ── Jobs (facture, forecast, etc.) ──
  submitFacture: (payload: { terrain_id: string; from?: string; to?: string; subscribed_power_kw?: number }) =>
    request<{ id: string; type: string; status: string; created_at: string }>('/jobs/facture', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitJob: async (type: string, payload?: Record<string, unknown>) => {
    try {
      const result = await request<{ id: string; type: string; status: string; created_at: string }>(`/jobs/${type}`, {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      });
      await logUiAction('job.submit', { type, runId: result.id });
      return result;
    } catch (e: any) {
      await logUiAction('job.submit.failed', { type, error: e?.message }, 'warn');
      throw e;
    }
  },

  // ── Runs ──
  getRuns: () =>
    request<Array<{ id: string; type: string; status: string; payload: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; created_at: string; started_at: string | null; finished_at: string | null }>>('/runs'),

  cancelJob: async (jobId: string) => {
    try {
      const result = await request<{ ok: boolean; jobId: string; cancelled: boolean; queueJobRemoved: boolean }>(
        `/jobs/cancel/${encodeURIComponent(jobId)}`,
        { method: 'POST' },
      );
      await logUiAction('job.cancel', { jobId, queueJobRemoved: result.queueJobRemoved }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('job.cancel.failed', { jobId, error: e?.message }, 'error');
      throw e;
    }
  },

  // ── Results ──
  getResult: (type: string, runId?: string) => {
    const qs = runId ? `?runId=${runId}` : '';
    return request<{
      ok: boolean;
      result: {
        id: string;
        run_id: string;
        type: string;
        result: Record<string, unknown>;
        created_at: string;
      };
    }>(`/results/${type}${qs}`);
  },

  getRunResults: (runId: string) =>
    request<{ ok: boolean; runId: string; results: Array<{ id: string; type: string; result: Record<string, unknown>; created_at: string }> }>(
      `/results/run/${runId}`,
    ),

  // ── Admin ──
  getGateways: () =>
    request<{ ok: boolean; gateways: Array<Record<string, unknown>> }>('/admin/gateways'),

  provisionGateway: (gatewayId: string) =>
    request<Record<string, unknown>>(`/admin/gateways/${gatewayId}/provision`, { method: 'POST' }),

  // ── Tariffs ──
  getTariffPlans: (group?: string) => {
    const qs = group ? `?group=${group}` : '';
    return request<{ ok: boolean; tariffs: Array<{ id: string; group_code: string; plan_code: string; name: string; [key: string]: unknown }> }>(`/tariffs${qs}`);
  },

  // ── Monthly Invoices (Facturation) ──
  getFactureMonths: (terrainId: string) =>
    request<{ ok: boolean; months: Array<{ year: number; month: number; display: string; status: string; lastUpdated: string }> }>
      (`/results/facture/monthly/months?terrainId=${terrainId}`),

  getFactureMonthly: (terrainId: string, year?: number, month?: number, mode?: 'today') => {
    const qs = new URLSearchParams();
    qs.set('terrainId', terrainId);
    if (mode === 'today') {
      qs.set('mode', 'today');
    } else if (year && month) {
      qs.set('year', String(year));
      qs.set('month', String(month));
    }
    return request<Record<string, unknown>>(`/results/facture/monthly?${qs.toString()}`);
  },

  getTerrainContract: (terrainId: string) =>
    request<Record<string, unknown>>(`/terrains/${terrainId}/contract`),

  getTerrainOverview: (terrainId: string) =>
    request<{ ok: boolean; terrain_id: string; points: TerrainOverviewPoint[]; zones: TerrainOverviewZone[] }>(
      `/terrains/${terrainId}/overview`,
    ),

  getPowerPeaks: (terrainId: string, days = 30) =>
    request<{ ok: boolean; terrain_id: string; peaks: Array<{ point_id: string; peak_date: string; max_power: number; peak_time: string; point_name: string }> }>(
      `/terrains/${terrainId}/power-peaks?days=${days}`,
    ),

  getIncoming: (params?: { status?: string; gateway_id?: string; device_key?: string; include_processed?: boolean; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.gateway_id) qs.set('gateway_id', params.gateway_id);
    if (params?.device_key) qs.set('device_key', params.device_key);
    if (params?.include_processed) qs.set('include_processed', 'true');
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<{ ok: boolean; rows: Array<Record<string, unknown>> }>(`/admin/incoming${q ? `?${q}` : ''}`);
  },

  getGatewayDevices: (gatewayId: string) =>
    request<{ ok: boolean; devices: Array<Record<string, unknown>> }>(`/admin/gateways/${gatewayId}/devices`),

  postSandboxIncoming: async (payload: {
    topic?: string;
    gateway_id?: string | null;
    modbus_addr?: number | null;
    dev_eui?: string | null;
    time?: string | null;
    metrics?: Record<string, unknown>;
    source?: Record<string, unknown>;
    device?: Record<string, unknown>;
    raw?: Record<string, unknown>;
  }) => {
    try {
      const result = await request<{ ok: boolean; count: number; messages: Array<Record<string, unknown>> }>(
        '/admin/incoming/sandbox',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      await logUiAction('incoming.sandbox.inject', { count: result.count, gateway_id: payload.gateway_id }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('incoming.sandbox.inject.failed', { error: e?.message, gateway_id: payload.gateway_id }, 'error');
      throw e;
    }
  },

  processHistoricalMessages: async (terrainId: string, deviceKey: string) => {
    try {
      const result = await request<{
        ok: boolean;
        summary?: { total: number; processed: number; failed: number };
        message?: string;
      }>(
        `/admin/devices/${encodeURIComponent(terrainId)}/${encodeURIComponent(deviceKey)}/process-historical`,
        { method: 'POST' },
      );
      await logUiAction('incoming.process_historical', { terrainId, deviceKey }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('incoming.process_historical.failed', { terrainId, deviceKey, error: e?.message }, 'error');
      throw e;
    }
  },

  processUnmappedIncoming: async () => {
    try {
      const result = await request<{ ok: boolean; processed: number; enqueued: number; failed: number }>(
        '/incoming/process-unmapped',
        { method: 'POST' },
      );
      await logUiAction('incoming.process_unmapped', { processed: result.processed, enqueued: result.enqueued }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('incoming.process_unmapped.failed', { error: e?.message }, 'error');
      throw e;
    }
  },

  getCleanupLogs: (last = 50) =>
    request<{ ok: boolean; total_lines?: number; returned?: number; logs: string[]; message?: string }>(
      `/logs/cleanup?last=${last}`,
    ),

  getSchedulerLogs: (last = 50) =>
    request<{ ok: boolean; total_lines?: number; returned?: number; logs: string[]; message?: string }>(
      `/logs/scheduler?last=${last}`,
    ),

  setTerrainContract: (terrainId: string, data: {
    tariff_plan_id: string;
    subscribed_power_kw: number;
    meter_rental?: number;
    post_rental?: number;
    maintenance?: number;
    capacitor_power_kw?: number;
  }) =>
    request<Record<string, unknown>>(`/terrains/${terrainId}/contract`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ─── Admin mapping ─────────────────────────────────────
  mapGateway: (gatewayId: string, data: { terrain_id: string; meta?: Record<string, unknown> }) =>
    request<{ ok: boolean; gateway: Record<string, unknown> }>(
      `/admin/gateways/${encodeURIComponent(gatewayId)}/map`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),

  deleteGateway: (gatewayId: string) =>
    request<{ ok: boolean; deleted: string }>(
      `/admin/gateways/${encodeURIComponent(gatewayId)}`,
      { method: 'DELETE' },
    ),

  mapDevice: (deviceKey: string, data: { terrain_id: string; point_id: string; modbus_addr?: number | null; dev_eui?: string | null }) =>
    request<{ ok: boolean; device: Record<string, unknown> }>(
      `/admin/devices/${encodeURIComponent(deviceKey)}/map`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),

  unmapDevice: (deviceKey: string, data: { terrain_id: string }) =>
    request<{ ok: boolean; unmapped: Record<string, unknown>; reverted_messages: number }>(
      `/admin/devices/${encodeURIComponent(deviceKey)}/map?terrain_id=${encodeURIComponent(data.terrain_id)}`,
      { method: 'DELETE' },
    ),

  replayIncoming: async (id: string) => {
    try {
      const result = await request<{ ok: boolean; replayed: boolean; ingest: Record<string, unknown> }>(
        `/admin/incoming/${id}/replay`,
        { method: 'POST' },
      );
      await logUiAction('incoming.replay', { id });
      return result;
    } catch (e: any) {
      await logUiAction('incoming.replay.failed', { id, error: e?.message }, 'warn');
      throw e;
    }
  },

  deleteIncoming: async (id: string) => {
    try {
      const result = await request<{ ok: boolean; deleted: string }>(
        `/admin/incoming/${id}`,
        { method: 'DELETE' },
      );
      await logUiAction('incoming.delete', { id });
      return result;
    } catch (e: any) {
      await logUiAction('incoming.delete.failed', { id, error: e?.message }, 'warn');
      throw e;
    }
  },

  deleteAllIncoming: async (params?: { status?: string; gateway_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.gateway_id) qs.set('gateway_id', params.gateway_id);
    const q = qs.toString();
    try {
      const result = await request<{ ok: boolean; deleted_count: number }>(
        `/admin/incoming${q ? `?${q}` : ''}`,
        { method: 'DELETE' },
      );
      await logUiAction('incoming.delete_all', { ...params, deleted_count: result.deleted_count });
      return result;
    } catch (e: any) {
      await logUiAction('incoming.delete_all.failed', { ...params, error: e?.message }, 'warn');
      throw e;
    }
  },

  reconcileIncoming: async () => {
    try {
      const result = await request<{ ok: boolean; reconciled: number }>('/admin/incoming/reconcile', { method: 'POST' });
      await logUiAction('incoming.reconcile', { reconciled: result.reconciled });
      return result;
    } catch (e: any) {
      await logUiAction('incoming.reconcile.failed', { error: e?.message }, 'warn');
      throw e;
    }
  },

  createPoint: (terrainId: string, data: {
    name: string; device: string; measure_category?: string;
    lora_dev_eui?: string | null; modbus_addr?: number | null; zone_id?: string | null; ct_ratio?: number;
    parent_id?: string | null; node_type?: NodeType; is_billing?: boolean;
  }) =>
    request<ApiMeasurementPoint>(`/terrains/${terrainId}/points`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ── Users ──
  getUsers: () => request<ApiUser[]>('/users'),
  createUser: (data: { email: string; password: string; name: string; role?: string; organization_id?: string | null }) =>
    request<ApiUser>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (userId: string, data: { name: string; email?: string; role?: string; organization_id?: string | null; active?: boolean; password?: string }) =>
    request<ApiUser>(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (userId: string) =>
    request<{ ok: boolean; deleted: string }>(`/users/${userId}`, { method: 'DELETE' }),

  // ── Incidents ──
  getIncidents: (params?: { status?: string; severity?: string; terrain_id?: string; source?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.terrain_id) qs.set('terrain_id', params.terrain_id);
    if (params?.source) qs.set('source', params.source);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return request<{ ok: boolean; incidents: unknown[]; total: number }>(`/incidents${q ? `?${q}` : ''}`);
  },
  getIncidentStats: () => request<{ ok: boolean; breakdown: unknown[]; open_count: number; critical_count: number; total: number }>('/incidents/stats'),
  createIncident: (data: { title: string; description?: string; severity?: string; source?: string; terrain_id?: string; point_id?: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; incident: unknown }>('/incidents', { method: 'POST', body: JSON.stringify(data) }),
  updateIncident: (id: string, data: { status?: string; severity?: string; assigned_to?: string; description?: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; incident: unknown }>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Audit Logs ──
  getLogs: (params?: { level?: string; source?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.level) qs.set('level', params.level);
    if (params?.source) qs.set('source', params.source);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return request<{ ok: boolean; logs: unknown[]; total: number }>(`/logs${q ? `?${q}` : ''}`);
  },
  getLogStats: () => request<{ ok: boolean; stats: unknown[] }>('/logs/stats'),

  // ── Pipeline Health ──
  getPipelineHealth: () => request<{ ok: boolean; components: unknown[]; checked_at: string }>('/health/pipeline'),

  // ── Purge readings ──
  purgeReadings: (pointId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return request<{ ok: boolean; point: string; deleted: { readings: number; agg_15m: number; agg_daily: number }; range: { from: string | null; to: string | null } }>(
      `/admin/readings/${pointId}${q ? `?${q}` : ''}`,
      { method: 'DELETE' }
    );
  },

  // ── Batch purge multiple points ──
  batchPurgePreview: async (data: { pointIds: string[]; from?: string; to?: string }) => {
    try {
      const result = await request<{
        ok: boolean;
        points_requested: number;
        points_found: number;
        points_missing: number;
        point_ids: string[];
        point_names: string[];
        totals: { readings: number; agg_15m: number; agg_daily: number };
        range: { from: string | null; to: string | null };
      }>('/admin/readings/batch-purge-preview', { method: 'POST', body: JSON.stringify(data) });
      await logUiAction('readings.batch_purge.preview', {
        pointsCount: data.pointIds.length,
        from: data.from,
        to: data.to,
        totals: result.totals,
      }, 'info');
      return result;
    } catch (e: any) {
      await logUiAction('readings.batch_purge.preview.failed', { pointsCount: data.pointIds.length, error: e?.message }, 'error');
      throw e;
    }
  },

  batchPurgeReadings: async (data: { pointIds: string[]; from?: string; to?: string }) => {
    try {
      const result = await request<{
      ok: boolean;
      points_purged: number;
      details: Array<{
        point_id: string;
        point_name: string;
        deleted: { readings: number; agg_15m: number; agg_daily: number };
      }>;
      totals: { readings: number; agg_15m: number; agg_daily: number };
      range: { from: string | null; to: string | null };
      }>('/admin/readings/batch-purge', { method: 'POST', body: JSON.stringify(data) });
      await logUiAction('readings.batch_purge', {
        pointsCount: data.pointIds.length,
        from: data.from,
        to: data.to,
        deleted: result.totals,
      }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('readings.batch_purge.failed', { pointsCount: data.pointIds.length, error: e?.message }, 'error');
      throw e;
    }
  },

  // ── Purge by date range (all points) ──
  purgeByRangePreview: async (data: { from: string; to: string; includeReadings?: boolean }) => {
    try {
      const result = await request<{
        ok: boolean;
        includeReadings: boolean;
        range: { from: string; to: string };
        normalized_range: { from: string; to: string };
        totals: { readings: number; agg_15m: number; agg_daily: number };
      }>(
        '/admin/readings/purge-range-preview', { method: 'POST', body: JSON.stringify(data) }
      );
      await logUiAction('readings.purge_range.preview', { ...data, totals: result.totals }, 'info');
      return result;
    } catch (e: any) {
      await logUiAction('readings.purge_range.preview.failed', { ...data, error: e?.message }, 'error');
      throw e;
    }
  },

  purgeByRange: async (data: { from: string; to: string; includeReadings?: boolean }) => {
    try {
      const result = await request<{ ok: boolean; range: { from: string; to: string }; purge_batch_id: string; deleted: { readings: number; agg_15m: number; agg_daily: number } }>(
        '/admin/readings/purge-range', { method: 'POST', body: JSON.stringify(data) }
      );
      await logUiAction('readings.purge_range', { ...data, deleted: result.deleted }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('readings.purge_range.failed', { ...data, error: e?.message }, 'error');
      throw e;
    }
  },

  // ── Purge batches (trash / restore) ──
  getPurgeBatches: () =>
    request<{ ok: boolean; batches: Array<{ id: string; deleted_at: string; deleted_by: string | null; point_ids: string[]; date_from: string | null; date_to: string | null; counts: { readings: number; agg_15m: number; agg_daily: number }; restored_at: string | null }> }>(
      '/admin/purge-batches'
    ),
  restorePurgeBatch: async (batchId: string) => {
    try {
      const result = await request<{ ok: boolean; purge_batch_id: string; restored: { readings: number; agg_15m: number; agg_daily: number } }>(
        `/admin/purge-batches/${encodeURIComponent(batchId)}/restore`, { method: 'POST' }
      );
      await logUiAction('purge_batch.restore', { batchId, restored: result.restored }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('purge_batch.restore.failed', { batchId, error: e?.message }, 'error');
      throw e;
    }
  },
  deletePurgeBatch: async (batchId: string) => {
    try {
      const result = await request<{ ok: boolean }>(
        `/admin/purge-batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' }
      );
      await logUiAction('purge_batch.delete', { batchId }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('purge_batch.delete.failed', { batchId, error: e?.message }, 'error');
      throw e;
    }
  },

  // ── Pipeline Repair Actions ──
  repairAggregations: async (data: { from: string; to: string; point_id?: string; terrain_id?: string; site_id?: string }) => {
    try {
      const result = await request<{ ok: boolean; message: string }>('/admin/pipeline/repair-aggregations', { method: 'POST', body: JSON.stringify(data) });
      await logUiAction('pipeline.repair_aggregations', data, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('pipeline.repair_aggregations.failed', { ...data, error: e?.message }, 'error');
      throw e;
    }
  },
  retryFailedJobs: async (queue?: string, limit?: number) => {
    try {
      const result = await request<{ ok: boolean; queue: string; retried: number; total_failed: number }>('/admin/pipeline/retry-failed-jobs', { method: 'POST', body: JSON.stringify({ queue, limit }) });
      await logUiAction('pipeline.retry_failed_jobs', { queue: result.queue, retried: result.retried, total_failed: result.total_failed }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('pipeline.retry_failed_jobs.failed', { queue, limit, error: e?.message }, 'error');
      throw e;
    }
  },
  flushFailedJobs: async (queue?: string) => {
    try {
      const result = await request<{ ok: boolean; queue: string; removed: number }>('/admin/pipeline/flush-failed-jobs', { method: 'POST', body: JSON.stringify({ queue }) });
      await logUiAction('pipeline.flush_failed_jobs', { queue: result.queue, removed: result.removed }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('pipeline.flush_failed_jobs.failed', { queue, error: e?.message }, 'error');
      throw e;
    }
  },
  reprocessUnmapped: async (limit?: number) => {
    try {
      const result = await request<{ ok: boolean; message: string }>('/admin/pipeline/reprocess-unmapped', { method: 'POST', body: JSON.stringify({ limit }) });
      await logUiAction('pipeline.reprocess_unmapped', { limit }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('pipeline.reprocess_unmapped.failed', { limit, error: e?.message }, 'error');
      throw e;
    }
  },

  // ── Disk Recovery ──
  getDiskStats: () =>
    request<{
      ok: boolean;
      database_size: number;
      database_size_human: string;
      trash_batches: number;
      oldest_trash: string | null;
      tables: Array<{
        table: string;
        row_count: number;
        total_bytes: number;
        table_bytes: number;
        index_bytes: number;
        total_human: string;
        error?: string;
      }>;
    }>('/admin/disk-stats'),
  runDiskRecovery: async (opts?: { trash_max_age_days?: number; vacuum?: boolean; dry_run?: boolean }) => {
    try {
      const result = await request<{
      ok: boolean;
      dry_run: boolean;
      trash_batches_removed: number;
      vacuumed: string[];
      db_size_before: number;
      db_size_after: number;
      recovered: number;
      recovered_human: string;
      db_size_before_human: string;
      db_size_after_human: string;
      }>('/admin/disk-recovery', { method: 'POST', body: JSON.stringify(opts ?? {}) });
      await logUiAction('disk.recovery.run', { ...opts, recovered_human: result.recovered_human }, 'warn');
      return result;
    } catch (e: any) {
      await logUiAction('disk.recovery.run.failed', { ...opts, error: e?.message }, 'error');
      throw e;
    }
  },

  /** Base URL for raw fetch calls (e.g. file downloads) */
  baseURL: BASE,

  // ── AI / ML Forecasts ──
  getMLForecast: (terrainId: string | number, days: number) =>
    request<{
      forecast: Array<{ day: string; predicted_kwh: number; lower: number; upper: number }>;
      model_mape: number | null;
      model_rmse: number | null;
      model_type?: string;
      warnings?: string[];
    }>(`/ai/forecast/${terrainId}?days=${days}`),
  trainMLModel: (terrainId: string | number) =>
    request<{ terrain_id: number; status: string; samples: number; mape: number | null; rmse: number | null; message: string }>(`/ai/train/${terrainId}`, { method: 'POST' }),
  getMLModelStatus: (terrainId: string | number) =>
    request<{ terrain_id: number; status: string; mape: number | null; rmse: number | null; samples: number | null }>(`/ai/model/${terrainId}`),

  // ── Hourly Forecasts (backend-computed) ──
  getHourlyForecast: (terrainId: string | number, opts?: { days?: number; point_id?: string; history_days?: number }) =>
    request<{
      terrain_id: string;
      point_id: string | null;
      model_type: string;
      confidence_level: number;
      data_days: number;
      daily_avg_kw: number;
      trend_per_day: number;
      warnings: string[] | null;
      hourly_forecast: Array<{
        day: string;
        day_iso: string;
        hours: Array<{ hour: number; predicted_kw: number; lower: number; upper: number }>;
      }>;
      daily_forecast: Array<{ day: string; day_iso: string; predicted_kwh: number; lower: number; upper: number }>;
      history_summary: { n_days: number; daily_avg: number; std_dev: number; slope: number };
    }>(`/ai/forecast/hourly/${terrainId}?${new URLSearchParams({
      ...(opts?.days ? { days: String(opts.days) } : {}),
      ...(opts?.point_id ? { point_id: opts.point_id } : {}),
      ...(opts?.history_days ? { history_days: String(opts.history_days) } : {}),
    }).toString()}`).catch((err: unknown) => {
      const fallback = fallbackFromError<{
        terrain_id: string;
        point_id: string | null;
        model_type: string;
        confidence_level: number;
        data_days: number;
        daily_avg_kw: number;
        trend_per_day: number;
        warnings: string[] | null;
        hourly_forecast: Array<{
          day: string;
          day_iso: string;
          hours: Array<{ hour: number; predicted_kw: number; lower: number; upper: number }>;
        }>;
        daily_forecast: Array<{ day: string; day_iso: string; predicted_kwh: number; lower: number; upper: number }>;
        history_summary: { n_days: number; daily_avg: number; std_dev: number; slope: number };
      }>(err);
      if (fallback) return fallback;
      throw err;
    }),

  getComparisonProfiles: (terrainId: string | number, point_id?: string) =>
    request<{
      terrain_id: string;
      point_id: string | null;
      warnings?: string[];
      today: Array<{ hour: number; kw: number | null }>;
      yesterday: Array<{ hour: number; kw: number | null }>;
    }>(`/ai/forecast/profiles/${terrainId}${point_id ? `?point_id=${point_id}` : ''}`).catch((err: unknown) => {
      const fallback = fallbackFromError<{
        terrain_id: string;
        point_id: string | null;
        warnings?: string[];
        today: Array<{ hour: number; kw: number | null }>;
        yesterday: Array<{ hour: number; kw: number | null }>;
      }>(err);
      if (fallback) return fallback;
      throw err;
    }),

  getDailyChartData: (terrainId: string | number, opts?: { history_days?: number; forecast_days?: number }) =>
    request<{
      terrain_id: string;
      history_days: number;
      forecast_days: number;
      warnings?: string[];
      chart_data: Array<{
        day: string;
        day_iso: string | null;
        actual_kwh: number | null;
        actual_max: number | null;
        predicted_kwh: number | null;
        upper: number | null;
        lower: number | null;
        type: 'history' | 'forecast';
      }>;
    }>(`/ai/forecast/daily-chart/${terrainId}?${new URLSearchParams({
      ...(opts?.history_days ? { history_days: String(opts.history_days) } : {}),
      ...(opts?.forecast_days ? { forecast_days: String(opts.forecast_days) } : {}),
    }).toString()}`).catch((err: unknown) => {
      const fallback = fallbackFromError<{
        terrain_id: string;
        history_days: number;
        forecast_days: number;
        warnings?: string[];
        chart_data: Array<{
          day: string;
          day_iso: string | null;
          actual_kwh: number | null;
          actual_max: number | null;
          predicted_kwh: number | null;
          upper: number | null;
          lower: number | null;
          type: 'history' | 'forecast';
        }>;
      }>(err);
      if (fallback) return fallback;
      throw err;
    }),

  // ── AI Anomaly Detection ──
  getAnomalies: (terrainId: string | number, days = 30) =>
    request<{ anomalies: Array<{ id: number; terrain_id: number; point_id: string | null; anomaly_date: string; anomaly_type: string; severity: string; score: number; expected_kwh: number | null; actual_kwh: number | null; deviation_pct: number | null; description: string | null; resolved: boolean }> }>(`/ai/anomalies/${terrainId}?days=${days}`),
  detectAnomalies: (terrainId: string | number) =>
    request<{ residual: { found: number }; isolation_forest: { found: number } }>(`/ai/anomalies/detect/${terrainId}`, { method: 'POST' }),

  // ── Energy Audits ──
  getAuditReports: (terrainId: string, params?: { limit?: number; offset?: number }) =>
    request<{ ok: boolean; audits: ApiAuditReport[]; total: number }>(
      `/audits?terrain_id=${terrainId}&limit=${params?.limit ?? 50}&offset=${params?.offset ?? 0}`
    ),
  getAuditReport: (id: string) =>
    request<{ ok: boolean; audit: ApiAuditReport }>(`/audits/${id}`),
  getLatestAudit: (terrainId: string) =>
    request<{ ok: boolean; audit: ApiAuditReport }>(`/audits/latest/${terrainId}`),
  submitAudit: (terrainId: string) =>
    request<{ ok: boolean; audit_id: string; run: { id: string; status: string } }>('/audits', {
      method: 'POST',
      body: JSON.stringify({ terrain_id: terrainId }),
    }),
  deleteAudit: (id: string) =>
    request<{ ok: boolean; deleted: boolean }>(`/audits/${id}`, { method: 'DELETE' }),

  // ── Solar Scenarios ──
  getSolarScenarios: (terrainId: string, params?: { method?: string; limit?: number }) =>
    request<{ ok: boolean; scenarios: ApiSolarScenario[]; total: number }>(
      `/solar/scenarios?terrain_id=${terrainId}&limit=${params?.limit ?? 50}${params?.method ? `&method=${params.method}` : ''}`
    ),
  getSolarScenario: (id: string) =>
    request<{ ok: boolean; scenario: ApiSolarScenario }>(`/solar/scenarios/${id}`),
  createSolarScenario: (payload: { terrain_id: string; name?: string; method?: string; params?: Record<string, number> }) =>
    request<{ ok: boolean; scenario_id: string; run: { id: string; status: string } }>('/solar/scenarios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteSolarScenario: (id: string) =>
    request<{ ok: boolean; deleted: boolean }>(`/solar/scenarios/${id}`, { method: 'DELETE' }),
  getSolarDefaults: (method: string) =>
    request<{ ok: boolean; method: string; defaults: Record<string, number> }>(`/solar/defaults/${method}`),

  // ── PV Systems ──
  getPvSystems: (terrainId: string) =>
    request<{ ok: boolean; systems: ApiPvSystem[] }>(`/pv/systems?terrain_id=${terrainId}`),
  getPvSystem: (id: string) =>
    request<{ ok: boolean; system: ApiPvSystem }>(`/pv/systems/${id}`),
  createPvSystem: (payload: Omit<ApiPvSystem, 'id' | 'created_at' | 'updated_at'>) =>
    request<{ ok: boolean; system: ApiPvSystem }>('/pv/systems', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePvSystem: (id: string, payload: Partial<ApiPvSystem>) =>
    request<{ ok: boolean; system: ApiPvSystem }>(`/pv/systems/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePvSystem: (id: string) =>
    request<{ ok: boolean; deleted: boolean }>(`/pv/systems/${id}`, { method: 'DELETE' }),
  assignPointToPvSystem: (pointId: string, pvSystemId: string | null) =>
    request<{ ok: boolean; point: ApiMeasurementPoint }>('/pv/assign', {
      method: 'POST',
      body: JSON.stringify({ point_id: pointId, pv_system_id: pvSystemId }),
    }),
};

export default api;
