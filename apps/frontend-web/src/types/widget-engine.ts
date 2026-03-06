// ============================================================
// SIMES Widget Engine – Type Definitions
// ============================================================
// Shared domain types (EnergySourceCategory, MetricKey, Zone)
// are now canonical in  src/models/*  and re-exported here for
// backward compatibility.
// ============================================================

import type { ReactNode } from 'react';

// ── Re-exports from models ──────────────────────────────────
import type { EnergySourceCategory } from '@/models/energy-source.model';
export type { EnergySourceCategory };
export { ENERGY_SOURCE_LABELS, ENERGY_SOURCE_COLORS } from '@/models/energy-source.model';

// -------------------------
// WIDGET SCOPE & DATA SOURCE
// -------------------------

export type ScopeType =
  | 'ORG'
  | 'SITE'
  | 'TERRAIN'
  | 'ZONE'
  | 'POINT'
  | 'CATEGORY';

export type DataSourceType =
  | 'POINT'
  | 'ZONE_AGG'
  | 'TERRAIN_AGG'
  | 'CATEGORY_AGG';

export interface WidgetDataSource {
  type: DataSourceType;
  refId: string; // pointId / zoneId / terrainId / categoryKey
  categoryFilter?: EnergySourceCategory;
}

// ── Re-exports from models (metrics) ────────────────────────
import type { MetricKey } from '@/models/metric.model';
export type { MetricKey };
export type { SubMetric } from '@/models/metric.model';
export { METRIC_LABELS, METRIC_UNITS, METRIC_SUB_COLUMNS } from '@/models/metric.model';

// -------------------------
// TIME RANGE
// -------------------------

export type TimeRangeMode = 'WIDGET_MANAGED' | 'FOLLOW_PAGE';

export type TimeRangeValue = '1D' | '7D' | '1M' | '3M' | '6M' | '1Y';

export interface WidgetTimeRange {
  mode: TimeRangeMode;
  value: TimeRangeValue;
}

// -------------------------
// DISPLAY OPTIONS
// -------------------------

export type ViewMode = 'KPI' | 'CHART' | 'TABLE' | 'MIXED';

export type MultiMetricMode = 'TABS' | 'SMALL_MULTIPLES';

export interface WidgetDisplay {
  viewMode: ViewMode;
  multiMetricMode: MultiMetricMode;
  primaryMetric?: MetricKey;
}

// -------------------------
// WIDGET CONFIG
// -------------------------

export interface WidgetConfig {
  scopeType: ScopeType;
  dataSource: WidgetDataSource;
  metrics: MetricKey[];
  /** Specific DB columns selected per metric (e.g. 'current_a', 'voltage_b') */
  columns?: string[];
  timeRange: WidgetTimeRange;
  display: WidgetDisplay;
}

// -------------------------
// WIDGET RUNTIME STATE
// -------------------------

export type WidgetRuntimeState = 'ready' | 'loading' | 'partial' | 'error' | 'offline';

// -------------------------
// WIDGET SIZE
// -------------------------

export type WidgetSize = 'sm' | 'md' | 'lg';

// -------------------------
// WIDGET DEFINITION (REGISTRY)
// -------------------------

export type WidgetCategory = 'core' | 'insight' | 'risk';

export interface WidgetConfigSchema {
  /** Allowed scope types for this widget */
  allowedScopes: ScopeType[];
  /** Allowed data source types */
  allowedDataSources: DataSourceType[];
  /** Which metrics the widget supports */
  supportedMetrics: MetricKey[];
  /** Does this widget support multi-metric display? */
  supportsMultiMetric: boolean;
  /** Does this widget have its own time range selector? */
  hasTimeRange: boolean;
  /** Default config to apply when creating */
  defaultConfig: Partial<WidgetConfig>;
}

export interface ResolvedWidgetData {
  /** Normalized KPI values keyed by MetricKey */
  kpis: Record<string, number | null>;
  /** Time series per metric */
  series: Record<string, Array<{ ts: number; value: number; phase?: 'A' | 'B' | 'C' }>>;
  /** Which metrics have actual data */
  availableMetrics: MetricKey[];
  /** Extra info */
  meta: {
    unitByMetric?: Record<string, string>;
    sourceInfo?: string;
    completeness?: number;
    lastSeen?: string;
    [key: string]: unknown;
  };
}

export type WidgetResolver = (
  config: WidgetConfig,
  context: WidgetResolverContext
) => ResolvedWidgetData;

export interface WidgetResolverContext {
  terrainId?: string;
  siteId?: string;
  orgId?: string;
  /** Pre-fetched points from overview API (each point has .readings sub-object) */
  points?: Array<Record<string, unknown>>;
  /** Pre-fetched zones from overview API */
  zones?: Array<Record<string, unknown>>;
  /** Historical readings from /readings API (time series) */
  readings?: Array<Record<string, unknown>>;
}

export type WidgetRenderer = (props: {
  size: WidgetSize;
  data: ResolvedWidgetData;
  config: WidgetConfig;
}) => ReactNode;

export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  category: WidgetCategory;
  supportedSizes: WidgetSize[];
  icon: React.ElementType;
  configSchema: WidgetConfigSchema;
  resolver: WidgetResolver;
  renderer: WidgetRenderer;
}

// -------------------------
// WIDGET LAYOUT ITEM (persisted)
// -------------------------

export interface WidgetLayoutItem {
  id: string;             // widgetDefinition.id
  instanceId: string;     // unique instance ID (for multiple of same widget)
  size: WidgetSize;
  state?: WidgetRuntimeState;
  pinned?: boolean;
  config: WidgetConfig;
}

// -------------------------
// ZONE TYPE (re-exported from models)
// -------------------------

export type { Zone } from '@/models/zone.model';
