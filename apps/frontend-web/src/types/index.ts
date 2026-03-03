// ============================================================
// SIMES-BF Type Definitions
// ============================================================
// BACKWARD-COMPATIBILITY barrel.
// All canonical types now live in  src/models/*.model.ts
// This file re-exports them so existing `import … from '@/types'`
// statements continue to work without any change.
// ============================================================

// Re-export the EnergySourceCategory from widget-engine (kept for
// consumers that do `import { EnergySourceCategory } from '@/types'`)
export type { EnergySourceCategory } from './widget-engine';

// ── Core entities ───────────────────────────────────────────
export type { UserRole, User } from '@/models/user.model';
export type {
  Organization,
  Site,
  Terrain,
  TerrainStatus,
} from '@/models/organization.model';

// ── Measurement ─────────────────────────────────────────────
export type {
  PointType,
  PointStatus,
  HarmonicsData,
  PhaseMetrics,
  DeviceAlarm,
  MeasurementPoint,
  RawDevice,
} from '@/models/measurement-point.model';

// ── Anomaly ─────────────────────────────────────────────────
export type {
  AnomalyType,
  AnomalySeverity,
  AnomalyStatus,
  Anomaly,
  AnomalyNote,
} from '@/models/anomaly.model';

// ── Forecast ────────────────────────────────────────────────
export type { ForecastPoint, ForecastSummary } from '@/models/forecast.model';

// ── Invoice / Tariff ────────────────────────────────────────
export type { TariffVersion, InvoiceEstimate } from '@/models/invoice.model';

// ── PV / Battery / ROI ──────────────────────────────────────
export type { PvAudit, BatteryAudit, RoiSimulation } from '@/models/energy.model';

// ── Report ──────────────────────────────────────────────────
export type { ReportType, Report } from '@/models/report.model';

// ── Platform / NOC ──────────────────────────────────────────
export type {
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  Incident,
  IncidentNote,
  PipelineHealth,
} from '@/models/incident.model';

// ── App state ───────────────────────────────────────────────
export type { AppMode, AppContextShape as AppContext } from '@/models/app.model';

// ── Generic helpers ─────────────────────────────────────────
export type {
  PaginatedResponse,
  TimeRange,
  ChartDataPoint,
  TimeSeriesData,
} from '@/models/base';
