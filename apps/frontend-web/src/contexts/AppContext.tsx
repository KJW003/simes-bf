// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import type { AppMode, User, Organization, Site, Terrain } from '@/types';
import api from '@/lib/api';
import type { ApiOrg, ApiSite, ApiTerrain, ApiUser } from '@/lib/api';

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
  sessionChecked: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<{ ok: boolean; reason?: 'invalid' | 'locked' | 'network'; lockedUntil?: number }>;
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

  // Refresh after admin mutations
  refreshHierarchy: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

const getStoredToken = () => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
};

function apiUserToUser(u: ApiUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as User['role'],
    orgId: u.orgId ?? undefined,
    siteAccess: u.siteAccess,
    avatar: u.avatar,
  };
}

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
  const hasToken = !!getStoredToken();

  const [mode, setMode] = useState<AppMode>('org');
  const [currentUser, setCurrentUser] = useState<User>({ id: '', name: '', email: '', role: 'operator' } as User);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [sessionChecked, setSessionChecked] = useState(!hasToken); // true immediately if no token
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  
  // Selection state
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const [aggregatedView, setAggregatedView] = useState(false);

  const [hasSolar, setHasSolarState] = useState<boolean>(true);
  
  // Platform mode state
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  // ── Session restore via /auth/me ───────────────────────
  const sessionRestoreRan = useRef(false);
  useEffect(() => {
    if (sessionRestoreRan.current) return;
    sessionRestoreRan.current = true;
    if (!hasToken) return; // no token → stay unauthenticated
    api.me()
      .then(resp => {
        if (resp.ok && resp.user) {
          const u = apiUserToUser(resp.user);
          setCurrentUser(u);
          setIsAuthenticated(true);
          const isPlatform = u.role === 'platform_super_admin';
          setMode(isPlatform ? 'platform' : 'org');
          if (!isPlatform && u.orgId) {
            setSelectedOrgId(u.orgId);
          }
        } else {
          // Invalid token — clean up
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user_id');
        }
      })
      .catch(() => {
        // API unreachable — clear stale token
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user_id');
      })
      .finally(() => setSessionChecked(true));
  }, [hasToken]);

  // ── API-backed data ────────────────────────────────────
  const [apiOrgs, setApiOrgs] = useState<Organization[] | null>(null);
  const [apiSites, setApiSites] = useState<Site[] | null>(null);
  const [apiTerrains, setApiTerrains] = useState<Terrain[] | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Fetch orgs from API once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
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
  }, [isAuthenticated]);

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
  // Force platform mode for super admins (only on role change)
  useEffect(() => {
    if (currentUser.role !== 'platform_super_admin') return;
    setMode('platform');
    setSelectedOrgId(null);
    setSelectedSiteId(null);
    setSelectedTerrainId(null);
    setAggregatedView(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  useEffect(() => {
    setHasSolarState(getStoredSolarFlag(selectedOrgId));
  }, [selectedOrgId]);


  
  // Computed values — API data (no mock fallback)
  const allOrgs = apiOrgs ?? [];
  const allSites = apiSites ?? [];
  const allTerrains = apiTerrains ?? [];

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
  
  const availableSites = selectedOrgId ? allSites : [];
  
  const availableTerrains = selectedSiteId ? allTerrains : [];
  
  // Actions
  const selectOrg = useCallback((orgId: string | null) => {
    setSelectedOrgId(orgId);
    // Reset site and terrain when org changes
    if (orgId) {
      // Reset and let useEffect auto-select when API data arrives
      setSelectedSiteId(null);
      setSelectedTerrainId(null);
    } else {
      setSelectedSiteId(null);
      setSelectedTerrainId(null);
    }
  }, []);

  // Auto-select first site when sites list arrives (and nothing selected)
  useEffect(() => {
    if (!apiReady || !apiSites || apiSites.length === 0) return;
    if (selectedSiteId && apiSites.some(s => s.id === selectedSiteId)) return; // still valid
    setSelectedSiteId(apiSites[0].id);
  }, [apiSites, apiReady, selectedSiteId]);

  useEffect(() => {
    if (!apiReady || !apiTerrains || apiTerrains.length === 0) return;
    if (selectedTerrainId && apiTerrains.some(t => t.id === selectedTerrainId)) return; // still valid
    setSelectedTerrainId(apiTerrains[0].id);
  }, [apiTerrains, apiReady, selectedTerrainId]);
  
  const selectSite = useCallback((siteId: string | null) => {
    setSelectedSiteId(siteId);
    setSelectedTerrainId(null); // will auto-select via useEffect
  }, []);
  
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

  const loginSuccess = useCallback((user: User, remember: boolean, token?: string) => {
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
      if (token) {
        localStorage.setItem('auth_token', token);
      }
    }
  }, [selectOrg]);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    if (lockedUntil && Date.now() < lockedUntil) {
      return { ok: false as const, reason: 'locked' as const, lockedUntil };
    }

    if (lockedUntil && Date.now() >= lockedUntil) {
      setLockedUntil(null);
      setFailedAttempts(0);
    }

    try {
      const resp = await api.login(email, password);
      if (resp.ok && resp.user) {
        loginSuccess(apiUserToUser(resp.user), remember, resp.token);
        return { ok: true };
      }
      // Shouldn't reach here, but treat as invalid
      return { ok: false as const, reason: 'invalid' as const };
    } catch (apiErr: any) {
      const msg = apiErr?.message ?? '';
      const status = apiErr?.status;

      // Check for locked account response from server
      if (msg.includes('locked')) {
        return { ok: false as const, reason: 'locked' as const };
      }

      // Network/timeout errors (abort, timeout, 503, 504) → don't count as failed attempt
      const isNetworkError = 
        apiErr?.name === 'AbortError' ||
        msg.includes('timeout') ||
        msg.includes('Failed to fetch') ||
        status === 503 ||
        status === 504;

      if (isNetworkError) {
        return { ok: false as const, reason: 'network' as const };
      }

      // Only count actual auth failures (401) as failed attempts
      const isAuthError = status === 401 || msg.includes('invalid') || msg.includes('401');

      if (isAuthError) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= MAX_LOGIN_ATTEMPTS) {
          const until = Date.now() + LOCK_DURATION_MS;
          setLockedUntil(until);
          return { ok: false as const, reason: 'locked' as const, lockedUntil: until };
        }
        return { ok: false as const, reason: 'invalid' as const };
      }

      // Other errors (500, etc) → treat as network error
      return { ok: false as const, reason: 'network' as const };
    }
  }, [failedAttempts, lockedUntil, loginSuccess]);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setFailedAttempts(0);
    setLockedUntil(null);
    setCurrentUser({ id: '', name: '', email: '', role: 'operator' } as User);
    setMode('org');
    setSelectedOrgId(null);
    setSelectedSiteId(null);
    setSelectedTerrainId(null);
    setApiOrgs(null);
    setApiSites(null);
    setApiTerrains(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_user_id');
      localStorage.removeItem('auth_token');
    }
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
  
  const value: AppContextType = {
    mode,
    setMode: handleSetMode,
    currentUser,
    setCurrentUser,
    isAuthenticated,
    sessionChecked,
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
    refreshHierarchy,
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
