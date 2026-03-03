// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { AppMode, User, Organization, Site, Terrain } from '@/types';
import { 
  mockUsers, 
  mockOrganizations, 
  mockSites, 
  mockTerrains,
  getSitesByOrgId,
  getTerrainsBySiteId,
} from '@/lib/mock-data';
import api from '@/lib/api';
import type { ApiOrg, ApiSite, ApiTerrain } from '@/lib/api';

// ── Mappers: API → frontend types ────────────────────────
function mapOrg(o: ApiOrg): Organization {
  return {
    id: o.id,
    name: o.name,
    slug: o.name.toLowerCase().replace(/\s+/g, '-'),
    status: 'active',
    plan: 'professional',
    sitesCount: 0,
    terrainsCount: 0,
    usersCount: 0,
    createdAt: o.created_at,
  };
}

function mapSite(s: ApiSite): Site {
  return {
    id: s.id,
    orgId: s.organization_id,
    name: s.name,
    address: s.location ?? undefined,
    timezone: 'Africa/Ouagadougou',
    terrainsCount: 0,
    status: 'online',
    createdAt: s.created_at,
  };
}

function mapTerrain(t: ApiTerrain): Terrain {
  return {
    id: t.id,
    siteId: t.site_id,
    name: t.name,
    gatewayId: t.gateway_id ?? '',
    status: 'online',
    lastSeen: new Date().toISOString(),
    dataCompleteness24h: 0,
    messageRate: 0,
    errorRate: 0,
    pointsCount: 0,
    unmappedDevicesCount: 0,
  };
}

interface AppContextType {
  // Mode
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  
  // Current user
  currentUser: User;
  setCurrentUser: (user: User) => void;

  // Auth
  isAuthenticated: boolean;
  login: (email: string, password: string, remember: boolean) => { ok: boolean; reason?: 'invalid' | 'locked'; lockedUntil?: number };
  logout: () => void;
  authLock: {
    failedAttempts: number;
    lockedUntil: number | null;
    maxAttempts: number;
    lockDurationMs: number;
  };
  
  // Selection state
  selectedOrgId: string | null;
  selectedSiteId: string | null;
  selectedTerrainId: string | null;
  aggregatedView: boolean;
  
  // Computed data
  selectedOrg: Organization | null;
  selectedSite: Site | null;
  selectedTerrain: Terrain | null;
  availableOrgs: Organization[];
  availableSites: Site[];
  availableTerrains: Terrain[];
  
  // Actions
  selectOrg: (orgId: string | null) => void;
  selectSite: (siteId: string | null) => void;
  selectTerrain: (terrainId: string | null) => void;
  setAggregatedView: (value: boolean) => void;

  // Org configuration
  hasSolar: boolean;
  setHasSolar: (value: boolean) => void;
  
  // For platform mode
  focusedOrgId: string | null;
  setFocusedOrgId: (orgId: string | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

const getStoredUserId = () => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('auth_user_id');
  } catch {
    return null;
  }
};

const getStoredSolarFlag = (orgId: string | null) => {
  if (typeof window === 'undefined' || !orgId) return true;
  try {
    const stored = localStorage.getItem(`simes_org_solar_${orgId}`);
    // Default to true for ISGE (org_1 has PV + Battery points)
    if (stored === null) return true;
    return stored === '1';
  } catch {
    return true;
  }
};


