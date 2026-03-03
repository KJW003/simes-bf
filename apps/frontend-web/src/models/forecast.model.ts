// ============================================================
// SIMES – Forecast Model
// (SOLID: Single Responsibility – demand / generation forecasting)
// ============================================================

/**
 * A single daily forecast data point.
 */
export interface ForecastPoint {
  /** ISO date (YYYY-MM-DD). */
  timestamp: string;
  /** Median expected consumption (kWh). */
  p50: number;
  /** 90th percentile (kWh). */
  p90: number;
  baselineSeasonal?: number;
  baselineEts?: number;
}

/**
 * Forecast summary for a terrain or site over a given horizon.
 */
export interface ForecastSummary {
  terrainId?: string;
  siteId?: string;
  scope: 'terrain' | 'site';

  horizon: '7d' | '30d';
  generatedAt: string;

  modelQuality: 'high' | 'medium' | 'low';
  /** Mean Absolute Percentage Error (%) of recent predictions. */
  recentMape: number;
  missingDataPct: number;
  confidenceNote: string;

  totalP50Kwh: number;
  totalP90Kwh: number;

  riskPeriods: Array<{
    startDate: string;
    endDate: string;
    reason: string;
    severity: 'warning' | 'critical';
  }>;

  points: ForecastPoint[];
}
