// ============================================================
// SIMES – React Query Hooks for real API data
// ============================================================
// Each hook fetches from the backend and returns typed data.
// They gracefully handle the "no backend yet" case by returning
// empty arrays or null so the UI can fall back to mock data.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ApiOrg, ApiSite, ApiTerrain, ApiZone, ApiMeasurementPoint } from '@/lib/api';

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
  energy_today: { import_kwh: number; export_kwh: number; net_kwh: number };
  last_update: string | null;
}

export function useDashboard(terrainId: string | null) {
  return useQuery<DashboardData>({
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
    refetchInterval: 15_000, // live refresh every 15s
    staleTime: 10_000,
    retry: 1,
  });
}

// ─── Latest Readings ───────────────────────────────────────

export function useLatestReadings(terrainId: string | null) {
  return useQuery({
    queryKey: ['readings-latest', terrainId],
    queryFn: () => api.getLatestReadings(terrainId!),
    enabled: !!terrainId,
    refetchInterval: 15_000,
    staleTime: 10_000,
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

// ─── Terrain Overview (points + zones + readings) ──────────

export function useTerrainOverview(terrainId: string | null) {
  return useQuery({
    queryKey: ['terrain-overview', terrainId],
    queryFn: () => api.getTerrainOverview(terrainId!),
    enabled: !!terrainId,
    refetchInterval: 30_000,
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
    mutationFn: ({ terrainId, ...data }: { terrainId: string; name: string; device: string; measure_category?: string; lora_dev_eui?: string; modbus_addr?: number; zone_id?: string }) =>
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
    mutationFn: ({ pointId, ...data }: { pointId: string; name: string; device?: string; measure_category?: string; status?: string }) =>
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
