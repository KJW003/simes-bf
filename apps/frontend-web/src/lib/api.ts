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
      const error = new Error(body.error ?? `API ${res.status}`) as any;
      error.status = res.status;
      throw error;
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeoutId);
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

export const api = {
  // ── Auth ──
  login: (email: string, password: string) =>
    request<{ ok: boolean; token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, 60000),  // 60s timeout for bcrypt verification

  me: () => request<{ ok: boolean; user: ApiUser }>('/auth/me'),

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

  // ── Jobs (facture, forecast, etc.) ──
  submitFacture: (payload: { terrain_id: string; from?: string; to?: string; subscribed_power_kw?: number }) =>
    request<{ id: string; type: string; status: string; created_at: string }>('/jobs/facture', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitJob: (type: string, payload?: Record<string, unknown>) =>
    request<{ id: string; type: string; status: string; created_at: string }>(`/jobs/${type}`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),

  // ── Runs ──
  getRuns: () =>
    request<Array<{ id: string; type: string; status: string; payload: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; created_at: string; started_at: string | null; finished_at: string | null }>>('/runs'),

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
    request<{ ok: boolean; terrain_id: string; points: TerrainOverviewPoint[]; zones: TerrainOverviewZone[] }>(
      `/terrains/${terrainId}/overview`,
    ),

  getPowerPeaks: (terrainId: string, days = 30) =>
    request<{ ok: boolean; terrain_id: string; peaks: Array<{ point_id: string; peak_date: string; max_power: number; peak_time: string; point_name: string }> }>(
      `/terrains/${terrainId}/power-peaks?days=${days}`,
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
    return request<{ ok: boolean; incidents: any[]; total: number }>(`/incidents${q ? `?${q}` : ''}`);
  },
  getIncidentStats: () => request<{ ok: boolean; breakdown: any[]; open_count: number; critical_count: number; total: number }>('/incidents/stats'),
  createIncident: (data: { title: string; description?: string; severity?: string; source?: string; terrain_id?: string; point_id?: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; incident: any }>('/incidents', { method: 'POST', body: JSON.stringify(data) }),
  updateIncident: (id: string, data: { status?: string; severity?: string; assigned_to?: string; description?: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; incident: any }>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Audit Logs ──
  getLogs: (params?: { level?: string; source?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.level) qs.set('level', params.level);
    if (params?.source) qs.set('source', params.source);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return request<{ ok: boolean; logs: any[]; total: number }>(`/logs${q ? `?${q}` : ''}`);
  },
  getLogStats: () => request<{ ok: boolean; stats: any[] }>('/logs/stats'),

  // ── Pipeline Health ──
  getPipelineHealth: () => request<{ ok: boolean; components: any[]; checked_at: string }>('/health/pipeline'),

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
  batchPurgeReadings: (data: { pointIds: string[]; from?: string; to?: string }) =>
    request<{
      ok: boolean;
      points_purged: number;
      details: Array<{
        point_id: string;
        point_name: string;
        deleted: { readings: number; agg_15m: number; agg_daily: number };
      }>;
      totals: { readings: number; agg_15m: number; agg_daily: number };
      range: { from: string | null; to: string | null };
    }>('/admin/readings/batch-purge', { method: 'POST', body: JSON.stringify(data) }),

  // ── Purge by date range (all points) ──
  purgeByRange: (data: { from: string; to: string; includeReadings?: boolean }) =>
    request<{ ok: boolean; range: { from: string; to: string }; purge_batch_id: string; deleted: { readings: number; agg_15m: number; agg_daily: number } }>(
      '/admin/readings/purge-range', { method: 'POST', body: JSON.stringify(data) }
    ),

  // ── Purge batches (trash / restore) ──
  getPurgeBatches: () =>
    request<{ ok: boolean; batches: Array<{ id: string; deleted_at: string; deleted_by: string | null; point_ids: string[]; date_from: string | null; date_to: string | null; counts: { readings: number; agg_15m: number; agg_daily: number }; restored_at: string | null }> }>(
      '/admin/purge-batches'
    ),
  restorePurgeBatch: (batchId: string) =>
    request<{ ok: boolean; purge_batch_id: string; restored: { readings: number; agg_15m: number; agg_daily: number } }>(
      `/admin/purge-batches/${encodeURIComponent(batchId)}/restore`, { method: 'POST' }
    ),
  deletePurgeBatch: (batchId: string) =>
    request<{ ok: boolean }>(
      `/admin/purge-batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' }
    ),

  // ── Pipeline Repair Actions ──
  repairAggregations: (data: { from: string; to: string; point_id?: string; terrain_id?: string; site_id?: string }) =>
    request<{ ok: boolean; message: string }>('/admin/pipeline/repair-aggregations', { method: 'POST', body: JSON.stringify(data) }),
  retryFailedJobs: (queue?: string, limit?: number) =>
    request<{ ok: boolean; queue: string; retried: number; total_failed: number }>('/admin/pipeline/retry-failed-jobs', { method: 'POST', body: JSON.stringify({ queue, limit }) }),
  flushFailedJobs: (queue?: string) =>
    request<{ ok: boolean; queue: string; removed: number }>('/admin/pipeline/flush-failed-jobs', { method: 'POST', body: JSON.stringify({ queue }) }),
  reprocessUnmapped: (limit?: number) =>
    request<{ ok: boolean; message: string }>('/admin/pipeline/reprocess-unmapped', { method: 'POST', body: JSON.stringify({ limit }) }),

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
  runDiskRecovery: (opts?: { trash_max_age_days?: number; vacuum?: boolean; dry_run?: boolean }) =>
    request<{
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
    }>('/admin/disk-recovery', { method: 'POST', body: JSON.stringify(opts ?? {}) }),

  /** Base URL for raw fetch calls (e.g. file downloads) */
  baseURL: BASE,

  // ── AI / ML Forecasts ──
  getMLForecast: (terrainId: string | number, days: number) =>
    request<{ forecast: Array<{ day: string; predicted_kwh: number; lower: number; upper: number }>; model_mape: number | null; model_rmse: number | null }>(`/ai/forecast/${terrainId}?days=${days}`),
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
    }).toString()}`),

  getComparisonProfiles: (terrainId: string | number, point_id?: string) =>
    request<{
      terrain_id: string;
      point_id: string | null;
      today: Array<{ hour: number; kw: number | null }>;
      yesterday: Array<{ hour: number; kw: number | null }>;
    }>(`/ai/forecast/profiles/${terrainId}${point_id ? `?point_id=${point_id}` : ''}`),

  getDailyChartData: (terrainId: string | number, opts?: { history_days?: number; forecast_days?: number }) =>
    request<{
      terrain_id: string;
      history_days: number;
      forecast_days: number;
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
    }).toString()}`),

  // ── AI Anomaly Detection ──
  getAnomalies: (terrainId: string | number, days = 30) =>
    request<{ anomalies: Array<{ id: number; terrain_id: number; point_id: string | null; anomaly_date: string; anomaly_type: string; severity: string; score: number; expected_kwh: number | null; actual_kwh: number | null; deviation_pct: number | null; description: string | null; resolved: boolean }> }>(`/ai/anomalies/${terrainId}?days=${days}`),
  detectAnomalies: (terrainId: string | number) =>
    request<{ residual: { found: number }; isolation_forest: { found: number } }>(`/ai/anomalies/detect/${terrainId}`, { method: 'POST' }),
};

export default api;
