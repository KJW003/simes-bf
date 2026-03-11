import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { User, Organization, Site, Terrain } from '@/types';
import api from '@/lib/api';
import type { ApiOrg, ApiSite, ApiTerrain } from '@/lib/api';

// ── Mappers ────────────────────────────────────────────
function mapOrg(o: ApiOrg): Organization {
  return { id: o.id, name: o.name, slug: o.name.toLowerCase().replace(/\s+/g, '-'), status: 'active', plan: 'professional', sitesCount: 0, terrainsCount: 0, usersCount: 0, createdAt: o.created_at };
}
function mapSite(s: ApiSite): Site {
  return { id: s.id, orgId: s.organization_id, name: s.name, address: s.location ?? undefined, timezone: 'Africa/Ouagadougou', terrainsCount: 0, status: 'online', createdAt: s.created_at };
}
function mapTerrain(t: ApiTerrain): Terrain {
  return { id: t.id, siteId: t.site_id, name: t.name, gatewayId: t.gateway_id ?? '', status: 'online', lastSeen: new Date().toISOString(), dataCompleteness24h: 0, messageRate: 0, errorRate: 0, pointsCount: 0, unmappedDevicesCount: 0 };
}

const getStoredSolarFlag = (orgId: string | null) => {
  if (typeof window === 'undefined' || !orgId) return true;
  try {
    const stored = localStorage.getItem(`simes_org_solar_${orgId}`);
    if (stored === null) return true;
    return stored === '1';
  } catch { return true; }
};

export interface TerrainContextType {
  selectedOrgId: string | null;
  selectedSiteId: string | null;
  selectedTerrainId: string | null;
  aggregatedView: boolean;
  selectedOrg: Organization | null;
  selectedSite: Site | null;
  selectedTerrain: Terrain | null;
  availableOrgs: Organization[];
  availableSites: Site[];
  availableTerrains: Terrain[];
  selectOrg: (orgId: string | null) => void;
  selectSite: (siteId: string | null) => void;
  selectTerrain: (terrainId: string | null) => void;
  setAggregatedView: (value: boolean) => void;
  focusedOrgId: string | null;
  setFocusedOrgId: (orgId: string | null) => void;
  hasSolar: boolean;
  setHasSolar: (value: boolean) => void;
  refreshHierarchy: () => Promise<void>;
  updateTerrainStats: (terrainId: string, stats: { pointsCount?: number; dataCompleteness24h?: number; status?: 'online' | 'degraded' | 'offline'; lastSeen?: string }) => void;
}

export const TerrainContext = createContext<TerrainContextType | undefined>(undefined);

