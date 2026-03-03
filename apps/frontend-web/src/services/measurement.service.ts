// ============================================================
// SIMES – Measurement Service
// ============================================================
// Provides access to measurement points and delegates
// time-series queries to TimeSeriesService.
// ============================================================

import type { MeasurementPoint } from '@/models/measurement-point.model';
import type { MetricKey } from '@/models/metric.model';
import type { TimeSeriesPoint } from '@/models/base';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';
import { TimeSeriesService } from './time-series.service';

class MeasurementServiceImpl implements IQueryService<MeasurementPoint> {
  private get data() { return DataStore.getInstance().measurementPoints; }

  getAll(): MeasurementPoint[] { return this.data; }
  getById(id: string): MeasurementPoint | undefined { return this.data.find(p => p.id === id); }
  findBy(predicate: (p: MeasurementPoint) => boolean): MeasurementPoint[] { return this.data.filter(predicate); }
  findOneBy(predicate: (p: MeasurementPoint) => boolean): MeasurementPoint | undefined { return this.data.find(predicate); }

  getByTerrainId(terrainId: string): MeasurementPoint[] {
    return this.data.filter(p => p.terrainId === terrainId);
  }

  // ── Time-series delegation ──

  getPointSeries(pointId: string, metric: MetricKey): TimeSeriesPoint[] {
    return TimeSeriesService.getPointSeries(pointId, metric);
  }

  aggregateCategory(terrainId: string, category: string, metric: MetricKey): TimeSeriesPoint[] {
    return TimeSeriesService.aggregateCategory(terrainId, category, metric);
  }

  aggregateTerrain(terrainId: string, metric: MetricKey): TimeSeriesPoint[] {
    return TimeSeriesService.aggregateTerrain(terrainId, metric);
  }
}

export const MeasurementService = new MeasurementServiceImpl();
