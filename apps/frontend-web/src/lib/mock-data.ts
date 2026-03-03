// ============================================================
// SIMES – Mock-Data Facade (backward-compatible bridge)
// ============================================================
// This file used to be the monolithic 1 100-line data + logic
// source.  It is now a thin delegate that re-exports everything
// from  src/services/*  and  src/models/*  keeping the exact
// same public API so that NO page or component import changes.
//
// Data Source:   src/data/*.json   (loaded by DataStore)
// Logic:         src/services/*    (SOLID service layer)
// Types:         src/models/*      (SOLID model layer)
// ============================================================

import DataStore from '@/services/data-store';
import { TimeSeriesService } from '@/services/time-series.service';
import type { MetricKey } from '@/models/metric.model';

// Re-export the TimeSeriesPoint type (used by widget-registry)
export type { TimeSeriesPoint } from '@/models/base';

// ============================================================
// Data arrays — delegates to DataStore singleton
// ============================================================

const store = DataStore.getInstance();

export const mockUsers            = store.users;
export const mockOrganizations    = store.organizations;
export const mockSites            = store.sites;
export const mockTerrains         = store.terrains;
export const mockMeasurementPoints = store.measurementPoints;
export const mockRawDevices       = store.rawDevices;
export const mockZones            = store.zones;
export const mockAnomalies        = store.anomalies;
export const mockForecastSummary  = store.forecastSummary;
export const mockInvoiceEstimate  = store.invoiceEstimate;
export const mockPvAudit          = store.pvAudit;
export const mockReports          = store.reports;
export const mockIncidents        = store.incidents;
export const mockPipelineHealth   = store.pipelineHealth;

// ============================================================
// Helper look-up functions — same signatures as before
// ============================================================

export const getOrgById           = (id: string) => mockOrganizations.find(o => o.id === id);
export const getSiteById          = (id: string) => mockSites.find(s => s.id === id);
export const getTerrainById       = (id: string) => mockTerrains.find(t => t.id === id);
export const getSitesByOrgId      = (orgId: string) => mockSites.filter(s => s.orgId === orgId);
export const getTerrainsBySiteId  = (siteId: string) => mockTerrains.filter(t => t.siteId === siteId);
export const getPointsByTerrainId = (terrainId: string) => mockMeasurementPoints.filter(p => p.terrainId === terrainId);
export const getZonesByTerrainId  = (terrainId: string) => mockZones.filter(z => z.terrainId === terrainId);
export const getZoneById          = (id: string) => mockZones.find(z => z.id === id);
export const getPointById         = (id: string) => mockMeasurementPoints.find(p => p.id === id);

export const getPointsByZoneId    = (zoneId: string) => {
  const zone = getZoneById(zoneId);
  if (!zone) return [];
  return mockMeasurementPoints.filter(p => zone.pointIds.includes(p.id));
};

export const getZonePointIds      = (zoneId: string): string[] => {
  const zone = getZoneById(zoneId);
  return zone ? zone.pointIds : [];
};

export const getAnomaliesByTerrainId = (terrainId: string) =>
  mockAnomalies.filter(a => a.terrainId === terrainId);

export const getAnomaliesBySiteId    = (siteId: string) =>
  mockAnomalies.filter(a => a.siteId === siteId);

// ============================================================
// Time-series — delegates to TimeSeriesService
// ============================================================

export const getPointSeries    = (pointId: string, metric: MetricKey) =>
  TimeSeriesService.getPointSeries(pointId, metric);

export const aggregateZone     = (zoneId: string, metric: MetricKey) =>
  TimeSeriesService.aggregateZone(zoneId, metric);

export const aggregateTerrain  = (terrainId: string, metric: MetricKey) =>
  TimeSeriesService.aggregateTerrain(terrainId, metric);

export const aggregateCategory = (terrainId: string, category: string, metric: MetricKey) =>
  TimeSeriesService.aggregateCategory(terrainId, category, metric);

export const aggregatePointSet = (pointIds: string[], metric: MetricKey) =>
  TimeSeriesService.aggregatePointSet(pointIds, metric);