export function TerrainProvider({
  children,
  isAuthenticated,
  currentUser,
  mode,
}: {
  children: ReactNode;
  isAuthenticated: boolean;
  currentUser: User;
  mode: string;
}) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const [aggregatedView, setAggregatedView] = useState(false);
  const [hasSolar, setHasSolarState] = useState(true);
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  const [apiOrgs, setApiOrgs] = useState<Organization[] | null>(null);
  const [apiSites, setApiSites] = useState<Site[] | null>(null);
  const [apiTerrains, setApiTerrains] = useState<Terrain[] | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Fetch orgs once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    api.getOrgs()
      .then(orgs => { if (!cancelled) { setApiOrgs(orgs.map(mapOrg)); setApiReady(true); } })
      .catch(() => { if (!cancelled) setApiReady(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Fetch sites when org changes
  useEffect(() => {
    if (!selectedOrgId || !apiReady) { setApiSites(null); return; }
    let cancelled = false;
    api.getSites(selectedOrgId)
      .then(sites => { if (!cancelled) setApiSites(sites.map(mapSite)); })
      .catch(() => { if (!cancelled) setApiSites(null); });
    return () => { cancelled = true; };
  }, [selectedOrgId, apiReady]);

  // Fetch terrains when site changes
  useEffect(() => {
    if (!selectedSiteId || !apiReady) { setApiTerrains(null); return; }
    let cancelled = false;
    api.getTerrains(selectedSiteId)
      .then(terrains => { if (!cancelled) setApiTerrains(terrains.map(mapTerrain)); })
      .catch(() => { if (!cancelled) setApiTerrains(null); });
    return () => { cancelled = true; };
  }, [selectedSiteId, apiReady]);

  // Force reset when super admin
  useEffect(() => {
    if (currentUser.role !== 'platform_super_admin') return;
    setSelectedOrgId(null);
    setSelectedSiteId(null);
    setSelectedTerrainId(null);
    setAggregatedView(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  useEffect(() => { setHasSolarState(getStoredSolarFlag(selectedOrgId)); }, [selectedOrgId]);

  // Computed values
  const allOrgs = apiOrgs ?? [];
  const allSites = apiSites ?? [];
  const allTerrains = apiTerrains ?? [];

  const selectedOrg = selectedOrgId ? allOrgs.find(o => o.id === selectedOrgId) ?? null : null;
  const selectedSite = selectedSiteId ? allSites.find(s => s.id === selectedSiteId) ?? null : null;
  const selectedTerrain = selectedTerrainId ? allTerrains.find(t => t.id === selectedTerrainId) ?? null : null;

  const canViewAllOrgs = mode === 'platform' || currentUser.role === 'platform_super_admin';
  const availableOrgs = canViewAllOrgs ? allOrgs : allOrgs.filter(o => o.id === currentUser.orgId);
  const availableSites = selectedOrgId ? allSites : [];
  const availableTerrains = selectedSiteId ? allTerrains : [];

  const selectOrg = useCallback((orgId: string | null) => {
    setSelectedOrgId(orgId);
    setSelectedSiteId(null);
    setSelectedTerrainId(null);
  }, []);

  // Auto-select first site
  useEffect(() => {
    if (!apiReady || !apiSites || apiSites.length === 0) return;
    if (selectedSiteId && apiSites.some(s => s.id === selectedSiteId)) return;
    setSelectedSiteId(apiSites[0].id);
  }, [apiSites, apiReady, selectedSiteId]);

  // Auto-select first terrain
  useEffect(() => {
    if (!apiReady || !apiTerrains || apiTerrains.length === 0) return;
    if (selectedTerrainId && apiTerrains.some(t => t.id === selectedTerrainId)) return;
    setSelectedTerrainId(apiTerrains[0].id);
  }, [apiTerrains, apiReady, selectedTerrainId]);

  const selectSite = useCallback((siteId: string | null) => {
    setSelectedSiteId(siteId);
    setSelectedTerrainId(null);
  }, []);

  const selectTerrain = useCallback((terrainId: string | null) => {
    setSelectedTerrainId(terrainId);
  }, []);

  const setHasSolar = useCallback((value: boolean) => {
    setHasSolarState(value);
    if (typeof window === 'undefined' || !selectedOrgId) return;
    try { localStorage.setItem(`simes_org_solar_${selectedOrgId}`, value ? '1' : '0'); } catch {}
  }, [selectedOrgId]);

  const updateTerrainStats = useCallback((terrainId: string, stats: { pointsCount?: number; dataCompleteness24h?: number; status?: 'online' | 'degraded' | 'offline'; lastSeen?: string }) => {
    setApiTerrains(prev => {
      if (!prev) return prev;
      return prev.map(t => t.id !== terrainId ? t : {
        ...t,
        ...(stats.pointsCount != null && { pointsCount: stats.pointsCount }),
        ...(stats.dataCompleteness24h != null && { dataCompleteness24h: stats.dataCompleteness24h }),
        ...(stats.status != null && { status: stats.status }),
        ...(stats.lastSeen != null && { lastSeen: stats.lastSeen }),
      });
    });
  }, []);

  const refreshHierarchy = useCallback(async () => {
    try {
      const orgs = await api.getOrgs();
      setApiOrgs(orgs.map(mapOrg));
      setApiReady(true);
      if (selectedOrgId) {
        const sites = await api.getSites(selectedOrgId);
        setApiSites(sites.map(mapSite));
        if (selectedSiteId) {
          const terrains = await api.getTerrains(selectedSiteId);
          setApiTerrains(terrains.map(mapTerrain));
        }
      }
    } catch { /* ignore */ }
  }, [selectedOrgId, selectedSiteId]);

  // Expose a method for auth to call on login
  const handleLoginUser = useCallback((user: User) => {
    if (user.role !== 'platform_super_admin' && user.orgId) {
      selectOrg(user.orgId);
    }
  }, [selectOrg]);

  const handleLogout = useCallback(() => {
    setSelectedOrgId(null);
    setSelectedSiteId(null);
    setSelectedTerrainId(null);
    setApiOrgs(null);
    setApiSites(null);
    setApiTerrains(null);
  }, []);

  const value: TerrainContextType & { _handleLoginUser: (u: User) => void; _handleLogout: () => void } = {
    selectedOrgId, selectedSiteId, selectedTerrainId, aggregatedView,
    selectedOrg, selectedSite, selectedTerrain,
    availableOrgs, availableSites, availableTerrains,
    selectOrg, selectSite, selectTerrain, setAggregatedView,
    focusedOrgId, setFocusedOrgId, hasSolar, setHasSolar, refreshHierarchy,
    updateTerrainStats,
    _handleLoginUser: handleLoginUser, _handleLogout: handleLogout,
  };

  return (
    <TerrainContext.Provider value={value as any}>
      {children}
    </TerrainContext.Provider>
  );
}

export function useTerrain() {
  const ctx = useContext(TerrainContext);
  if (!ctx) throw new Error('useTerrain must be used within TerrainProvider');
  return ctx;
}
