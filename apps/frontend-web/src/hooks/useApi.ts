// ============================================================
// SIMES – React Query Hooks for real API data
// ============================================================
// Each hook fetches from the backend and returns typed data.
// They gracefully handle the "no backend yet" case by returning
// empty arrays or null so the UI can fall back to mock data.
// ============================================================

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Round a "from" timestamp down to the nearest `slotMin`-minute boundary
 * so that query keys remain stable for that window — preventing refetches
 * when a component remounts a few seconds later.
 */
export function stableFrom(agoMs: number, slotMin = 15): string {
  const slot = slotMin * 60_000;
  const now = Math.floor(Date.now() / slot) * slot;
  return new Date(now - agoMs).toISOString();
}
export function stableNow(slotMin = 15): string {
  const slot = slotMin * 60_000;
  return new Date(Math.floor(Date.now() / slot) * slot).toISOString();
}
import type { ApiOrg, ApiSite, ApiTerrain, ApiZone, ApiMeasurementPoint, TerrainOverviewPoint, TerrainOverviewZone } from '@/lib/api';

// ─── Type Definitions ──────────────────────────────────────

// ─── Referential ───────────────────────────────────────────

export function useOrgs() {
  return useQuery<ApiOrg[]>({
    queryKey: ['orgs'],
    queryFn: () => api.getOrgs(),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useSites(orgId: string | null) {
  return useQuery<ApiSite[]>({
    queryKey: ['sites', orgId],
    queryFn: () => api.getSites(orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useAllSites() {
  return useQuery({
    queryKey: ['all-sites'],
    queryFn: () => api.getAllSites(),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useTerrains(siteId: string | null) {
  return useQuery<ApiTerrain[]>({
    queryKey: ['terrains', siteId],
    queryFn: () => api.getTerrains(siteId!),
    enabled: !!siteId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useAllTerrains() {
  return useQuery({
    queryKey: ['all-terrains'],
    queryFn: () => api.getAllTerrains(),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useZones(terrainId: string | null) {
  return useQuery<ApiZone[]>({
    queryKey: ['zones', terrainId],
    queryFn: () => api.getZones(terrainId!),
    enabled: !!terrainId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function usePoints(terrainId: string | null) {
  return useQuery<ApiMeasurementPoint[]>({
    queryKey: ['points', terrainId],
    queryFn: () => api.getPoints(terrainId!),
    enabled: !!terrainId,
    staleTime: 30_000,
    retry: 1,
  });
}

// ─── Dashboard ─────────────────────────────────────────────

export interface DashboardData {
  points_count: number;
  power_now_kw: number;
  energy_today: { total_kwh: number; import_kwh: number; export_kwh: number; net_kwh: number };
  last_update: string | null;
}

export function useDashboard(terrainId: string | null) {
  return useQuery<DashboardData, Error, DashboardData>({
    queryKey: ['dashboard', terrainId],
    queryFn: async () => {
      const r = await api.getDashboard(terrainId!);
      return {
        points_count: r.points_count,
        power_now_kw: r.power_now_kw,
        energy_today: r.energy_today,
        last_update: r.last_update,
      };
    },
    enabled: !!terrainId,
    refetchInterval: 60_000,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

// ─── Latest Readings ───────────────────────────────────────

export interface LatestReadingsData {
  ok: boolean;
  terrain_id: string;
  count: number;
  readings: Array<Record<string, any>>;
}

export function useLatestReadings(terrainId: string | null) {
  return useQuery<LatestReadingsData, Error, LatestReadingsData>({
    queryKey: ['readings-latest', terrainId],
    queryFn: () => api.getLatestReadings(terrainId!),
    enabled: !!terrainId,
    refetchInterval: 60_000,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

// ─── Facture ───────────────────────────────────────────────

export function useSubmitFacture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { terrain_id: string; from?: string; to?: string; subscribed_power_kw?: number }) =>
      api.submitFacture(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facture-result'] });
    },
  });
}

export function useFactureResult(runId: string | null) {
  return useQuery({
    queryKey: ['facture-result', runId],
    queryFn: async () => {
      const r = await api.getRunResults(runId!);
      return r.results?.[0]?.result ?? null;
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      // Keep polling until we have a result
      return query.state.data ? false : 2_000;
    },
    retry: 3,
  });
}

export function useLatestFacture() {
  return useQuery({
    queryKey: ['facture-latest'],
    queryFn: async () => {
      try {
        const r = await api.getResult('facture');
        return r.result?.result ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

// ─── Tariffs ───────────────────────────────────────────────

export function useTariffPlans() {
  return useQuery({
    queryKey: ['tariff-plans'],
    queryFn: () => api.getTariffPlans(),
    staleTime: 300_000,
    retry: 1,
  });
}

export function useTerrainContract(terrainId: string | null) {
  return useQuery({
    queryKey: ['terrain-contract', terrainId],
    queryFn: () => api.getTerrainContract(terrainId!),
    enabled: !!terrainId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useSaveTerrainContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ terrainId, data }: {
      terrainId: string;
      data: {
        tariff_plan_id: string;
        subscribed_power_kw: number;
        meter_rental?: number;
        post_rental?: number;
        maintenance?: number;
        capacitor_power_kw?: number;
      };
    }) => api.setTerrainContract(terrainId, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['terrain-contract', vars.terrainId] });
    },
  });
}

// ─── Monthly Invoices (Facturation) ───────────────────────

export function useFactureMonths(terrainId: string | null) {
  return useQuery({
    queryKey: ['facture-months', terrainId],
    queryFn: () => api.getFactureMonths(terrainId!),
    enabled: !!terrainId,
    staleTime: 300_000,
    retry: 1,
  });
}

export function useFactureMonthly(terrainId: string | null, year?: number, month?: number, mode?: 'today') {
  return useQuery({
    queryKey: ['facture-monthly', terrainId, year, month, mode],
    queryFn: () => api.getFactureMonthly(terrainId!, year, month, mode),
    enabled: !!terrainId,
    staleTime: 60_000,
    retry: 1,
  });
}

// ─── Terrain Overview (points + zones + readings) ──────────

export interface TerrainOverviewData {
  ok: boolean;
  terrain_id: string;
  points: TerrainOverviewPoint[];
  zones: TerrainOverviewZone[];
  points_count: number;
  zones_count: number;
}

export function useTerrainOverview(terrainId: string | null) {
  return useQuery<TerrainOverviewData, Error, TerrainOverviewData>({
    queryKey: ['terrain-overview', terrainId],
    queryFn: async () => {
      const r = await api.getTerrainOverview(terrainId!);
      return {
        ...r,
        points_count: Array.isArray(r.points) ? r.points.length : 0,
        zones_count: Array.isArray(r.zones) ? r.zones.length : 0,
      };
    },
    enabled: !!terrainId,
    refetchInterval: 60_000,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

// ─── Power Peaks History ───────────────────────────────────

export function usePowerPeaks(terrainId: string | null, days = 30) {
  return useQuery({
    queryKey: ['power-peaks', terrainId, days],
    queryFn: () => api.getPowerPeaks(terrainId!, days),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useAnomalies(terrainId: string | null, days = 30) {
  return useQuery({
    queryKey: ['anomalies', terrainId, days],
    queryFn: () => api.getAnomalies(terrainId!, days),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useDetectAnomalies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (terrainId: string) => api.detectAnomalies(terrainId),
    onSuccess: (_d, terrainId) => { qc.invalidateQueries({ queryKey: ['anomalies', terrainId] }); },
  });
}

export function useMLForecast(terrainId: string | null, days = 30) {
  return useQuery({
    queryKey: ['mlForecast', terrainId, days],
    queryFn: () => api.getMLForecast(terrainId!, days),
    enabled: !!terrainId,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Backend-computed hourly forecast (replaces client-side computation) */
export function useHourlyForecast(
  terrainId: string | null,
  opts?: { days?: number; point_id?: string; history_days?: number },
) {
  return useQuery({
    queryKey: ['hourlyForecast', terrainId, opts],
    queryFn: () => api.getHourlyForecast(terrainId!, opts),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

/** Comparison profiles (today/yesterday actuals) for chart overlays */
export function useComparisonProfiles(terrainId: string | null, point_id?: string) {
  return useQuery({
    queryKey: ['comparisonProfiles', terrainId, point_id],
    queryFn: () => api.getComparisonProfiles(terrainId!, point_id),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Daily chart data (history + forecast combined) */
export function useDailyChartData(
  terrainId: string | null,
  opts?: { history_days?: number; forecast_days?: number },
) {
  return useQuery({
    queryKey: ['dailyChartData', terrainId, opts],
    queryFn: () => api.getDailyChartData(terrainId!, opts),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

// ─── Historical readings ───────────────────────────────────

export interface ReadingsData {
  ok: boolean;
  terrain_id: string;
  count: number;
  readings: Array<Record<string, any>>;
}

export function useReadings(terrainId: string | null, params?: { from?: string; to?: string; point_id?: string; limit?: number; cols?: string }) {
  return useQuery<ReadingsData, Error, ReadingsData>({
    queryKey: ['readings', terrainId, params],
    queryFn: () => api.getReadings(terrainId!, params),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

// ─── Pre-aggregated chart data (15m / daily buckets) ───────

export interface ChartDataResult {
  ok: boolean;
  terrain_id: string;
  bucket: string;
  count: number;
  data: Array<Record<string, any>>;
}

export function useChartData(
  terrainId: string | null,
  params: { from?: string; to?: string; bucket: '15m' | 'daily'; point_id?: string },
) {
  return useQuery<ChartDataResult, Error, ChartDataResult>({
    queryKey: ['chart-data', terrainId, JSON.stringify(params)],
    queryFn: () => api.getChartData(terrainId!, params),
    enabled: !!terrainId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

export function useEnergyHistory(
  terrainId: string | null,
  params: { from?: string; to?: string },
) {
  return useQuery({
    queryKey: ['energy-history', terrainId, JSON.stringify(params)],
    queryFn: () => api.getEnergyHistory(terrainId!, params),
    enabled: !!terrainId,
    staleTime: 15 * 60_000, // Cache for 15 min (historical data doesn't change much)
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

// ─── Runs ──────────────────────────────────────────────────

export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
    staleTime: 15_000,
    retry: 1,
  });
}

// ─── Admin: Gateways & Incoming ────────────────────────────

export function useGateways() {
  return useQuery({
    queryKey: ['admin-gateways'],
    queryFn: () => api.getGateways(),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useGatewayDevices(gatewayId: string | null) {
  return useQuery({
    queryKey: ['admin-gateway-devices', gatewayId],
    queryFn: () => api.getGatewayDevices(gatewayId!),
    enabled: !!gatewayId,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useIncoming(params?: { status?: string; gateway_id?: string }) {
  return useQuery({
    queryKey: ['admin-incoming', params],
    queryFn: () => api.getIncoming(params),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useProvisionGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gatewayId: string) => api.provisionGateway(gatewayId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

// ─── Admin mutations ───────────────────────────────────────

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createOrg(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orgs'] }); },
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, name }: { orgId: string; name: string }) => api.updateOrg(orgId, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orgs'] }); },
  });
}

export function useDeleteOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => api.deleteOrg(orgId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orgs'] }); },
  });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, name, location }: { orgId: string; name: string; location?: string }) =>
      api.createSite(orgId, name, location),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['sites', vars.orgId] }); },
  });
}

export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, name, location }: { siteId: string; name: string; location?: string }) =>
      api.updateSite(siteId, name, location),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); },
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteId: string) => api.deleteSite(siteId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); },
  });
}

export function useCreateTerrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, name, gateway_id }: { siteId: string; name: string; gateway_id?: string }) =>
      api.createTerrain(siteId, name, gateway_id),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['terrains', vars.siteId] }); },
  });
}

export function useUpdateTerrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ terrainId, name }: { terrainId: string; name: string }) => api.updateTerrain(terrainId, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['terrains'] }); },
  });
}

export function useDeleteTerrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (terrainId: string) => api.deleteTerrain(terrainId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['terrains'] }); },
  });
}

export function useCreatePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ terrainId, ...data }: { terrainId: string; name: string; device: string; measure_category?: string; lora_dev_eui?: string; modbus_addr?: number; zone_id?: string; ct_ratio?: number }) =>
      api.createPoint(terrainId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['points'] });
      qc.invalidateQueries({ queryKey: ['terrain-overview'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

export function useUpdatePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pointId, ...data }: { pointId: string; name: string; device?: string; measure_category?: string; status?: string; ct_ratio?: number }) =>
      api.updatePoint(pointId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['points'] });
      qc.invalidateQueries({ queryKey: ['terrain-overview'] });
    },
  });
}

export function useDeletePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pointId: string) => api.deletePoint(pointId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['points'] });
      qc.invalidateQueries({ queryKey: ['terrain-overview'] });
    },
  });
}

// ─── Zones ─────────────────────────────────────────────────

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, name, description }: { zoneId: string; name: string; description?: string }) =>
      api.updateZone(zoneId, name, description),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['zones'] }); },
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ terrainId, name, description }: { terrainId: string; name: string; description?: string }) =>
      api.createZone(terrainId, name, description),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['zones', vars.terrainId] }); },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (zoneId: string) => api.deleteZone(zoneId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['zones'] }); },
  });
}

