// ============================================================
// SIMES – Organisation Hierarchy Models
//   Organization  →  Site  →  Terrain
// (SOLID: Single Responsibility – one bounded context)
// ============================================================

import type { IEntity, ITimestamped } from './base';

// -------------------------
// Organization
// -------------------------

export interface Organization extends IEntity, ITimestamped {
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial';
  plan: 'starter' | 'professional' | 'enterprise';
  sitesCount: number;
  terrainsCount: number;
  usersCount: number;
}

// -------------------------
// Site
// -------------------------

export interface Site extends IEntity {
  orgId: string;
  name: string;
  address?: string;
  timezone: string;
  terrainsCount: number;
  status: 'online' | 'offline' | 'degraded';
  createdAt: string;
}

// -------------------------
// Terrain
// -------------------------

export type TerrainStatus = 'online' | 'offline' | 'degraded';

export interface Terrain extends IEntity {
  siteId: string;
  name: string;
  gatewayId: string;
  status: TerrainStatus;
  lastSeen: string;
  /** 0–100 — data completeness over 24 h. */
  dataCompleteness24h: number;
  /** Messages per minute from the gateway. */
  messageRate: number;
  /** Percentage of messages that errored. */
  errorRate: number;
  pointsCount: number;
  unmappedDevicesCount: number;
}
