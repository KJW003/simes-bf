// @refresh reset
// ── AppContext — thin composer over AuthContext + TerrainContext ──
// Keeps the exact same useAppContext() interface so 0 consumer imports change.
import React, { createContext, useContext, useCallback, useRef, ReactNode } from 'react';
import type { AppMode, User, Organization, Site, Terrain } from '@/types';
import { AuthProvider, useAuth } from './AuthContext';
import { TerrainProvider, useTerrain, TerrainContext } from './TerrainContext';

interface AppContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  currentUser: User;
  setCurrentUser: (user: User) => void;
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
  hasSolar: boolean;
  setHasSolar: (value: boolean) => void;
  focusedOrgId: string | null;
  setFocusedOrgId: (orgId: string | null) => void;
  refreshHierarchy: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ── Inner bridge: reads both sub-contexts and merges them ──
function AppBridge({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const terrain = useTerrain();

  const logout = useCallback(() => {
    (terrain as any)._handleLogout?.();
    auth.logout();
  }, [auth, terrain]);

  const value: AppContextType = {
    // Auth
    mode: auth.mode,
    setMode: auth.setMode,
    currentUser: auth.currentUser,
    setCurrentUser: auth.setCurrentUser,
    isAuthenticated: auth.isAuthenticated,
    sessionChecked: auth.sessionChecked,
    login: auth.login,
    logout,
    authLock: auth.authLock,
    // Terrain
    selectedOrgId: terrain.selectedOrgId,
    selectedSiteId: terrain.selectedSiteId,
    selectedTerrainId: terrain.selectedTerrainId,
    aggregatedView: terrain.aggregatedView,
    selectedOrg: terrain.selectedOrg,
    selectedSite: terrain.selectedSite,
    selectedTerrain: terrain.selectedTerrain,
    availableOrgs: terrain.availableOrgs,
    availableSites: terrain.availableSites,
    availableTerrains: terrain.availableTerrains,
    selectOrg: terrain.selectOrg,
    selectSite: terrain.selectSite,
    selectTerrain: terrain.selectTerrain,
    setAggregatedView: terrain.setAggregatedView,
    focusedOrgId: terrain.focusedOrgId,
    setFocusedOrgId: terrain.setFocusedOrgId,
    hasSolar: terrain.hasSolar,
    setHasSolar: terrain.setHasSolar,
    refreshHierarchy: terrain.refreshHierarchy,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Outer provider: wires auth → terrain callbacks via refs ──
export function AppProvider({ children }: { children: ReactNode }) {
  const terrainRef = useRef<any>(null);

  const onLoginSuccess = useCallback((user: User) => {
    terrainRef.current?._handleLoginUser?.(user);
  }, []);

  const onLogout = useCallback(() => {
    terrainRef.current?._handleLogout?.();
  }, []);

  return (
    <AuthProvider onLoginSuccess={onLoginSuccess} onLogout={onLogout}>
      <AuthBridgeToTerrain terrainRef={terrainRef}>
        {children}
      </AuthBridgeToTerrain>
    </AuthProvider>
  );
}

// Reads auth values and passes them to TerrainProvider as props
function AuthBridgeToTerrain({ children, terrainRef }: { children: ReactNode; terrainRef: React.MutableRefObject<any> }) {
  const auth = useAuth();

  return (
    <TerrainProvider
      isAuthenticated={auth.isAuthenticated}
      currentUser={auth.currentUser}
      mode={auth.mode}
    >
      <TerrainRefCapture terrainRef={terrainRef}>
        <AppBridge>{children}</AppBridge>
      </TerrainRefCapture>
    </TerrainProvider>
  );
}

// Captures terrain context handle into the ref for auth callbacks
function TerrainRefCapture({ children, terrainRef }: { children: ReactNode; terrainRef: React.MutableRefObject<any> }) {
  const terrain = useContext(TerrainContext);
  terrainRef.current = terrain;
  return <>{children}</>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
