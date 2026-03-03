// ============================================================
// SIMES – PV / Battery / ROI Models
// (SOLID: Single Responsibility – renewable energy domain)
// ============================================================

import type { IEntity } from './base';
import type { AnomalySeverity } from './anomaly.model';

// -------------------------
// PV audit
// -------------------------

export interface PvAudit extends IEntity {
  terrainId: string;
  pointId: string;
  date: string;

  installedCapacityKw: number;

  expectedKwh: number;
  actualKwh: number;
  deviationPct: number;

  performanceRatio: number;

  irradianceKwhM2?: number;

  issues: Array<{
    type: 'soiling' | 'shading' | 'inverter_clipping' | 'string_failure' | 'degradation' | 'other';
    severity: AnomalySeverity;
    description: string;
    recommendations: string[];
  }>;

  status: 'normal' | 'underperforming' | 'critical';
}

// -------------------------
// Battery audit
// -------------------------

export interface BatteryAudit extends IEntity {
  terrainId: string;
  pointId: string;
  date: string;

  capacityKwh: number;

  averageSoc: number;
  minSoc: number;
  maxSoc: number;

  chargeKwh: number;
  dischargeKwh: number;
  cycles: number;

  roundTripEfficiency: number;

  loadContributionPct: number;

  status: 'normal' | 'degraded' | 'critical';
  notes: string[];
}

// -------------------------
// ROI simulation wizard
// -------------------------

export interface RoiSimulation extends IEntity {
  name: string;
  createdAt: string;

  // Step 1 – Scope
  includedTerrainIds: string[];
  includedPointIds: string[];

  // Step 2 – PV Parameters
  pvCapacityKw: number;
  pvTiltDeg: number;
  pvAzimuthDeg: number;
  annualIrradianceKwhM2: number;
  systemLossesPct: number;

  // Step 3 – Battery Parameters
  batteryCapacityKwh?: number;
  batteryPowerKw?: number;
  batteryEfficiency?: number;

  // Results
  results?: {
    annualPvGenerationKwh: number;
    selfConsumptionPct: number;
    gridImportReductionPct: number;
    annualSavings: number;
    totalInvestment: number;
    paybackYears: number;
    npv: number;
    irr: number;
  };
}
