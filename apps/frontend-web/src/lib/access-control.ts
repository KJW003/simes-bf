import type { UserRole } from '@/types';

export type OrgRouteKey =
  | 'dashboard'
  | 'dataMonitor'
  | 'powerQuality'
  | 'history'
  | 'forecasts'
  | 'invoice'
  | 'pvBattery'
  | 'predimensionnement'
  | 'anomalies'
  | 'exports'
  | 'energyAudit'
  | 'admin';

const ORG_ROUTE_ACCESS: Record<OrgRouteKey, UserRole[]> = {
  dashboard: ['org_admin', 'operator', 'manager'],
  dataMonitor: ['org_admin', 'operator', 'manager'],
  powerQuality: ['org_admin', 'operator', 'manager'],
  history: ['org_admin', 'operator', 'manager'],
  forecasts: ['org_admin', 'operator', 'manager'],
  invoice: ['org_admin', 'operator', 'manager'],
  pvBattery: ['org_admin', 'operator'],
  predimensionnement: ['org_admin'],
  anomalies: ['org_admin', 'operator', 'manager'],
  exports: ['org_admin', 'operator', 'manager'],
  energyAudit: ['org_admin', 'operator', 'manager'],
  admin: ['platform_super_admin'],
};

export function canAccessOrgRoute(role: UserRole, key: OrgRouteKey) {
  if (role === 'platform_super_admin') return true;
  const allowed = ORG_ROUTE_ACCESS[key];
  return allowed ? allowed.includes(role) : false;
}