export function AppProvider({ children }: { children: ReactNode }) {
  const storedUserId = getStoredUserId();
  const storedUser = storedUserId ? mockUsers.find(u => u.id === storedUserId) ?? null : null;
  const isStoredPlatformUser = storedUser?.role === 'platform_super_admin';

  // Default to org mode with org admin user
  const [mode, setMode] = useState<AppMode>(storedUser?.role === 'platform_super_admin' ? 'platform' : 'org');
  const [currentUser, setCurrentUser] = useState<User>(storedUser ?? mockUsers[0]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!storedUserId);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  
  // Selection state
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(isStoredPlatformUser ? null : (storedUser?.orgId ?? 'org_1'));
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(isStoredPlatformUser ? null : 'site_1');
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(isStoredPlatformUser ? null : 'terrain_1');
  const [aggregatedView, setAggregatedView] = useState(false);

  const [hasSolar, setHasSolarState] = useState<boolean>(() => getStoredSolarFlag(isStoredPlatformUser ? null : (storedUser?.orgId ?? 'org_1')));
  
  // Platform mode state
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  // ── API-backed data (with mock fallback) ───────────────
  const [apiOrgs, setApiOrgs] = useState<Organization[] | null>(null);
  const [apiSites, setApiSites] = useState<Site[] | null>(null);
  const [apiTerrains, setApiTerrains] = useState<Terrain[] | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Fetch orgs from API on mount
  useEffect(() => {
    let cancelled = false;
    api.getOrgs()
      .then(orgs => {
        if (cancelled) return;
        setApiOrgs(orgs.map(mapOrg));
        setApiReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setApiReady(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch sites when org changes
  useEffect(() => {
    if (!selectedOrgId || !apiReady) { setApiSites(null); return; }
    let cancelled = false;
    api.getSites(selectedOrgId)
      .then(sites => {
        if (cancelled) return;
        setApiSites(sites.map(mapSite));
      })
      .catch(() => { if (!cancelled) setApiSites(null); });
    return () => { cancelled = true; };
  }, [selectedOrgId, apiReady]);

  // Fetch terrains when site changes
  useEffect(() => {
    if (!selectedSiteId || !apiReady) { setApiTerrains(null); return; }
    let cancelled = false;
    api.getTerrains(selectedSiteId)
      .then(terrains => {
        if (cancelled) return;
        setApiTerrains(terrains.map(mapTerrain));
      })
      .catch(() => { if (!cancelled) setApiTerrains(null); });
    return () => { cancelled = true; };
  }, [selectedSiteId, apiReady]);
  useEffect(() => {
    if (currentUser.role !== 'platform_super_admin') return;
    if (mode !== 'platform') {
      setMode('platform');
    }
    if (selectedOrgId !== null || selectedSiteId !== null || selectedTerrainId !== null || aggregatedView) {
      setSelectedOrgId(null);
      setSelectedSiteId(null);
      setSelectedTerrainId(null);
      setAggregatedView(false);
    }
  }, [currentUser.role, mode, selectedOrgId, selectedSiteId, selectedTerrainId, aggregatedView]);

  useEffect(() => {
    setHasSolarState(getStoredSolarFlag(selectedOrgId));
  }, [selectedOrgId]);


  
  // Computed values — API data first, mock fallback
  const allOrgs = apiReady && apiOrgs ? apiOrgs : mockOrganizations;
  const allSites = apiReady && apiSites ? apiSites : mockSites;
  const allTerrains = apiReady && apiTerrains ? apiTerrains : mockTerrains;

  const selectedOrg = selectedOrgId 
    ? allOrgs.find(o => o.id === selectedOrgId) ?? null
    : null;
  
  const selectedSite = selectedSiteId 
    ? allSites.find(s => s.id === selectedSiteId) ?? null
    : null;
  
  const selectedTerrain = selectedTerrainId 
    ? allTerrains.find(t => t.id === selectedTerrainId) ?? null
    : null;
  
  // Available options based on current selection
  const canViewAllOrgs = mode === 'platform' || currentUser.role === 'platform_super_admin';
  const availableOrgs = canViewAllOrgs 
    ? allOrgs 
    : allOrgs.filter(o => o.id === currentUser.orgId);
  
  const availableSites = selectedOrgId 
    ? (apiReady && apiSites ? apiSites : getSitesByOrgId(selectedOrgId))
    : [];
  
  const availableTerrains = selectedSiteId 
    ? (apiReady && apiTerrains ? apiTerrains : getTerrainsBySiteId(selectedSiteId))
    : [];
  
  // Actions
  const selectOrg = useCallback((orgId: string | null) => {
    setSelectedOrgId(orgId);
    // Reset site and terrain when org changes
    if (orgId) {
      // If we have API data, we can't immediately cascade since API data
      // loads async. Reset to null and let the useEffect for sites trigger.
      if (apiReady) {
        setSelectedSiteId(null);
        setSelectedTerrainId(null);
        // Will cascade-select first site when apiSites loads (see below)
      } else {
        const sites = getSitesByOrgId(orgId);
        if (sites.length > 0) {
          setSelectedSiteId(sites[0].id);
          const terrains = getTerrainsBySiteId(sites[0].id);
          if (terrains.length > 0) {
            setSelectedTerrainId(terrains[0].id);
          } else {
            setSelectedTerrainId(null);
          }
        } else {
          setSelectedSiteId(null);
          setSelectedTerrainId(null);
        }
      }
    } else {
      setSelectedSiteId(null);
      setSelectedTerrainId(null);
    }
  }, [apiReady]);

  // Auto-select first site/terrain when API data arrives
  useEffect(() => {
    if (!apiReady || !apiSites) return;
    if (selectedSiteId) return; // already selected
    if (apiSites.length > 0) {
      setSelectedSiteId(apiSites[0].id);
    }
  }, [apiSites, apiReady, selectedSiteId]);

  useEffect(() => {
    if (!apiReady || !apiTerrains) return;
    if (selectedTerrainId) return; // already selected
    if (apiTerrains.length > 0) {
      setSelectedTerrainId(apiTerrains[0].id);
    }
  }, [apiTerrains, apiReady, selectedTerrainId]);
  
  const selectSite = useCallback((siteId: string | null) => {
    setSelectedSiteId(siteId);
    // Reset terrain when site changes
    if (siteId) {
      if (apiReady) {
        setSelectedTerrainId(null); // will auto-select via useEffect
      } else {
        const terrains = getTerrainsBySiteId(siteId);
        if (terrains.length > 0) {
          setSelectedTerrainId(terrains[0].id);
        } else {
          setSelectedTerrainId(null);
        }
      }
    } else {
      setSelectedTerrainId(null);
    }
  }, [apiReady]);
  
  const selectTerrain = useCallback((terrainId: string | null) => {
    setSelectedTerrainId(terrainId);
  }, []);

  const setHasSolar = useCallback((value: boolean) => {
    setHasSolarState(value);
    if (typeof window === 'undefined' || !selectedOrgId) return;
    try {
      localStorage.setItem(`simes_org_solar_${selectedOrgId}`, value ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [selectedOrgId]);
  
  // Handle mode switching
  const handleSetMode = useCallback((newMode: AppMode) => {
    setMode(prev => {
      if (currentUser.role === 'platform_super_admin') {
        return 'platform';
      }
      return newMode;
    });
  }, [currentUser.role]);

  const login = useCallback((email: string, password: string, remember: boolean) => {
    if (lockedUntil && Date.now() < lockedUntil) {
      return { ok: false as const, reason: 'locked' as const, lockedUntil };
    }

    if (lockedUntil && Date.now() >= lockedUntil) {
      setLockedUntil(null);
      setFailedAttempts(0);
    }

    const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    const valid = !!user && password === 'demo1234';

    if (!valid) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);

      if (nextAttempts >= MAX_LOGIN_ATTEMPTS) {
        const until = Date.now() + LOCK_DURATION_MS;
        setLockedUntil(until);
        return { ok: false as const, reason: 'locked' as const, lockedUntil: until };
      }

      return { ok: false as const, reason: 'invalid' as const };
    }

    setFailedAttempts(0);
    setLockedUntil(null);
    setIsAuthenticated(true);
    setCurrentUser(user);
    const isPlatformUser = user.role === 'platform_super_admin';
    setMode(isPlatformUser ? 'platform' : 'org');
    if (isPlatformUser) {
      setSelectedOrgId(null);
      setSelectedSiteId(null);
      setSelectedTerrainId(null);
      setAggregatedView(false);
      setFocusedOrgId(null);
    } else if (user.orgId) {
      selectOrg(user.orgId);
    }

    if (typeof window !== 'undefined') {
      if (remember) {
        localStorage.setItem('auth_user_id', user.id);
      } else {
        localStorage.removeItem('auth_user_id');
      }
    }

    return { ok: true };
  }, [failedAttempts, lockedUntil, selectOrg]);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setFailedAttempts(0);
    setLockedUntil(null);
    setCurrentUser(mockUsers[0]);
    setMode('org');
    selectOrg('org_1');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_user_id');
    }
  }, [selectOrg]);
  
  const value: AppContextType = {
    mode,
    setMode: handleSetMode,
    currentUser,
    setCurrentUser,
    isAuthenticated,
    login,
    logout,
    authLock: {
      failedAttempts,
      lockedUntil,
      maxAttempts: MAX_LOGIN_ATTEMPTS,
      lockDurationMs: LOCK_DURATION_MS,
    },
    selectedOrgId,
    selectedSiteId,
    selectedTerrainId,
    aggregatedView,
    selectedOrg,
    selectedSite,
    selectedTerrain,
    availableOrgs,
    availableSites,
    availableTerrains,
    selectOrg,
    selectSite,
    selectTerrain,
    setAggregatedView,
    focusedOrgId,
    setFocusedOrgId,
    hasSolar,
    setHasSolar,
  };
  
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
