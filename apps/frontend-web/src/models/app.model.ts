// ============================================================
// SIMES – Application State Model
// (SOLID: Single Responsibility – global app state shape)
// ============================================================

import type { User } from './user.model';

export type AppMode = 'org' | 'platform';

/**
 * Shape of the global application context consumed by the
 * React context provider.  This is the *type* contract only;
 * the actual React context lives in `src/contexts/AppContext.tsx`.
 */
export interface AppContextShape {
  mode: AppMode;
  currentUser: User;

  // Org-mode selection
  selectedOrgId?: string;
  selectedSiteId?: string;
  selectedTerrainId?: string;
  aggregatedView: boolean;

  // Platform mode
  focusedOrgId?: string;
}
