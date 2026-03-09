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
  // Tariff / invoice config
  tariffGroup: string;
  tariffPlan: string;
  subscribedPowerKw: number;
  hpRate: number;
  peakRate: number;
  monthlyRedevance: number;
  primePerKw: number;
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
  tariffGroup: 'D',
  tariffPlan: 'D1',
  subscribedPowerKw: 100,
  hpRate: 88,
  peakRate: 165,
  monthlyRedevance: 8538,
  primePerKw: 2882,
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
/* ── SONABEL tariff presets (Oct-2023) ── */
export type TariffPlan = { label: string; hpRate: number; peakRate: number; monthlyRedevance: number; primePerKw: number };
export type TariffGroupPreset = { hours: { hp: string; peak: string }; plans: Record<string, TariffPlan> };

export const TARIFF_PRESETS: Record<string, TariffGroupPreset> = {
  D: {
    hours: { hp: '00:00-17:00', peak: '17:00-24:00' },
    plans: {
      D1: { label: 'D1 Non-industriel', hpRate: 88, peakRate: 165, monthlyRedevance: 8538, primePerKw: 2882 },
      D2: { label: 'D2 Industriel', hpRate: 75, peakRate: 140, monthlyRedevance: 7115, primePerKw: 2402 },
      D3: { label: 'D3 Special', hpRate: 160, peakRate: 160, monthlyRedevance: 8538, primePerKw: 2882 },
    },
  },
  E: {
    hours: { hp: '00:00-17:00', peak: '17:00-24:00' },
    plans: {
      E1: { label: 'E1 Non-industriel', hpRate: 64, peakRate: 139, monthlyRedevance: 8538, primePerKw: 5903 },
      E2: { label: 'E2 Industriel', hpRate: 54, peakRate: 118, monthlyRedevance: 7115, primePerKw: 5366 },
      E3: { label: 'E3 Special', hpRate: 160, peakRate: 160, monthlyRedevance: 8538, primePerKw: 5903 },
    },
  },
  G: {
    hours: { hp: '00:00-10:00', peak: '10:00-24:00' },
    plans: {
      G: { label: 'G', hpRate: 70, peakRate: 140, monthlyRedevance: 7115, primePerKw: 5366 },
    },
  },
};