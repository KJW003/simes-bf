// ============================================================
// SIMES – Incident & Pipeline Health Models
// (SOLID: Single Responsibility – NOC / platform monitoring)
// ============================================================

import type { IEntity } from './base';

// -------------------------
// Enumerations
// -------------------------

export type IncidentType =
  | 'gateway_offline'
  | 'device_silent'
  | 'mapping_missing'
  | 'ingestion_error'
  | 'data_spike'
  | 'pipeline_failure';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';

// -------------------------
// Sub-structures
// -------------------------

export interface IncidentNote extends IEntity {
  userId: string;
  userName: string;
  content: string;
  timestamp: string;
}

// -------------------------
// Main entities
// -------------------------

export interface Incident extends IEntity {
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;

  orgId: string;
  orgName: string;
  siteId?: string;
  siteName?: string;
  terrainId?: string;
  terrainName?: string;
  gatewayId?: string;

  title: string;
  description: string;

  startedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;

  assignedTo?: string;
  notes: IncidentNote[];
}

// -------------------------
// Pipeline health
// -------------------------

export interface PipelineHealth {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  errorRate: number;
  lastCheck: string;
  details?: string;
}
