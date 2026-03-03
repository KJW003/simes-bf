// ============================================================
// SIMES – Time Series Service
// ============================================================
// Generates and caches deterministic 24 h time series data
// (1 440 points, 1-minute resolution) per measurement point.
// Also provides aggregation helpers (zone, terrain, category).
//
// SOLID:
//   S – solely responsible for time-series generation & caching
//   O – aggregation strategies can be extended without modifying
//       the generator
// ============================================================

import type { MeasurementPoint } from '@/models/measurement-point.model';
import type { MetricKey } from '@/models/metric.model';
import type { TimeSeriesPoint } from '@/models/base';
import DataStore from './data-store';

// ============================================================
// Deterministic PRNG (same as original mock)
// ============================================================

function seededRandom(seed: number): () => number {
  let s = Math.abs(seed) || 1;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ============================================================
// Time helpers
// ============================================================

const now = Date.now();
const tsMinutesAgo = (min: number) => now - min * 60 * 1000;

// ============================================================
// Raw time-series generator
// ============================================================

function generateTimeSeries(
  base: number,
  amplitude: number,
  seed: number,
  options?: { pv?: boolean; battery?: boolean; noiseRatio?: number; minuteCount?: number },
): TimeSeriesPoint[] {
  const rand = seededRandom(seed);
  const noise = options?.noiseRatio ?? 0.05;
  const count = options?.minuteCount ?? 1440;
  const pts: TimeSeriesPoint[] = [];

  for (let i = 0; i < count; i++) {
    const ts = tsMinutesAgo(count - i);
    const hourFrac = ((count - i) % 1440) / 60;
    let value: number;

    if (options?.pv) {
      if (hourFrac < 6 || hourFrac > 19) {
        value = 0;
      } else {
        const sunAngle = Math.sin(((hourFrac - 6) / 13) * Math.PI);
        value = base * sunAngle * (0.85 + rand() * 0.3);
      }
    } else if (options?.battery) {
      if (hourFrac >= 10 && hourFrac < 15) {
        value = base * (0.6 + rand() * 0.4);
      } else if (hourFrac >= 18 && hourFrac < 22) {
        value = -base * (0.3 + rand() * 0.4);
      } else {
        value = base * 0.05 * (rand() - 0.5);
      }
    } else {
      const nightBase = 0.35;
      const morningRamp =
        hourFrac >= 6 && hourFrac < 8
          ? nightBase + (1 - nightBase) * ((hourFrac - 6) / 2)
          : 0;
      const dayPeak =
        hourFrac >= 8 && hourFrac < 18
          ? 0.85 + 0.15 * Math.sin(((hourFrac - 8) / 10) * Math.PI)
          : 0;
      const eveningTaper =
        hourFrac >= 18 && hourFrac < 22
          ? 0.85 * (1 - (hourFrac - 18) / 4) + 0.35 * ((hourFrac - 18) / 4)
          : 0;

      const shape =
        hourFrac < 6 ? nightBase
        : hourFrac < 8 ? morningRamp
        : hourFrac < 18 ? dayPeak
        : hourFrac < 22 ? eveningTaper
        : nightBase;

      value = base * shape + amplitude * (rand() - 0.5) * noise * 2;
    }

    value += value * noise * (rand() - 0.5) * 2;
    pts.push({ ts, value: Number(value.toFixed(2)) });
  }
  return pts;
}

// ============================================================
// Per-point series map (lazy cache)
// ============================================================

interface PointSeriesMap {
  P: TimeSeriesPoint[];
  V: TimeSeriesPoint[];
  I: TimeSeriesPoint[];
  PF: TimeSeriesPoint[];
  THD: TimeSeriesPoint[];
  Energy: TimeSeriesPoint[];
  [key: string]: TimeSeriesPoint[];
}

const _cache = new Map<string, PointSeriesMap>();

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function buildPointSeries(point: MeasurementPoint): PointSeriesMap {
  const seed = hashCode(point.id);
  const pBase = Math.abs(point.metrics.totalActivePower);
  const isPv = point.energySourceCategory === 'PV';
  const isBat = point.energySourceCategory === 'BATTERY';

  const P = generateTimeSeries(pBase, pBase * 0.15, seed, { pv: isPv, battery: isBat });
  const V = generateTimeSeries(point.metrics.phaseA?.voltage ?? 230, 3, seed + 100);
  const Iseries = generateTimeSeries(
    point.metrics.phaseA?.current ?? 10,
    (point.metrics.phaseA?.current ?? 10) * 0.1,
    seed + 200,
    { pv: isPv, battery: isBat },
  );
  const PF = generateTimeSeries(point.metrics.averagePowerFactor, 0.04, seed + 300).map(pt => ({
    ...pt,
    value: Number(Math.max(0.6, Math.min(1, pt.value)).toFixed(3)),
  }));

  const maxThd = Math.max(
    point.metrics.phaseA?.thd ?? 0,
    point.metrics.phaseB?.thd ?? 0,
    point.metrics.phaseC?.thd ?? 0,
  );
  const THD = generateTimeSeries(maxThd || 3, 1.5, seed + 400).map(pt => ({
    ...pt,
    value: Number(Math.max(0, Math.min(30, pt.value)).toFixed(2)),
  }));

  let cumEnergy = 0;
  const Energy = P.map(pt => {
    cumEnergy += Math.abs(pt.value) / 60;
    return { ts: pt.ts, value: Number(cumEnergy.toFixed(2)) };
  });

  return { P, V, I: Iseries, PF, THD, Energy };
}

// ============================================================
// Aggregation helper (private)
// ============================================================

function aggregatePointSeries(pointIds: string[], metric: MetricKey): TimeSeriesPoint[] {
  if (pointIds.length === 0) return [];
  const isAvg = ['PF', 'V', 'THD', 'Freq', 'VUnbal', 'IUnbal'].includes(metric);
  const seriesArrays = pointIds.map(id => TimeSeriesService.getPointSeries(id, metric));

  const ref = seriesArrays[0];
  if (!ref || ref.length === 0) return [];

  return ref.map((_, i) => {
    const sum = seriesArrays.reduce((acc, s) => acc + (s[i]?.value ?? 0), 0);
    return {
      ts: ref[i].ts,
      value: Number((isAvg ? sum / seriesArrays.length : sum).toFixed(2)),
    };
  });
}

// ============================================================
// Public API — TimeSeriesService (static class)
// ============================================================

export class TimeSeriesService {
  /**
   * Get a single-point time series for a metric.
   */
  static getPointSeries(pointId: string, metric: MetricKey): TimeSeriesPoint[] {
    if (!_cache.has(pointId)) {
      const store = DataStore.getInstance();
      const pt = store.measurementPoints.find(p => p.id === pointId);
      if (!pt) return [];
      _cache.set(pointId, buildPointSeries(pt));
    }
    return _cache.get(pointId)![metric] ?? [];
  }

  /**
   * Aggregate a metric across all points in a zone.
   */
  static aggregateZone(zoneId: string, metric: MetricKey): TimeSeriesPoint[] {
    const store = DataStore.getInstance();
    const zone = store.zones.find(z => z.id === zoneId);
    if (!zone) return [];
    return aggregatePointSeries(zone.pointIds, metric);
  }

  /**
   * Aggregate a metric across all points in a terrain.
   */
  static aggregateTerrain(terrainId: string, metric: MetricKey): TimeSeriesPoint[] {
    const store = DataStore.getInstance();
    const points = store.measurementPoints.filter(p => p.terrainId === terrainId);
    return aggregatePointSeries(points.map(p => p.id), metric);
  }

  /**
   * Aggregate a metric for all points matching a category in a terrain.
   */
  static aggregateCategory(
    terrainId: string,
    category: string,
    metric: MetricKey,
  ): TimeSeriesPoint[] {
    const store = DataStore.getInstance();
    const points = store.measurementPoints.filter(
      p => p.terrainId === terrainId && p.energySourceCategory === category,
    );
    return aggregatePointSeries(points.map(p => p.id), metric);
  }

  /**
   * Aggregate an explicit set of point IDs.
   */
  static aggregatePointSet(pointIds: string[], metric: MetricKey): TimeSeriesPoint[] {
    return aggregatePointSeries(pointIds, metric);
  }
}
