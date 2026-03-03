// ============================================================
// SIMES Widget Engine – Registry
// All widget definitions: config schema, resolver, renderer.
// ============================================================

import React from 'react';
import type {
  WidgetDefinition,
  WidgetConfig,
  ResolvedWidgetData,
  WidgetResolverContext,
  MetricKey,
} from '@/types/widget-engine';
import { METRIC_UNITS } from '@/types/widget-engine';
import {
  getPointsByTerrainId,
  getPointsByZoneId,
  getPointById,
  getPointSeries,
  aggregateZone,
  aggregateTerrain,
  aggregateCategory,
  mockMeasurementPoints,
} from '@/lib/mock-data';
import type { MeasurementPoint } from '@/types';
import type { TimeSeriesPoint } from '@/lib/mock-data';
import {
  Activity,
  Gauge,
  PiggyBank,
  Brain,
  ShieldAlert,
  LineChart as LineChartIcon,
  Sun,
  Battery,
  Zap,
} from 'lucide-react';

// -------------------------
// RESOLVER HELPERS
// -------------------------

function resolvePoints(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): MeasurementPoint[] {
  const { dataSource } = config;

  switch (dataSource.type) {
    case 'POINT': {
      const pt = getPointById(dataSource.refId);
      return pt ? [pt] : [];
    }
    case 'ZONE_AGG': {
      return getPointsByZoneId(dataSource.refId);
    }
    case 'TERRAIN_AGG': {
      const terrainId = dataSource.refId || ctx.terrainId;
      return terrainId ? getPointsByTerrainId(terrainId) : [];
    }
    case 'CATEGORY_AGG': {
      const terrainId = ctx.terrainId;
      const base = terrainId
        ? getPointsByTerrainId(terrainId)
        : mockMeasurementPoints;
      return dataSource.categoryFilter
        ? base.filter(p => p.energySourceCategory === dataSource.categoryFilter)
        : base;
    }
    default:
      return [];
  }
}

/** Current snapshot KPI for a metric from live MeasurementPoint data */
function aggregateMetricKpi(points: MeasurementPoint[], metric: MetricKey): number {
  if (points.length === 0) return 0;
  switch (metric) {
    case 'P':
      return points.reduce((s, p) => s + Math.abs(p.metrics.totalActivePower), 0);
    case 'Q':
      return points.reduce((s, p) => s + Math.abs(p.metrics.totalReactivePower), 0);
    case 'S':
      return points.reduce((s, p) => s + Math.abs(p.metrics.totalApparentPower), 0);
    case 'Energy':
      return points.reduce((s, p) => s + p.energyKwhImport + p.energyKwhExport, 0);
    case 'PF':
      // Audit-friendly: PF_min (worst-case power factor)
      return Math.min(...points.map(p => p.metrics.averagePowerFactor));
    case 'THD':
      return Math.max(
        ...points.flatMap(p => [
          p.metrics.phaseA?.thd ?? 0,
          p.metrics.phaseB?.thd ?? 0,
          p.metrics.phaseC?.thd ?? 0,
        ])
      );
    case 'V':
      return points.reduce(
        (s, p) => s + (p.metrics.phaseA?.voltage ?? 230),
        0
      ) / points.length;
    case 'I':
      return points.reduce(
        (s, p) => s + (p.metrics.phaseA?.current ?? 0),
        0
      );
    case 'Freq':
      return points[0]?.metrics.frequency ?? 50;
    case 'VUnbal':
      return Math.max(...points.map(p => p.metrics.voltageUnbalance ?? 0));
    case 'IUnbal':
      return Math.max(...points.map(p => p.metrics.currentUnbalance ?? 0));
    default:
      return 0;
  }
}

