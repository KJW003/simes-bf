// @refresh reset
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import type { AppMode, User } from '@/types';
import api from '@/lib/api';
import type { ApiUser } from '@/lib/api';
import { loadPreferencesFromServer } from '@/hooks/usePreferences';
import { loadAlarmSettingsFromServer } from '@/hooks/useAlarmEngine';

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

const getStoredToken = () => {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem('auth_token'); } catch { return null; }
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

export interface AuthLock {
  failedAttempts: number;
  lockedUntil: number | null;
  maxAttempts: number;
  lockDurationMs: number;
}

export interface AuthContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  currentUser: User;
  setCurrentUser: (user: User) => void;
  isAuthenticated: boolean;
  sessionChecked: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<{ ok: boolean; reason?: 'invalid' | 'locked' | 'network'; lockedUntil?: number }>;
  logout: () => void;
  authLock: AuthLock;
  /** Called by TerrainContext after login to set the user's org */
  _onLoginSuccess?: (user: User, remember: boolean, token?: string) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
  children,
  onLoginSuccess,
  onLogout,
}: {
  children: ReactNode;
  onLoginSuccess?: (user: User, remember: boolean, token?: string) => void;
  onLogout?: () => void;
}) {
  const hasToken = !!getStoredToken();

  const [mode, setMode] = useState<AppMode>('org');
  const [currentUser, setCurrentUser] = useState<User>({ id: '', name: '', email: '', role: 'operator' } as User);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(!hasToken);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  // Session restore
  const sessionRestoreRan = useRef(false);
  useEffect(() => {
    if (sessionRestoreRan.current) return;
    sessionRestoreRan.current = true;
    if (!hasToken) return;
    api.me()
      .then(resp => {
        if (resp.ok && resp.user) {
          const u = apiUserToUser(resp.user);
          setCurrentUser(u);
          setIsAuthenticated(true);
          const isPlatform = u.role === 'platform_super_admin';
          setMode(isPlatform ? 'platform' : 'org');
          onLoginSuccess?.(u, false);
          loadPreferencesFromServer();
          loadAlarmSettingsFromServer();
        } else {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user_id');
        }
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user_id');
      })
      .finally(() => setSessionChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken]);

  // Force platform mode for super admins
  useEffect(() => {
    if (currentUser.role !== 'platform_super_admin') return;
    setMode('platform');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  const handleSetMode = useCallback((newMode: AppMode) => {
    setMode(currentUser.role === 'platform_super_admin' ? 'platform' : newMode);
  }, [currentUser.role]);

  const loginSuccessInternal = useCallback((user: User, remember: boolean, token?: string) => {
    setFailedAttempts(0);
    setLockedUntil(null);
    setIsAuthenticated(true);
    setCurrentUser(user);
    const isPlatformUser = user.role === 'platform_super_admin';
    setMode(isPlatformUser ? 'platform' : 'org');
    if (typeof window !== 'undefined') {
      if (remember) localStorage.setItem('auth_user_id', user.id);
      else localStorage.removeItem('auth_user_id');
      if (token) localStorage.setItem('auth_token', token);
    }
    onLoginSuccess?.(user, remember, token);
    loadPreferencesFromServer();
    loadAlarmSettingsFromServer();
  }, [onLoginSuccess]);

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
        loginSuccessInternal(apiUserToUser(resp.user), remember, resp.token);
        return { ok: true };
      }
      return { ok: false as const, reason: 'invalid' as const };
    } catch (apiErr: any) {
      const msg = apiErr?.message ?? '';
      const status = apiErr?.status;
      if (msg.includes('locked')) return { ok: false as const, reason: 'locked' as const };
      const isNetworkError = apiErr?.name === 'AbortError' || msg.includes('timeout') || msg.includes('Failed to fetch') || status === 503 || status === 504;
      if (isNetworkError) return { ok: false as const, reason: 'network' as const };
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
      return { ok: false as const, reason: 'network' as const };
    }
  }, [failedAttempts, lockedUntil, loginSuccessInternal]);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setFailedAttempts(0);
    setLockedUntil(null);
    setCurrentUser({ id: '', name: '', email: '', role: 'operator' } as User);
    setMode('org');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_user_id');
      localStorage.removeItem('auth_token');
    }
    onLogout?.();
  }, [onLogout]);

  const value: AuthContextType = {
    mode,
    setMode: handleSetMode,
    currentUser,
    setCurrentUser,
    isAuthenticated,
    sessionChecked,
    login,
    logout,
    authLock: { failedAttempts, lockedUntil, maxAttempts: MAX_LOGIN_ATTEMPTS, lockDurationMs: LOCK_DURATION_MS },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
