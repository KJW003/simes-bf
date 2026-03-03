// ============================================================
// SIMES – Anomaly Model
// (SOLID: Single Responsibility – anomaly detection domain)
// ============================================================

import type { IEntity, ITimestamped } from './base';

// -------------------------
// Enumerations
// -------------------------

export type AnomalyType =
  | 'consumption_residual'
  | 'forecast_deviation'
  | 'pf_low'
  | 'thd_high'
  | 'voltage_unbalance'
  | 'current_unbalance'
  | 'pv_underperformance'
  | 'data_quality'
  | 'flatline'
  | 'spike'
  | 'baseload_increase';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnomalyStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'ignored';

// -------------------------
// Sub-structures
// -------------------------

export interface AnomalyNote extends IEntity {
  userId: string;
  userName: string;
  content: string;
  timestamp: string;
  attachments?: string[];
}

// -------------------------
// Main entity
// -------------------------

/**
 * An anomaly detected by the SIMES analytics engine on one
 * or several measurement points.
 */
export interface Anomaly extends IEntity, ITimestamped {
  orgId: string;
  siteId: string;
  terrainId: string;
  pointIds: string[];
  pointNames: string[];

  type: AnomalyType;
  severity: AnomalySeverity;

  startTime: string;
  endTime?: string;
  durationMinutes: number;

  summary: string;
  description: string;

  impactKwh?: number;
  impactCost?: number;

  measuredValue?: number;
  expectedValue?: number;
  thresholdValue?: number;

  suspectedCauses: string[];
  recommendations: string[];
  fieldChecklist: string[];

  status: AnomalyStatus;
  assignedTo?: string;
  notes: AnomalyNote[];

  includeInReport: boolean;
}