// ─── Users ─────────────────────────────────────────────────

export function useUsers() {
  return useQuery<Array<{ id: string; email: string; name: string; role: string; orgId: string | null; active: boolean; createdAt: string; lastLoginAt: string | null }>>({
    queryKey: ['users'],
    queryFn: () => api.getUsers() as any,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; password: string; name: string; role?: string; organization_id?: string | null }) =>
      api.createUser(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...data }: { userId: string; name: string; email?: string; role?: string; organization_id?: string | null; active?: boolean; password?: string }) =>
      api.updateUser(userId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.deleteUser(userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}

export function useMapGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gatewayId, terrain_id }: { gatewayId: string; terrain_id: string }) =>
      api.mapGateway(gatewayId, { terrain_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
      qc.invalidateQueries({ queryKey: ['admin-incoming'] });
    },
  });
}

export function useDeleteGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gatewayId: string) => api.deleteGateway(gatewayId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

export function useMapDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { deviceKey: string; terrain_id: string; point_id: string; modbus_addr?: number; dev_eui?: string }) =>
      api.mapDevice(data.deviceKey, { terrain_id: data.terrain_id, point_id: data.point_id, modbus_addr: data.modbus_addr, dev_eui: data.dev_eui }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
      qc.invalidateQueries({ queryKey: ['admin-incoming'] });
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
    },
  });
}

