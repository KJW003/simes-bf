// ============================================================
// SIMES – Measurement Point Model
// (SOLID: Single Responsibility – metering / electrical data)
// ============================================================

import type { IEntity } from './base';
import type { EnergySourceCategory } from './energy-source.model';

// -------------------------
// Enumerations
// -------------------------

export type PointType = 'head' | 'feeder' | 'pv' | 'battery' | 'submeter' | 'load';

export type PointStatus = 'ok' | 'warning' | 'critical' | 'offline' | 'no_data';

// -------------------------
// Sub-structures
// -------------------------

/** Per-harmonic-order distortion data (orders 2–31). */
export interface HarmonicsData {
  order: number;
  thd: number;
  values: {
    phaseA: number;
    phaseB: number;
    phaseC: number;
  };
}

/** Single-phase electrical metrics snapshot. */
export interface PhaseMetrics {
  voltage: number;     // V
  current: number;     // A
  activePower: number; // kW
  reactivePower: number; // kVAR
  apparentPower: number; // kVA
  powerFactor: number; // 0–1
  thd: number;         // %
}

/** Active alarm raised by the meter firmware. */
export interface DeviceAlarm extends IEntity {
  type:
    | 'over_voltage' | 'under_voltage'
    | 'over_current' | 'under_current'
    | 'over_power'   | 'underload'
    | 'phase_loss'   | 'reverse_power'
    | 'thd_high'     | 'pf_low'
    | 'temperature_high' | 'residual_current_high';
  phase?: 'A' | 'B' | 'C' | 'all';
  threshold: number;
  currentValue: number;
  startedAt: string;
  severity: 'warning' | 'critical';
}

// -------------------------
// Main entity
// -------------------------

/**
 * A mapped measurement point (ACREL energy meter or similar)
 * attached to a terrain and collecting electrical data.
 */
export interface MeasurementPoint extends IEntity {
  terrainId: string;
  rawDeviceId: string;
  zone: string;
  level: string;
  name: string;
  type: PointType;
  energySourceCategory: EnergySourceCategory;
  /** Current transformer ratio (default 1). Raw I values are multiplied by this. */
  ctRatio: number;
  ptRatio?: string;
  phases: 1 | 3;

  /** Latest metrics snapshot. */
  metrics: {
    phaseA?: PhaseMetrics;
    phaseB?: PhaseMetrics;
    phaseC?: PhaseMetrics;

    totalActivePower: number;   // kW
    totalReactivePower: number; // kVAR
    totalApparentPower: number; // kVA
    averagePowerFactor: number; // 0–1
    frequency: number;          // Hz

    voltageUnbalance?: number;  // %
    currentUnbalance?: number;  // %

    maxDemand?: number;         // kW
    maxDemandTimestamp?: string; // ISO-8601

    cableTemperatureA?: number;
    cableTemperatureB?: number;
    cableTemperatureC?: number;
    cableTemperatureN?: number;
    residualCurrent?: number;
  };

  /** Energy accumulators (kWh / kVARh). */
  energyKwhImport: number;
  energyKwhExport: number;
  energyKvarhImport: number;
  energyKvarhExport: number;

  /** Harmonic spectrum (populated by the service layer). */
  harmonics?: HarmonicsData[];

  /** Operational status. */
  status: PointStatus;
  lastSeen: string;
  dataQuality: 'excellent' | 'good' | 'fair' | 'poor';

  /** Active device-level alarms. */
  activeAlarms: DeviceAlarm[];
}

// -------------------------
// Raw (unmapped) device
// -------------------------

export interface RawDevice extends IEntity {
  terrainId: string;
  rawId: string;
  gatewayId: string;
  firstSeen: string;
  lastSeen: string;
  messageCount24h: number;
  signalQuality?: number;
  mappingStatus: 'unmapped' | 'mapped' | 'pending_validation';
  mappedPointId?: string;
}
