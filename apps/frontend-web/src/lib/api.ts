// ============================================================
// SIMES – API Client
// ============================================================
// Central fetch wrapper reading VITE_API_URL from env.
// Every method returns typed data or throws on error.
// ============================================================

const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
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

export const api = {
  // ── Auth ──
  login: (email: string, password: string) =>
    request<{ ok: boolean; token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ ok: boolean; user: ApiUser }>('/auth/me'),

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

  updatePoint: (pointId: string, data: { name: string; device?: string; measure_category?: string; status?: string; ct_ratio?: number }) =>
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
      energy_today: { import_kwh: number; export_kwh: number; net_kwh: number };
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

  getReadings: (terrainId: string, params?: { from?: string; to?: string; point_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.point_id) qs.set('point_id', params.point_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<{
      ok: boolean;
      terrain_id: string;
      count: number;
      readings: Array<Record<string, unknown>>;
    }>(`/terrains/${terrainId}/readings${q ? `?${q}` : ''}`);
  },

  // ── Jobs (facture, forecast, etc.) ──
  submitFacture: (payload: { terrain_id: string; from?: string; to?: string; subscribed_power_kw?: number }) =>
    request<{ id: string; type: string; status: string; created_at: string }>('/jobs/facture', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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
    return request<Array<Record<string, unknown>>>(`/tariffs${qs}`);
  },

  getTerrainContract: (terrainId: string) =>
    request<Record<string, unknown>>(`/terrains/${terrainId}/contract`),

  getTerrainOverview: (terrainId: string) =>
    request<{ ok: boolean; terrain_id: string; points: Array<Record<string, unknown>>; zones: Array<Record<string, unknown>> }>(
      `/terrains/${terrainId}/overview`,
    ),

  getIncoming: (params?: { status?: string; gateway_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.gateway_id) qs.set('gateway_id', params.gateway_id);
    const q = qs.toString();
    return request<{ ok: boolean; rows: Array<Record<string, unknown>> }>(`/admin/incoming${q ? `?${q}` : ''}`);
  },

  getGatewayDevices: (gatewayId: string) =>
    request<{ ok: boolean; devices: Array<Record<string, unknown>> }>(`/admin/gateways/${gatewayId}/devices`),

  setTerrainContract: (terrainId: string, data: { tariff_plan_id: string; subscribed_power_kw: number }) =>
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

  replayIncoming: (id: string) =>
    request<{ ok: boolean; replayed: boolean; ingest: Record<string, unknown> }>(
      `/admin/incoming/${id}/replay`,
      { method: 'POST' },
    ),

  deleteIncoming: (id: string) =>
    request<{ ok: boolean; deleted: string }>(
      `/admin/incoming/${id}`,
      { method: 'DELETE' },
    ),

  deleteAllIncoming: (params?: { status?: string; gateway_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.gateway_id) qs.set('gateway_id', params.gateway_id);
    const q = qs.toString();
    return request<{ ok: boolean; deleted_count: number }>(
      `/admin/incoming${q ? `?${q}` : ''}`,
      { method: 'DELETE' },
    );
  },

  reconcileIncoming: () =>
    request<{ ok: boolean; reconciled: number }>('/admin/incoming/reconcile', { method: 'POST' }),

  createPoint: (terrainId: string, data: { name: string; device: string; measure_category?: string; lora_dev_eui?: string | null; modbus_addr?: number | null; zone_id?: string | null; ct_ratio?: number }) =>
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
};

export default api;