export function useReplayIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.replayIncoming(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-incoming'] }); },
  });
}

export function useDeleteIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteIncoming(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-incoming'] });
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

export function useDeleteAllIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { status?: string; gateway_id?: string }) => api.deleteAllIncoming(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-incoming'] });
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

export function useReconcileIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reconcileIncoming(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-incoming'] });
      qc.invalidateQueries({ queryKey: ['admin-gateways'] });
      qc.invalidateQueries({ queryKey: ['admin-gateway-devices'] });
    },
  });
}

// ─── Incidents ─────────────────────────────────────────────

export function useIncidents(params?: { status?: string; severity?: string; terrain_id?: string }) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn: () => api.getIncidents(params),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useIncidentStats() {
  return useQuery({
    queryKey: ['incident-stats'],
    queryFn: () => api.getIncidentStats(),
    staleTime: 2 * 60_000,
    retry: 1,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description?: string; severity?: string; source?: string; terrain_id?: string; point_id?: string }) =>
      api.createIncident(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-stats'] });
    },
  });
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; severity?: string; assigned_to?: string; description?: string }) =>
      api.updateIncident(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-stats'] });
    },
  });
}

// ─── Audit Logs ────────────────────────────────────────────

export function useLogs(params?: { level?: string; source?: string; search?: string; limit?: number }) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => api.getLogs(params),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useLogStats() {
  return useQuery({
    queryKey: ['log-stats'],
    queryFn: () => api.getLogStats(),
    staleTime: 15_000,
    retry: 1,
  });
}

// ─── Pipeline Health ───────────────────────────────────────

export function usePipelineHealth() {
  return useQuery({
    queryKey: ['pipeline-health'],
    queryFn: () => api.getPipelineHealth(),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}
