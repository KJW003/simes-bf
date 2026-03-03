// ============================================================
// SIMES – User Model (SOLID: Single Responsibility)
// ============================================================

import type { IEntity } from './base';

/** Platform-wide role that gates route access. */
export type UserRole = 'org_admin' | 'operator' | 'manager' | 'platform_super_admin';

/**
 * A user account (org member or platform super-admin).
 *
 * - `orgId` is set for org-level users.
 * - `siteAccess` optionally restricts an operator to specific sites.
 */
export interface User extends IEntity {
  name: string;
  email: string;
  role: UserRole;
  orgId?: string;
  siteAccess?: string[];
  avatar?: string;
}
