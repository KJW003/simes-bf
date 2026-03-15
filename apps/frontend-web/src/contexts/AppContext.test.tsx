import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AppProvider, useAppContext } from '@/contexts/AppContext';

// Mock api module
vi.mock('@/lib/api', () => ({
  default: {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue({ ok: true, message: 'Logged out' }),
    me: vi.fn().mockResolvedValue({ ok: false }),
    getOrgs: vi.fn().mockResolvedValue([]),
    getSites: vi.fn().mockResolvedValue([]),
    getTerrains: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/hooks/usePreferences', () => ({
  loadPreferencesFromServer: vi.fn(),
}));

vi.mock('@/hooks/useAlarmEngine', () => ({
  loadAlarmSettingsFromServer: vi.fn(),
}));

// A test component that exposes context values
function TestConsumer() {
  const ctx = useAppContext();
  return (
    <div>
      <span data-testid="authenticated">{String(ctx.isAuthenticated)}</span>
      <span data-testid="session-checked">{String(ctx.sessionChecked)}</span>
      <span data-testid="mode">{ctx.mode}</span>
      <span data-testid="user-role">{ctx.currentUser.role}</span>
      <span data-testid="selected-org">{ctx.selectedOrgId ?? 'null'}</span>
      <span data-testid="selected-site">{ctx.selectedSiteId ?? 'null'}</span>
      <span data-testid="selected-terrain">{ctx.selectedTerrainId ?? 'null'}</span>
      <button data-testid="select-org" onClick={() => ctx.selectOrg('org-1')}>Select Org</button>
      <button data-testid="logout" onClick={ctx.logout}>Logout</button>
    </div>
  );
}

describe('AppContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('provides default values', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('mode').textContent).toBe('org');
    expect(screen.getByTestId('user-role').textContent).toBe('operator');
    expect(screen.getByTestId('selected-org').textContent).toBe('null');
  });

  it('throws when useAppContext is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useAppContext must be used within an AppProvider'
    );
    spy.mockRestore();
  });

  it('selectOrg updates selectedOrgId and resets site/terrain', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    fireEvent.click(screen.getByTestId('select-org'));
    expect(screen.getByTestId('selected-org').textContent).toBe('org-1');
    expect(screen.getByTestId('selected-site').textContent).toBe('null');
    expect(screen.getByTestId('selected-terrain').textContent).toBe('null');
  });

  it('logout clears all state and tokens', async () => {
    localStorage.setItem('auth_token', 'some-token');
    localStorage.setItem('auth_user_id', 'user-1');

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    );

    fireEvent.click(screen.getByTestId('logout'));

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('selected-org').textContent).toBe('null');
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_user_id')).toBeNull();
  });
});
