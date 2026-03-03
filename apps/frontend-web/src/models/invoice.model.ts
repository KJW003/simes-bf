// ============================================================
// SIMES – Invoice / Tariff Model
// (SOLID: Single Responsibility – billing domain)
// ============================================================

import type { IEntity } from './base';

// -------------------------
// Tariff
// -------------------------

export interface TariffVersion extends IEntity {
  name: string;
  validFrom: string;
  validTo?: string;
  peakRate: number;      // XOF / kWh
  offPeakRate: number;   // XOF / kWh
  shoulderRate?: number; // XOF / kWh
  demandCharge?: number; // XOF / kW
  fixedCharge: number;   // XOF / month
  currency: string;
  peakHours: string;     // e.g. "18:00-22:00"
  offPeakHours: string;  // e.g. "22:00-06:00"
}

// -------------------------
// Invoice estimate
// -------------------------

export interface InvoiceEstimate extends IEntity {
  terrainId?: string;
  siteId?: string;
  scope: 'terrain' | 'site';

  period: {
    start: string;
    end: string;
  };

  tariffVersionId: string;
  tariffVersionName: string;

  totalKwh: number;
  peakKwh: number;
  offPeakKwh: number;
  shoulderKwh?: number;
  maxDemandKw: number;

  breakdown: Array<{
    category: string;
    kwh: number;
    rate: number;
    amount: number;
  }>;

  totalAmount: number;
  currency: string;

  generatedAt: string;
}