/** Resolve time series for a set of metrics using the new aggregation helpers */
function resolveSeriesForConfig(
  config: WidgetConfig,
  ctx: WidgetResolverContext,
  metrics: MetricKey[],
): Record<string, TimeSeriesPoint[]> {
  const { dataSource } = config;
  const result: Record<string, TimeSeriesPoint[]> = {};

  for (const metric of metrics) {
    switch (dataSource.type) {
      case 'POINT': {
        result[metric] = getPointSeries(dataSource.refId, metric);
        break;
      }
      case 'ZONE_AGG': {
        result[metric] = aggregateZone(dataSource.refId, metric);
        break;
      }
      case 'TERRAIN_AGG': {
        const tid = dataSource.refId || ctx.terrainId || '';
        result[metric] = aggregateTerrain(tid, metric);
        break;
      }
      case 'CATEGORY_AGG': {
        const tid = ctx.terrainId || '';
        result[metric] = aggregateCategory(
          tid,
          dataSource.categoryFilter || '',
          metric
        );
        break;
      }
      default:
        result[metric] = [];
    }
  }
  return result;
}

function buildUnitsMap(metrics: MetricKey[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of metrics) {
    map[m] = METRIC_UNITS[m];
  }
  return map;
}

// -------------------------
// RESOLVERS
// -------------------------

function energyQualityResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const points = resolvePoints(config, ctx);
  const metricKeys: MetricKey[] = config.metrics.length > 0
    ? config.metrics
    : ['P', 'Energy', 'PF', 'THD'];

  const kpis: Record<string, number | null> = {};
  for (const m of metricKeys) {
    kpis[m] = Number(aggregateMetricKpi(points, m).toFixed(2));
  }

  const series = resolveSeriesForConfig(config, ctx, metricKeys);

  return {
    kpis,
    series,
    availableMetrics: metricKeys,
    meta: {
      unitByMetric: buildUnitsMap(metricKeys),
      sourceInfo: `${points.length} point(s)`,
      completeness: 98.5,
    },
  };
}

function liveLoadResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const points = resolvePoints(config, ctx);
  const metricKeys: MetricKey[] = config.metrics.length > 0
    ? config.metrics
    : ['P'];

  const kpis: Record<string, number | null> = {};
  for (const m of metricKeys) {
    kpis[m] = Number(aggregateMetricKpi(points, m).toFixed(2));
  }

  const series = resolveSeriesForConfig(config, ctx, metricKeys);

  return {
    kpis,
    series,
    availableMetrics: metricKeys,
    meta: {
      unitByMetric: buildUnitsMap(metricKeys),
      sourceInfo: `${points.length} point(s)`,
    },
  };
}

function costResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const points = resolvePoints(config, ctx);
  const energyKwh = aggregateMetricKpi(points, 'Energy');
  const dailyCost = Math.round(energyKwh * 0.095);
  const monthlyBudget = dailyCost * 30;
  const dayOfMonth = new Date().getDate();
  const progress = Math.round((dayOfMonth / 30) * 100);

  return {
    kpis: { dailyCost, monthlyBudget, progress },
    series: {},
    availableMetrics: ['Energy'],
    meta: { unitByMetric: { Energy: 'kWh' } },
  };
}

function diagnosticsResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const points = resolvePoints(config, ctx);
  const issues: Array<{ label: string; priority: string }> = [];
  for (const p of points) {
    if (p.metrics.averagePowerFactor < 0.85) {
      issues.push({ label: `PF bas – ${p.name}`, priority: 'Priorité haute' });
    }
    const thd = Math.max(
      p.metrics.phaseA?.thd ?? 0,
      p.metrics.phaseB?.thd ?? 0,
      p.metrics.phaseC?.thd ?? 0
    );
    if (thd > 8) {
      issues.push({ label: `THD élevé – ${p.name}`, priority: 'À vérifier' });
    }
  }
  return {
    kpis: { issueCount: issues.length },
    series: {},
    availableMetrics: [],
    meta: { issues },
  };
}

function alertsResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const points = resolvePoints(config, ctx);
  const alerts = points.flatMap(p =>
    p.activeAlarms.map(a => ({
      label: `${a.type.replace(/_/g, ' ')} ${a.phase ? `(Phase ${a.phase})` : ''}`,
      severity: a.severity,
      pointName: p.name,
    }))
  );
  return {
    kpis: { alertCount: alerts.length },
    series: {},
    availableMetrics: [],
    meta: { alerts },
  };
}

