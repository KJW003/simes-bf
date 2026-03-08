import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  refreshInterval: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  compactMode: boolean;
  defaultTimeRange: string;
  co2Factor: number;
  currency: string;
  tariffRate: number;
}

const STORAGE_KEY = 'simes-preferences';
const PREFS_EVENT = 'simes-preferences-changed';

export const PREF_DEFAULTS: UserPreferences = {
  theme: 'light',
  refreshInterval: 15,
  notificationsEnabled: true,
  soundEnabled: false,
  compactMode: false,
  defaultTimeRange: '1D',
  co2Factor: 0.71,
  currency: 'FCFA',
  tariffRate: 193.4,
};

function readPrefs(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...PREF_DEFAULTS, ...JSON.parse(stored) } : PREF_DEFAULTS;
  } catch {
    return PREF_DEFAULTS;
  }
}

let cached: UserPreferences = readPrefs();

function subscribe(cb: () => void) {
  const handler = () => {
    cached = readPrefs();
    cb();
  };
  window.addEventListener(PREFS_EVENT, handler);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) handler();
  });
  return () => {
    window.removeEventListener(PREFS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

function getSnapshot() {
  return cached;
}

export function savePreferences(prefs: UserPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  // Apply theme
  if (prefs.theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (prefs.theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
  }
  localStorage.setItem('simes-theme', prefs.theme);
  cached = { ...prefs };
  window.dispatchEvent(new Event(PREFS_EVENT));
}

export function usePreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function getCurrencySymbol(currency: string): string {
  switch (currency) {
    case 'EUR': return '€';
    case 'USD': return '$';
    default: return currency;
  }
}
