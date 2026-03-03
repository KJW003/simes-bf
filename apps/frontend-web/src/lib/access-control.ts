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
  | 'reports'
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
  anomalies: ['org_admin', 'operator'],
  reports: ['org_admin', 'operator', 'manager'],
  energyAudit: ['org_admin', 'operator', 'manager'],
  admin: ['platform_super_admin'],
};

export function canAccessOrgRoute(role: UserRole, key: OrgRouteKey) {
  return ORG_ROUTE_ACCESS[key].includes(role);
}