function forecastResolver(
  config: WidgetConfig,
  _ctx: WidgetResolverContext
): ResolvedWidgetData {
  const numPts = { '1D': 24, '7D': 28, '1M': 30, '3M': 36, '6M': 48, '1Y': 52 }[config.timeRange.value] ?? 14;
  const forecastPts: Array<{ ts: number; value: number }> = [];
  const p90Pts: Array<{ ts: number; value: number }> = [];
  for (let i = 0; i < numPts; i++) {
    const ts = Date.now() + i * 86400000;
    const p50v = Number((900 + Math.sin((i / numPts) * Math.PI * 2) * 120 + (Math.random() - 0.5) * 40).toFixed(0));
    const p90v = Number((980 + Math.sin((i / numPts) * Math.PI * 2) * 140 + (Math.random() - 0.5) * 60).toFixed(0));
    forecastPts.push({ ts, value: p50v });
    p90Pts.push({ ts, value: p90v });
  }
  return {
    kpis: { totalP50: 62500, totalP90: 71875 },
    series: { p50: forecastPts, p90: p90Pts },
    availableMetrics: ['Energy'],
    meta: { unitByMetric: { Energy: 'kWh' } },
  };
}

// -------------------------
// SOLAR RESOLVERS
// -------------------------

function pvProductionResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  // Always filter PV points
  const terrainId = config.dataSource.refId || ctx.terrainId || '';
  const allPts = terrainId ? getPointsByTerrainId(terrainId) : mockMeasurementPoints;
  const pvPoints = allPts.filter(p => p.energySourceCategory === 'PV');

  const todayKwh = pvPoints.reduce((s, p) => s + p.energyKwhExport, 0);
  const installedKwc = pvPoints.length * 20; // mock 20kWc per point
  const peakKw = pvPoints.reduce((s, p) => s + Math.abs(p.metrics.totalActivePower), 0);

  // Generate daily production series (30 days)
  const dailySeries: Array<{ ts: number; value: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const ts = Date.now() - i * 86400000;
    const seasonFactor = 1 + 0.08 * Math.sin(((29 - i) / 30) * Math.PI);
    dailySeries.push({
      ts,
      value: Number(((todayKwh || 85) * (0.8 + Math.random() * 0.4) * seasonFactor).toFixed(1)),
    });
  }

  return {
    kpis: {
      todayKwh: Math.round(todayKwh || 85),
      peakKw: Number(peakKw.toFixed(1)) || 18.5,
      installedKwc,
      specificYield: Number(((todayKwh || 85) / (installedKwc || 20) * 365).toFixed(0)),
    },
    series: { daily: dailySeries },
    availableMetrics: ['Energy', 'P'],
    meta: {
      unitByMetric: { Energy: 'kWh', P: 'kW' },
      sourceInfo: `${pvPoints.length} onduleur(s) PV`,
    },
  };
}

function pvPerformanceRatioResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const terrainId = config.dataSource.refId || ctx.terrainId || '';
  const allPts = terrainId ? getPointsByTerrainId(terrainId) : mockMeasurementPoints;
  const pvPoints = allPts.filter(p => p.energySourceCategory === 'PV');

  const pr = 0.78 + Math.random() * 0.12; // 78-90%
  const availability = 0.95 + Math.random() * 0.04; // 95-99%
  const curtailment = Math.random() * 3; // 0-3%

  // PR trend over 12 months
  const prSeries: Array<{ ts: number; value: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const ts = Date.now() - i * 30 * 86400000;
    prSeries.push({
      ts,
      value: Number((0.75 + Math.random() * 0.15).toFixed(3)),
    });
  }

  return {
    kpis: {
      pr: Number((pr * 100).toFixed(1)),
      availability: Number((availability * 100).toFixed(1)),
      curtailment: Number(curtailment.toFixed(1)),
      degradation: Number((0.5 + Math.random() * 0.3).toFixed(2)),
    },
    series: { pr: prSeries },
    availableMetrics: ['P', 'Energy'],
    meta: {
      unitByMetric: { pr: '%', availability: '%' },
      sourceInfo: `${pvPoints.length} onduleur(s)`,
    },
  };
}

