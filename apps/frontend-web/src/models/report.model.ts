// ============================================================
// SIMES – Report Model
// (SOLID: Single Responsibility – generated reports)
// ============================================================

import type { IEntity } from './base';

export type ReportType = 'monthly' | 'quarterly' | 'annual' | 'custom' | 'energy_audit';

export interface Report extends IEntity {
  title: string;
  type: ReportType;

  scope: {
    siteId?: string;
    terrainIds?: string[];
  };

  period: {
    start: string;
    end: string;
  };

  sections: {
    forecast: boolean;
    invoice: boolean;
    powerQuality: boolean;
    pvAudit: boolean;
    anomalies: boolean;
    recommendations: boolean;
  };

  status: 'draft' | 'generating' | 'ready' | 'failed';
  downloadUrl?: string;

  createdBy: string;
  createdAt: string;
  generatedAt?: string;
}
