// ============================================================
// SIMES Widget Engine – Registry
// All widget definitions: config schema, resolver, renderer.
// Resolvers work with pre-fetched overview data (ctx.points).
// ============================================================

import type {
  WidgetDefinition,
  WidgetConfig,
  ResolvedWidgetData,
  WidgetResolverContext,
  MetricKey,
} from '@/types/widget-engine';
import { METRIC_UNITS } from '@/types/widget-engine';
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
// TYPES – raw API point shape from /overview
// -------------------------
type RawPoint = Record<string, unknown> & {
  id?: string;
  name?: string;
  zone_id?: string;
  measure_category?: string;
  readings?: Record<string, unknown> | null;
};

// -------------------------
// RESOLVER HELPERS
// -------------------------

function resolvePoints(
  config: WidgetConfig,
  ctx: WidgetResolverContext
): RawPoint[] {
  const all = (ctx.points ?? []) as RawPoint[];
  const { dataSource } = config;

  switch (dataSource.type) {
    case 'POINT': {
      return all.filter(p => String(p.id) === dataSource.refId);
    }
    case 'ZONE_AGG': {
      return all.filter(p => String(p.zone_id) === dataSource.refId);
    }
    case 'TERRAIN_AGG': {
      return all; // all points already scoped to current terrain
    }
    case 'CATEGORY_AGG': {
      return dataSource.categoryFilter
        ? all.filter(p => String(p.measure_category) === dataSource.categoryFilter)
        : all;
    }
    default:
      return [];
  }
}

/** Current snapshot KPI for a metric from live overview data */
function aggregateMetricKpi(points: RawPoint[], metric: MetricKey): number {
  if (points.length === 0) return 0;
  const num = (p: RawPoint, key: string) => {
    const v = p.readings?.[key];
    return v != null ? Number(v) : 0;
  };
  const numOr = (p: RawPoint, key: string, fallback: number) => {
    const v = p.readings?.[key];
    return v != null ? Number(v) : fallback;
  };

  switch (metric) {
    case 'P':
      return points.reduce((s, p) => s + Math.abs(num(p, 'active_power_total')), 0);
    case 'Q':
      return points.reduce((s, p) => s + Math.abs(num(p, 'reactive_power_total')), 0);
    case 'S':
      return points.reduce((s, p) => s + Math.abs(num(p, 'apparent_power_total')), 0);
    case 'Energy':
      return points.reduce((s, p) => s + num(p, 'energy_import') + num(p, 'energy_export'), 0);
    case 'PF':
      return Math.min(...points.map(p => numOr(p, 'power_factor_total', 1)));
    case 'THD':
      return Math.max(
        ...points.flatMap(p => [
          num(p, 'thdi_a'),
          num(p, 'thdi_b'),
          num(p, 'thdi_c'),
        ])
      );
    case 'V':
      return points.reduce(
        (s, p) => s + numOr(p, 'voltage_a', 230),
        0
      ) / points.length;
    case 'I':
      return points.reduce(
        (s, p) => s + num(p, 'current_a'),
        0
      );
    case 'Freq':
      return numOr(points[0], 'frequency', 50);
    case 'VUnbal':
      return Math.max(...points.map(p => num(p, 'voltage_unbalance')));
    case 'IUnbal':
      return Math.max(...points.map(p => num(p, 'current_unbalance')));
    default:
      return 0;
  }
}

/** Time series are not available from the overview endpoint (snapshot only).
 *  Return empty arrays — use historical readings hooks for charts. */
function resolveSeriesForConfig(
  _config: WidgetConfig,
  _ctx: WidgetResolverContext,
  metrics: MetricKey[],
): Record<string, Array<{ ts: number; value: number }>> {
  const result: Record<string, Array<{ ts: number; value: number }>> = {};
  for (const metric of metrics) {
    result[metric] = [];
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
    const r = p.readings;
    if (!r) continue;
    const pf = r.power_factor_total != null ? Number(r.power_factor_total) : 1;
    if (pf < 0.85) {
      issues.push({ label: `PF bas – ${p.name}`, priority: 'Priorité haute' });
    }
    const thd = Math.max(
      r.thdi_a != null ? Number(r.thdi_a) : 0,
      r.thdi_b != null ? Number(r.thdi_b) : 0,
      r.thdi_c != null ? Number(r.thdi_c) : 0
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
  const alerts = points
    .filter(p => p.readings?.alarm_state != null && Number(p.readings.alarm_state) > 0)
    .map(p => ({
      label: `Alarme active (état ${p.readings?.alarm_state})`,
      severity: 'warning' as const,
      pointName: String(p.name),
    }));
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
  const all = (ctx.points ?? []) as RawPoint[];
  const pvPoints = all.filter(p => String(p.measure_category) === 'PV');

  const num = (p: RawPoint, key: string) => {
    const v = p.readings?.[key];
    return v != null ? Number(v) : 0;
  };

  const todayKwh = pvPoints.reduce((s, p) => s + num(p, 'energy_export'), 0);
  const installedKwc = pvPoints.length * 20;
  const peakKw = pvPoints.reduce((s, p) => s + Math.abs(num(p, 'active_power_total')), 0);

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
  _config: WidgetConfig,
  ctx: WidgetResolverContext
): ResolvedWidgetData {
  const all = (ctx.points ?? []) as RawPoint[];
  const pvPoints = all.filter(p => String(p.measure_category) === 'PV');

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
  _config: WidgetConfig,
  _ctx: WidgetResolverContext
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