function batteryStatusResolver(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const soc = 45 + Math.random() * 40; // 45-85%
  const cycleCount = Number((1.1 + Math.random() * 0.5).toFixed(1));
  const chargeKwh = Number((65 + Math.random() * 30).toFixed(0));
  const dischargeKwh = Number((55 + Math.random() * 25).toFixed(0));
  const health = Number((96 + Math.random() * 3).toFixed(1));

  // SOC over 24h
  const socSeries: Array<{ ts: number; value: number }> = [];
  for (let i = 0; i < 24; i++) {
    const ts = Date.now() - (23 - i) * 3600000;
    socSeries.push({
      ts,
      value: Number((50 + Math.sin((i - 6) / 12 * Math.PI) * 35 + (Math.random() - 0.5) * 10).toFixed(1)),
    });
  }

  return {
    kpis: {
      soc: Number(soc.toFixed(0)),
      cycleCount,
      chargeKwh,
      dischargeKwh,
      health,
    },
    series: { soc: socSeries },
    availableMetrics: ['Energy'],
    meta: {
      unitByMetric: { soc: '%', Energy: 'kWh' },
      sourceInfo: 'Batterie LFP',
    },
  };
}

// -------------------------
// WIDGET DEFINITIONS
// -------------------------

export const widgetDefinitions: WidgetDefinition[] = [
  {
    id: 'energy-quality-summary',
    title: 'Qualité énergie (Charges)',
    description: 'Puissance, énergie, PF min et THD max — par défaut sur les charges (LOAD).',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Gauge,
    configSchema: {
      allowedScopes: ['POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'CATEGORY_AGG'],
      supportedMetrics: ['P', 'Energy', 'PF', 'THD'],
      supportsMultiMetric: true,
      hasTimeRange: true,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'LOAD' },
        metrics: ['P', 'Energy', 'PF', 'THD'],
        timeRange: { mode: 'WIDGET_MANAGED', value: '1M' },
        display: { viewMode: 'MIXED', multiMetricMode: 'TABS', primaryMetric: 'P' },
      },
    },
    resolver: energyQualityResolver,
    renderer: () => null, // rendered inline in WidgetBoard
  },
  {
    id: 'live-load',
    title: 'Courbe de charge live (Charges)',
    description: 'Évolution temps réel de la puissance — par défaut sur les charges (LOAD).',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Activity,
    configSchema: {
      allowedScopes: ['POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'CATEGORY_AGG'],
      supportedMetrics: ['P', 'Q', 'S', 'V', 'I', 'PF', 'THD'],
      supportsMultiMetric: true,
      hasTimeRange: false,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'LOAD' },
        metrics: ['P'],
        timeRange: { mode: 'FOLLOW_PAGE', value: '1D' },
        display: { viewMode: 'CHART', multiMetricMode: 'TABS' },
      },
    },
    resolver: liveLoadResolver,
    renderer: () => null,
  },
  {
    id: 'cost-energy',
    title: 'Coût estimé (Charges)',
    description: 'Suivi du coût journalier — basé sur les charges (LOAD) uniquement.',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: PiggyBank,
    configSchema: {
      allowedScopes: ['POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'CATEGORY_AGG'],
      supportedMetrics: ['Energy'],
      supportsMultiMetric: false,
      hasTimeRange: false,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'LOAD' },
        metrics: ['Energy'],
        timeRange: { mode: 'FOLLOW_PAGE', value: '1M' },
        display: { viewMode: 'KPI', multiMetricMode: 'TABS' },
      },
    },
    resolver: costResolver,
    renderer: () => null,
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics & recommandations',
    description: "Synthèse des points d'attention détectés.",
    category: 'insight',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Brain,
    configSchema: {
      allowedScopes: ['POINT'],
      allowedDataSources: ['POINT'],
      supportedMetrics: ['PF', 'THD'],
      supportsMultiMetric: false,
      hasTimeRange: false,
      defaultConfig: {
        scopeType: 'POINT',
        dataSource: { type: 'POINT', refId: '' },
        metrics: ['PF', 'THD'],
        timeRange: { mode: 'FOLLOW_PAGE', value: '1M' },
        display: { viewMode: 'TABLE', multiMetricMode: 'TABS' },
      },
    },
    resolver: diagnosticsResolver,
    renderer: () => null,
  },
  {
    id: 'active-alerts',
    title: 'Alertes actives',
    description: 'Liste des alertes prioritaires en cours.',
    category: 'risk',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: ShieldAlert,
    configSchema: {
      allowedScopes: ['POINT'],
      allowedDataSources: ['POINT'],
      supportedMetrics: [],
      supportsMultiMetric: false,
      hasTimeRange: false,
      defaultConfig: {
        scopeType: 'POINT',
        dataSource: { type: 'POINT', refId: '' },
        metrics: [],
        timeRange: { mode: 'FOLLOW_PAGE', value: '1M' },
        display: { viewMode: 'TABLE', multiMetricMode: 'TABS' },
      },
    },
    resolver: alertsResolver,
    renderer: () => null,
  },
  {
    id: 'forecast',
    title: 'Prévision consommation',
    description: 'Projection de consommation et bande de confiance.',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: LineChartIcon,
    configSchema: {
      allowedScopes: ['POINT'],
      allowedDataSources: ['POINT'],
      supportedMetrics: ['Energy'],
      supportsMultiMetric: false,
      hasTimeRange: true,
      defaultConfig: {
        scopeType: 'POINT',
        dataSource: { type: 'POINT', refId: '' },
        metrics: ['Energy'],
        timeRange: { mode: 'WIDGET_MANAGED', value: '1M' },
        display: { viewMode: 'CHART', multiMetricMode: 'TABS' },
      },
    },
    resolver: forecastResolver,
    renderer: () => null,
  },
  // -------------------------
  // SOLAR WIDGETS
  // -------------------------
  {
    id: 'pv-production',
    title: 'Production PV',
    description: 'Production solaire journalière, pic de puissance et rendement spécifique.',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Sun,
    configSchema: {
      allowedScopes: ['TERRAIN', 'ZONE', 'POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'ZONE_AGG', 'TERRAIN_AGG', 'CATEGORY_AGG'],
      supportedMetrics: ['P', 'Energy'],
      supportsMultiMetric: false,
      hasTimeRange: true,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'PV' },
        metrics: ['Energy'],
        timeRange: { mode: 'WIDGET_MANAGED', value: '1M' },
        display: { viewMode: 'MIXED', multiMetricMode: 'TABS' },
      },
    },
    resolver: pvProductionResolver,
    renderer: () => null,
  },
  {
    id: 'pv-performance-ratio',
    title: 'Performance Ratio PV',
    description: 'PR, disponibilité, curtailment et dégradation du parc solaire.',
    category: 'insight',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Zap,
    configSchema: {
      allowedScopes: ['TERRAIN', 'ZONE', 'POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'ZONE_AGG', 'TERRAIN_AGG', 'CATEGORY_AGG'],
      supportedMetrics: ['P', 'Energy'],
      supportsMultiMetric: false,
      hasTimeRange: true,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'PV' },
        metrics: ['Energy'],
        timeRange: { mode: 'WIDGET_MANAGED', value: '3M' },
        display: { viewMode: 'MIXED', multiMetricMode: 'TABS' },
      },
    },
    resolver: pvPerformanceRatioResolver,
    renderer: () => null,
  },
  {
    id: 'battery-status',
    title: 'État Batterie',
    description: 'SOC, cycles journaliers, charge/décharge et état de santé.',
    category: 'core',
    supportedSizes: ['sm', 'md', 'lg'],
    icon: Battery,
    configSchema: {
      allowedScopes: ['POINT', 'CATEGORY'],
      allowedDataSources: ['POINT', 'CATEGORY_AGG'],
      supportedMetrics: ['Energy'],
      supportsMultiMetric: false,
      hasTimeRange: false,
      defaultConfig: {
        scopeType: 'CATEGORY',
        dataSource: { type: 'CATEGORY_AGG', refId: '', categoryFilter: 'BATTERY' },
        metrics: ['Energy'],
        timeRange: { mode: 'FOLLOW_PAGE', value: '1D' },
        display: { viewMode: 'MIXED', multiMetricMode: 'TABS' },
      },
    },
    resolver: batteryStatusResolver,
    renderer: () => null,
  },
];

// -------------------------
// REGISTRY LOOKUP
// -------------------------

const _defMap = new Map(widgetDefinitions.map(d => [d.id, d]));

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return _defMap.get(id);
}

export function getWidgetDefinitions(): WidgetDefinition[] {
  return widgetDefinitions;
}
