// ============================================================
// SIMES – Base Model Interfaces (SOLID: Interface Segregation)
// ============================================================

/**
 * Base contract for all identifiable entities.
 * Every domain object must have a unique identifier.
 */
export interface IEntity {
  readonly id: string;
}

/**
 * Contract for entities that track creation / update timestamps.
 */
export interface ITimestamped {
  createdAt: string;
  updatedAt?: string;
}

/**
 * Generic paginated API response envelope.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * ISO-8601 time window used across forecasts, invoices, reports.
 */
export interface TimeRange {
  start: string;
  end: string;
  preset?: '1h' | '24h' | '7d' | '30d' | 'custom';
}

/**
 * A single point in a charted time series.
 */
export interface ChartDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

/**
 * Named time series bound to a measurement point.
 */
export interface TimeSeriesData {
  pointId: string;
  metric: string;
  unit: string;
  data: ChartDataPoint[];
}

/**
 * Lightweight epoch-based time-series point used by the
 * widget engine and history / data-monitor pages.
 */
export interface TimeSeriesPoint {
  ts: number;       // epoch ms
  value: number;
  phase?: 'A' | 'B' | 'C';
}
