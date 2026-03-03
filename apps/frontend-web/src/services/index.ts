// ============================================================
// SIMES – Services Barrel Export
// ============================================================
// Single import point for the entire service layer:
//   import { MeasurementService, TimeSeriesService } from '@/services';
// ============================================================

export { UserService } from './user.service';
export { OrganizationService } from './organization.service';
export { SiteService } from './site.service';
export { TerrainService } from './terrain.service';
export { MeasurementService } from './measurement.service';
export { DeviceService } from './device.service';
export { ZoneService } from './zone.service';
export { AnomalyService } from './anomaly.service';
export { ForecastService } from './forecast.service';
export { InvoiceService } from './invoice.service';
export { EnergyService } from './energy.service';
export { ReportService } from './report.service';
export { IncidentService } from './incident.service';
export { TimeSeriesService } from './time-series.service';

// Re-export service interfaces for extension
export type { IReadService, IQueryService } from './interfaces';
