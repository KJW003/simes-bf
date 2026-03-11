import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useAppContext } from '@/contexts/AppContext';
import { useTerrainOverview, useReadings, stableFrom, stableNow } from '@/hooks/useApi';
import { ConfigureWidgetModal } from '@/components/widgets/ConfigureWidgetModal';
import { getWidgetDefinition, getWidgetDefinitions } from '@/lib/widget-registry';
import { LiveKPIs, UnifiedLoadCurve, PowerPeaksTable, DailyCostWidget, CarbonWidget, AlarmWidget, AlarmConfigPanel } from '@/components/widgets/dashboard-sections';
import { SiteMapWidget } from '@/components/widgets/SiteMapWidget';
import { cn } from '@/lib/utils';
import { METRIC_LABELS, METRIC_UNITS, ENERGY_SOURCE_LABELS } from '@/types/widget-engine';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  GripVertical,
  Maximize2,
  Pin,
  PinOff,
  Trash2,
  Settings,
  AlertTriangle,
  BarChart3,
  ExternalLink,
  FileDown,
} from 'lucide-react';
import type {
  WidgetLayoutItem,
  WidgetSize,
  WidgetRuntimeState,
  WidgetConfig,
  WidgetDefinition,
  ResolvedWidgetData,
  WidgetResolverContext,
  MetricKey,
} from '@/types/widget-engine';

/** Format a timestamp for chart X-axis */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Time period options */
const TIME_PERIOD_OPTIONS = [
  { value: '1h', label: '1 heure', ms: 60 * 60 * 1000 },
  { value: '6h', label: '6 heures', ms: 6 * 60 * 60 * 1000 },
  { value: '12h', label: '12 heures', ms: 12 * 60 * 60 * 1000 },
  { value: '24h', label: '24 heures', ms: 24 * 60 * 60 * 1000 },
  { value: '48h', label: '48 heures', ms: 48 * 60 * 60 * 1000 },
  { value: '7d', label: '7 jours', ms: 7 * 24 * 60 * 60 * 1000 },
];

// -------------------------
// Unique instance ID generator
// -------------------------
let _counter = 0;
function nextInstanceId(): string {
  _counter += 1;
  return `wi_${Date.now().toString(36)}_${_counter}`;
}

// -------------------------
// Build default WidgetConfig from a definition's schema defaults
// -------------------------
function buildDefaultConfig(def: WidgetDefinition, terrainId?: string): WidgetConfig {
  const dc = def.configSchema.defaultConfig;
  return {
    scopeType: dc.scopeType ?? 'TERRAIN',
    dataSource: {
      type: dc.dataSource?.type ?? 'TERRAIN_AGG',
      refId: dc.dataSource?.refId || terrainId || '',
    },
    metrics: dc.metrics ?? [],
    timeRange: dc.timeRange ?? { mode: 'FOLLOW_PAGE', value: '1M' },
    display: dc.display ?? { viewMode: 'MIXED', multiMetricMode: 'TABS' },
  };
}

// -------------------------
// Chart colors for multi-metric
// -------------------------
const METRIC_COLORS: string[] = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

// -------------------------
// Downsample helper – reduce 1440 pts to a displayable count
// -------------------------
function downsample(
  pts: Array<{ ts: number; value: number }>,
  maxPts: number
): Array<{ ts: number; value: number }> {
  if (pts.length <= maxPts) return pts;
  const step = Math.ceil(pts.length / maxPts);
  return pts.filter((_, i) => i % step === 0);
}

// -------------------------
// Single metric chart
// -------------------------
function MetricChart({
  data,
  metric,
  size,
  color,
  label,
}: {
  data: Array<{ ts: number; value: number }>;
  metric: string;
  size: WidgetSize;
  color: string;
  label?: string;
}) {
  const chartData = useMemo(
    () => downsample(data, size === 'sm' ? 48 : size === 'md' ? 96 : 192),
    [data, size]
  );
  const unit = METRIC_UNITS[metric as MetricKey] ?? '';
  const displayLabel = label ?? METRIC_LABELS[metric as MetricKey] ?? metric;

  if (chartData.length === 0) {
    return (
      <div className={cn(
        'flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded-md',
        size === 'sm' ? 'h-20' : size === 'md' ? 'h-28' : 'h-40'
      )}>
        <BarChart3 className="w-4 h-4 mr-2 opacity-40" />
        Aucune donnée disponible
      </div>
    );
  }

  return (
    <div className={cn(size === 'sm' ? 'h-20' : size === 'md' ? 'h-28' : 'h-40')}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="ts"
            tickFormatter={fmtTime}
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            interval="preserveStartEnd"
            minTickGap={40}
            domain={['dataMin', 'dataMax']}
            type="number"
            scale="time"
          />
          <YAxis hide={size === 'sm'} tick={{ fontSize: 10 }} width={40} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
          <ChartTooltip
            formatter={(val: number) => [`${val.toFixed(2)} ${unit}`, displayLabel]}
            labelFormatter={(ts: number) => fmtDateTime(ts)}
          />
          <Line
            type="monotone"
            dataKey="value"
            name={displayLabel}
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// -------------------------
// Inline renderers – config-driven with TABS / SMALL_MULTIPLES
// -------------------------
function renderWidgetContent(
  defId: string,
  size: WidgetSize,
  data: ResolvedWidgetData,
  config: WidgetConfig,
  ctx?: { terrainId?: string; from?: string; to?: string },
): React.ReactNode {
  switch (defId) {
    // ── Dashboard standalone sections (rendered without outer Card) ──
    case 'dashboard-kpis':
      return ctx?.terrainId ? <LiveKPIs terrainId={ctx.terrainId} /> : null;
    case 'dashboard-load-curve':
      return ctx?.terrainId ? <UnifiedLoadCurve terrainId={ctx.terrainId} /> : null;
    case 'dashboard-map':
      return ctx?.terrainId ? <SiteMapWidget terrainId={ctx.terrainId} size={size} /> : null;
    case 'dashboard-alarms':
      return ctx?.terrainId ? <AlarmWidget terrainId={ctx.terrainId} /> : null;
    case 'dashboard-alarm-config':
      return ctx?.terrainId ? <AlarmConfigPanel terrainId={ctx.terrainId} /> : null;
    case 'dashboard-daily-cost':
      return ctx?.terrainId ? <DailyCostWidget terrainId={ctx.terrainId} /> : null;
    case 'dashboard-carbon':
      return ctx?.terrainId ? <CarbonWidget terrainId={ctx.terrainId} /> : null;
    case 'dashboard-power-peaks':
      return ctx?.terrainId ? <PowerPeaksTable terrainId={ctx.terrainId} from={ctx.from ?? stableFrom(86400_000)} to={ctx.to ?? stableNow()} /> : null;

    // ── Core metric widgets ──
    case 'energy-quality-summary':
    case 'live-load':
      return <MultiMetricWidget size={size} data={data} config={config} />;

    case 'cost-energy': {
      const dailyCost = (data.kpis?.dailyCost as number) ?? 0;
      const progress = (data.kpis?.progress as number) ?? 0;
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold">{dailyCost.toLocaleString('fr-FR')} XOF</div>
          <div className="text-xs text-muted-foreground">Aujourd&apos;hui – +3,9% vs hier</div>
          <Progress value={progress} />
          <div className="text-xs text-muted-foreground">{progress}% du budget mensuel</div>
        </div>
      );
    }

    case 'diagnostics': {
      const issues = (data.meta?.issues as Array<{ label: string; priority: string }>) ?? [];
      return (
        <div className="space-y-2 text-sm">
          {issues.slice(0, size === 'sm' ? 2 : 3).map((issue, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span>{issue.label}</span>
              <Badge variant="outline" className="text-[10px]">{issue.priority}</Badge>
            </div>
          ))}
          {issues.length === 0 && (
            <div className="text-muted-foreground text-xs">Aucun point d&apos;attention</div>
          )}
        </div>
      );
    }

    case 'active-alerts': {
      const alerts = (data.meta?.alerts as Array<{ label: string; severity: string; pointName: string }>) ?? [];
      const severityVariant = (s: string) => (s === 'critical' ? 'destructive' as const : 'outline' as const);
      return (
        <div className="space-y-2 text-sm">
          {alerts.slice(0, size === 'sm' ? 2 : 3).map((a, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span>{a.label}</span>
              <Badge variant={severityVariant(a.severity)} className="text-[10px] capitalize">{a.severity}</Badge>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="text-muted-foreground text-xs">Aucune alerte active</div>
          )}
        </div>
      );
    }

    case 'forecast': {
      const p50 = data.series?.p50 ?? [];
      const p90 = data.series?.p90 ?? [];
      // Merge into combined array for recharts
      const merged = p50.map((pt, i) => ({
        ts: pt.ts,
        p50: pt.value,
        p90: p90[i]?.value ?? pt.value,
      }));
      return (
        <div className={cn(size === 'sm' ? 'h-24' : 'h-32')}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={merged}>
              <defs>
                <linearGradient id="fcBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-4))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="ts" hide />
              <YAxis hide />
              <ChartTooltip />
              <Area dataKey="p90" stroke="transparent" fill="url(#fcBand)" />
              <Line dataKey="p50" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );
    }

    case 'pv-production': {
      const todayKwh = (data.kpis?.todayKwh as number) ?? 0;
      const peakKw = (data.kpis?.peakKw as number) ?? 0;
      const specificYield = (data.kpis?.specificYield as number) ?? 0;
      const dailySeries = data.series?.daily ?? [];
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground">Aujourd'hui</div>
              <div className="text-lg font-semibold">{todayKwh} <span className="text-xs text-muted-foreground">kWh</span></div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Pic</div>
              <div className="text-lg font-semibold">{peakKw} <span className="text-xs text-muted-foreground">kW</span></div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Yield</div>
              <div className="text-lg font-semibold">{specificYield} <span className="text-xs text-muted-foreground">kWh/kWc</span></div>
            </div>
          </div>
          {dailySeries.length > 0 && (
            <MetricChart data={dailySeries} metric="Energy" size={size} color="hsl(var(--chart-4))" />
          )}
        </div>
      );
    }

    case 'pv-performance-ratio': {
      const pr = (data.kpis?.pr as number) ?? 0;
      const availability = (data.kpis?.availability as number) ?? 0;
      const curtailment = (data.kpis?.curtailment as number) ?? 0;
      const degradation = (data.kpis?.degradation as number) ?? 0;
      const prSeries = data.series?.pr ?? [];
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] text-muted-foreground">PR</div>
              <div className="text-2xl font-semibold">{pr}<span className="text-xs text-muted-foreground ml-0.5">%</span></div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Disponibilité</div>
              <div className="text-2xl font-semibold">{availability}<span className="text-xs text-muted-foreground ml-0.5">%</span></div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Curtailment</div>
              <div className="text-sm font-semibold">{curtailment}%</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Dégradation</div>
              <div className="text-sm font-semibold">{degradation}%/an</div>
            </div>
          </div>
          {prSeries.length > 0 && size !== 'sm' && (
            <MetricChart data={prSeries} metric="P" size={size} color="hsl(var(--chart-4))" />
          )}
        </div>
      );
    }

    case 'battery-status': {
      const soc = (data.kpis?.soc as number) ?? 0;
      const cycleCount = (data.kpis?.cycleCount as number) ?? 0;
      const chargeKwh = (data.kpis?.chargeKwh as number) ?? 0;
      const dischargeKwh = (data.kpis?.dischargeKwh as number) ?? 0;
      const health = (data.kpis?.health as number) ?? 0;
      const socSeries = data.series?.soc ?? [];
      return (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{soc}%</span>
            <span className="text-xs text-muted-foreground">SOC</span>
            <Badge variant="outline" className="text-[10px] ml-auto">Santé {health}%</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-muted-foreground">Cycles:</span> {cycleCount}</div>
            <div><span className="text-muted-foreground">Charge:</span> {chargeKwh} kWh</div>
            <div><span className="text-muted-foreground">Décharge:</span> {dischargeKwh} kWh</div>
          </div>
          {socSeries.length > 0 && size !== 'sm' && (
            <MetricChart data={socSeries} metric="Energy" size={size} color="hsl(var(--chart-3))" />
          )}
        </div>
      );
    }

    default:
      return <div className="text-xs text-muted-foreground">Widget inconnu</div>;
  }
}

// -------------------------
// Multi-Metric Widget (TABS / SMALL_MULTIPLES)
// -------------------------
function MultiMetricWidget({
  size,
  data,
  config,
}: {
  size: WidgetSize;
  data: ResolvedWidgetData;
  config: WidgetConfig;
}) {
  const metrics = data.availableMetrics;
  const [activeTab, setActiveTab] = useState(0);
  const mode = config.display.multiMetricMode;
  const colLabels = (data.meta?.columnLabels ?? {}) as Record<string, string>;
  const getLabel = (m: string) => colLabels[m] ?? METRIC_LABELS[m as MetricKey] ?? m;
  const getUnit = (m: string) => (data.meta?.unitByMetric as Record<string, string>)?.[m] ?? METRIC_UNITS[m as MetricKey] ?? '';

  // Reset activeTab when metrics list changes
  const metricsKey = metrics.join(',');
  const [prevMetricsKey, setPrevMetricsKey] = useState(metricsKey);
  if (metricsKey !== prevMetricsKey) {
    setPrevMetricsKey(metricsKey);
    setActiveTab(0);
  }

  // Clamp activeTab to valid index (metrics.length = "all" overlay tab)
  const clampedTab = activeTab === metrics.length ? activeTab : Math.min(activeTab, Math.max(0, metrics.length - 1));

  // If no metrics → placeholder
  if (metrics.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground border border-dashed rounded-md">
        <BarChart3 className="w-4 h-4 mr-2 opacity-40" />
        Aucune métrique sélectionnée
      </div>
    );
  }

  // Single metric → simple chart
  if (metrics.length <= 1) {
    const metric = metrics[0] ?? 'P';
    const series = data.series?.[metric] ?? [];
    const kpiVal = data.kpis?.[metric];
    const unit = getUnit(metric);
    return (
      <div className="space-y-2">
        {kpiVal != null && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{Number(kpiVal).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </div>
        )}
        <MetricChart data={series} metric={metric} size={size} color={METRIC_COLORS[0]} />
      </div>
    );
  }

  // SMALL_MULTIPLES mode: grid of small charts (when lg) 
  if (mode === 'SMALL_MULTIPLES' && size === 'lg') {
    return (
      <div className="space-y-2">
        {/* KPI row */}
        <div className="flex flex-wrap gap-4">
          {metrics.map((m) => {
            const val = data.kpis?.[m];
            const unit = getUnit(m);
            return (
              <div key={m} className="min-w-[80px]">
                <div className="text-xs text-muted-foreground">{getLabel(m)}</div>
                <div className="text-lg font-semibold">
                  {val != null ? Number(val).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '–'}
                  <span className="text-xs text-muted-foreground ml-1">{unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        {/* Grid of charts */}
        <div className={cn(
          'grid gap-2',
          metrics.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'
        )}>
          {metrics.map((m, i) => {
            const series = data.series?.[m] ?? [];
            return (
              <div key={m} className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">{getLabel(m)}</div>
                <MetricChart data={series} metric={m} size="sm" color={METRIC_COLORS[i % METRIC_COLORS.length]} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Build merged overlay chart data for multi-curve display
  const overlayData = useMemo(() => {
    const tsSet = new Set<number>();
    metrics.forEach(m => (data.series?.[m] ?? []).forEach(pt => tsSet.add(pt.ts)));
    const allTs = Array.from(tsSet).sort((a, b) => a - b);
    const lookup: Record<string, Map<number, number>> = {};
    metrics.forEach(m => {
      const map = new Map<number, number>();
      (data.series?.[m] ?? []).forEach(pt => map.set(pt.ts, pt.value));
      lookup[m] = map;
    });
    return allTs.map(ts => {
      const row: Record<string, number | undefined> = { ts };
      metrics.forEach(m => { row[m] = lookup[m].get(ts); });
      return row;
    });
  }, [data.series, metrics]);

  // TABS mode (default, also fallback for SMALL_MULTIPLES on non-lg sizes)
  const currentMetric = metrics[clampedTab] ?? metrics[0];
  const currentSeries = data.series?.[currentMetric] ?? [];
  // "all" tab shows the overlay chart
  const ALL_TAB = metrics.length; // index beyond last metric

  return (
    <div className="space-y-2">
      {/* KPI strip */}
      <div className="flex flex-wrap gap-4 overflow-x-auto">
        {metrics.map((m) => {
          const val = data.kpis?.[m];
          const unit = getUnit(m);
          return (
            <div key={m} className="min-w-[60px] shrink-0">
              <div className="text-[10px] text-muted-foreground truncate max-w-[100px]">{getLabel(m)}</div>
              <div className="text-sm font-semibold whitespace-nowrap">
                {val != null ? Number(val).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '–'}
                <span className="text-[10px] text-muted-foreground ml-0.5">{unit}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {metrics.length > 1 && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab(ALL_TAB); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              'px-2 py-1 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer shrink-0 whitespace-nowrap',
              clampedTab === ALL_TAB || activeTab === ALL_TAB
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Toutes
          </button>
        )}
        {metrics.map((m, i) => (
          <button
            key={m}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab(i); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              'px-2 py-1 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer shrink-0 whitespace-nowrap',
              i === clampedTab && activeTab !== ALL_TAB
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {getLabel(m)}
          </button>
        ))}
      </div>
      {/* Active chart: overlay or single */}
      {activeTab === ALL_TAB ? (
        <div className={cn(size === 'sm' ? 'h-20' : size === 'md' ? 'h-28' : 'h-40')}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={overlayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="ts"
                tickFormatter={fmtTime}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                interval="preserveStartEnd"
                minTickGap={40}
                domain={['dataMin', 'dataMax']}
                type="number"
                scale="time"
              />
              <YAxis hide={size === 'sm'} tick={{ fontSize: 10 }} width={40} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} />
              <ChartTooltip
                formatter={(val: number, name: string) => [`${Number(val).toFixed(2)} ${getUnit(name)}`, getLabel(name)]}
                labelFormatter={(ts: number) => fmtDateTime(ts)}
              />
              <Legend formatter={(value: string) => getLabel(value)} />
              {metrics.map((m, i) => (
                <Line
                  key={m}
                  type="monotone"
                  dataKey={m}
                  name={m}
                  stroke={METRIC_COLORS[i % METRIC_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <MetricChart
          data={currentSeries}
          metric={currentMetric}
          size={size}
          color={METRIC_COLORS[clampedTab % METRIC_COLORS.length]}
          label={getLabel(currentMetric)}
        />
      )}
    </div>
  );
}

// -------------------------
// Default layout
// -------------------------
const widgetDefs = getWidgetDefinitions();

function buildDefaultLayout(terrainId?: string): WidgetLayoutItem[] {
  const order: Array<{ id: string; size: WidgetSize; state?: WidgetRuntimeState }> = [
    // Dashboard sections first
    { id: 'dashboard-kpis', size: 'lg' },
    { id: 'dashboard-load-curve', size: 'lg' },
    { id: 'dashboard-map', size: 'lg' },
    { id: 'dashboard-alarms', size: 'md' },
    { id: 'dashboard-alarm-config', size: 'md' },
    { id: 'dashboard-daily-cost', size: 'md' },
    { id: 'dashboard-carbon', size: 'md' },
    { id: 'dashboard-power-peaks', size: 'lg' },
    // Custom metric widgets
    { id: 'energy-quality-summary', size: 'md' },
    { id: 'live-load', size: 'lg' },
    { id: 'active-alerts', size: 'md', state: 'partial' },
    { id: 'diagnostics', size: 'md' },
    { id: 'forecast', size: 'md' },
  ];
  return order.map(o => {
    const def = getWidgetDefinition(o.id);
    return {
      id: o.id,
      instanceId: nextInstanceId(),
      size: o.size,
      state: o.state,
      pinned: false,
      config: def ? buildDefaultConfig(def, terrainId) : ({} as WidgetConfig),
    };
  });
}

const sizeClassMap: Record<WidgetSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-1 xl:col-span-2',
  lg: 'col-span-1 md:col-span-2 xl:col-span-3',
};

const sizeLabelMap: Record<WidgetSize, string> = {
  sm: 'Petit',
  md: 'Moyen',
  lg: 'Grand',
};

const stateBadgeMap: Record<WidgetRuntimeState, { label: string; className: string }> = {
  ready: { label: 'OK', className: 'badge-ok' },
  loading: { label: 'Chargement', className: 'badge-info' },
  partial: { label: 'Partiel', className: 'badge-warning' },
  error: { label: 'Erreur', className: 'badge-critical' },
  offline: { label: 'Hors ligne', className: 'badge-warning' },
};

const STORAGE_VERSION = 'v8'; // bump: removed duplicate cost-energy, server sync
const buildStorageKey = (userId?: string) => `simes_widget_layout_${STORAGE_VERSION}_${userId ?? 'guest'}`;

function isValidLayout(data: unknown): data is WidgetLayoutItem[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (d: Record<string, unknown>) => typeof d.id === 'string' && typeof d.instanceId === 'string' && typeof d.config === 'object'
  );
}

function loadLayout(storageKey: string, terrainId?: string): WidgetLayoutItem[] {
  const fallback = buildDefaultLayout(terrainId);
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (!isValidLayout(parsed)) return fallback;
    // Auto-remove duplicate cost-energy if dashboard-daily-cost already present
    const hasDailyCost = parsed.some((i: any) => i.id === 'dashboard-daily-cost');
    if (hasDailyCost) {
      const filtered = parsed.filter((i: any) => i.id !== 'cost-energy');
      if (filtered.length !== parsed.length) {
        localStorage.setItem(storageKey, JSON.stringify(filtered));
        return filtered;
      }
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function WidgetBoard() {
  const navigate = useNavigate();
  const { currentUser, selectedTerrainId } = useAppContext();
  const storageKey = useMemo(() => buildStorageKey(currentUser?.id), [currentUser?.id]);

  // Fetch real overview data
  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const overviewPoints = useMemo(() => (overviewData?.points ?? []) as Array<Record<string, unknown>>, [overviewData]);
  const overviewZones = useMemo(() => (overviewData?.zones ?? []) as Array<Record<string, unknown>>, [overviewData]);

  // Time period selector for readings
  const [timePeriod, setTimePeriod] = useState('24h');
  const periodMs = TIME_PERIOD_OPTIONS.find(o => o.value === timePeriod)?.ms ?? 24 * 60 * 60 * 1000;

  // Fetch historical readings for chart widgets
  const readingsFrom = useMemo(() => stableFrom(periodMs), [periodMs]);
  const readingsTo = useMemo(() => stableNow(), [readingsFrom]);
  const { data: readingsData } = useReadings(selectedTerrainId, { from: readingsFrom });

  const [layout, setLayout] = useState<WidgetLayoutItem[]>(() => loadLayout(storageKey, selectedTerrainId));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [configuringInstanceId, setConfiguringInstanceId] = useState<string | null>(null);

  useEffect(() => {
    setLayout(loadLayout(storageKey, selectedTerrainId));
  }, [storageKey, selectedTerrainId]);

  // Debounced server sync for widget layout
  const layoutSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify(layout));
    // Sync to server (debounced 1s)
    if (layoutSyncTimer.current) clearTimeout(layoutSyncTimer.current);
    layoutSyncTimer.current = setTimeout(() => {
      import('@/lib/api').then(({ default: api }) => {
        api.patchSettings({ widgetLayout: layout }).catch(() => {/* silent */});
      });
    }, 1000);
  }, [layout, storageKey]);

  // Build a Map<definitionId, WidgetDefinition> for quick look-up
  const defMap = useMemo(() => {
    const map = new Map<string, WidgetDefinition>();
    widgetDefs.forEach(d => map.set(d.id, d));
    return map;
  }, []);

  // Resolver context — includes pre-fetched overview data + historical readings
  const resolverCtx: WidgetResolverContext = useMemo(
    () => ({
      terrainId: selectedTerrainId,
      points: overviewPoints,
      zones: overviewZones,
      readings: (readingsData?.readings ?? []) as Array<Record<string, unknown>>,
    }),
    [selectedTerrainId, overviewPoints, overviewZones, readingsData]
  );


  // Ordered layout with pinned first
  const orderedLayout = useMemo(() => {
    const withOrder = layout.map((item, index) => ({ ...item, order: index }));
    return withOrder
      .filter(item => defMap.has(item.id))
      .sort((a, b) => {
        if (!!a.pinned === !!b.pinned) return a.order - b.order;
        return a.pinned ? -1 : 1;
      });
  }, [layout, defMap]);

  // Library shows ALL widget types (duplicates allowed)
  const allWidgetDefs = widgetDefs;

  // Resolve data for a layout item (uses config for metrics)
  const resolveData = (item: WidgetLayoutItem): ResolvedWidgetData => {
    const def = defMap.get(item.id);
    if (!def) return { kpis: {}, series: {}, availableMetrics: [], meta: {} };
    try {
      return def.resolver(item.config, resolverCtx);
    } catch {
      return { kpis: {}, series: {}, availableMetrics: [], meta: {} };
    }
  };

  // ---- Mutations ----
  const updateSize = (instanceId: string, size: WidgetSize) => {
    setLayout(prev => prev.map(item => (item.instanceId === instanceId ? { ...item, size } : item)));
  };

  const togglePin = (instanceId: string) => {
    setLayout(prev => prev.map(item => (item.instanceId === instanceId ? { ...item, pinned: !item.pinned } : item)));
  };

  const removeWidget = (instanceId: string) => {
    setLayout(prev => prev.filter(item => item.instanceId !== instanceId));
  };

  const addWidget = (def: WidgetDefinition) => {
    const newItem: WidgetLayoutItem = {
      id: def.id,
      instanceId: nextInstanceId(),
      size: def.supportedSizes.includes('md') ? 'md' : def.supportedSizes[0],
      pinned: false,
      config: buildDefaultConfig(def, selectedTerrainId),
    };
    setLayout(prev => [...prev, newItem]);
    setLibraryOpen(false);
    // Immediately open config modal for the new widget
    setTimeout(() => setConfiguringInstanceId(newItem.instanceId), 100);
  };

  const updateWidgetConfig = (instanceId: string, config: WidgetConfig) => {
    setLayout(prev =>
      prev.map(item => (item.instanceId === instanceId ? { ...item, config } : item))
    );
  };

  const resetLayout = () => {
    const fresh = buildDefaultLayout(selectedTerrainId);
    setLayout(fresh);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(storageKey);
    }
  };

  const saveLayout = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    }
  };

  // ---- Drag & Drop ----
  const handleDragStart = (instanceId: string) => (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', instanceId);
    setDragId(instanceId);
  };

  const handleDrop = (instanceId: string) => (event: React.DragEvent) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain') || dragId;
    if (!draggedId || draggedId === instanceId) return;

    setLayout(prev => {
      const fromIndex = prev.findIndex(item => item.instanceId === draggedId);
      const toIndex = prev.findIndex(item => item.instanceId === instanceId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setHoverId(null);
    setDragId(null);
  };

  const handleDragOver = (instanceId: string) => (event: React.DragEvent) => {
    event.preventDefault();
    if (dragId !== instanceId) setHoverId(instanceId);
  };

  // Detail / fullscreen lookup
  const fullscreenItem = fullscreenId ? layout.find(i => i.instanceId === fullscreenId) ?? null : null;
  const fullscreenDef = fullscreenItem ? defMap.get(fullscreenItem.id) ?? null : null;

  // Drill-down routes
  const drillDownRoutes: Record<string, string> = {
    'energy-quality-summary': '/power-quality',
    'live-load': '/data-monitor',
    'cost-energy': '/invoice',
    'diagnostics': '/power-quality',
    'active-alerts': '/anomalies',
    'forecast': '/forecasts',
    'pv-production': '/pv-battery',
  };

  const drillDown = (widgetId: string, config: WidgetConfig) => {
    const route = drillDownRoutes[widgetId];
    if (route) {
      if (config.dataSource?.type === 'POINT' && config.dataSource.refId) {
        navigate(`/points/${config.dataSource.refId}`);
      } else {
        navigate(route);
      }
    }
  };

  // Export current layout as a JSON report snapshot
  const exportAsReport = () => {
    const report = {
      title: `Rapport tableau de bord — ${new Date().toLocaleDateString('fr-FR')}`,
      created: new Date().toISOString(),
      terrainId: selectedTerrainId,
      period: timePeriod,
      widgets: orderedLayout.map(item => {
        const def = defMap.get(item.id);
        const data = resolveData(item);
        return {
          widget: def?.title ?? item.id,
          description: def?.description ?? '',
          size: item.size,
          kpis: data.kpis,
          meta: data.meta,
        };
      }),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `simes-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ConfigureWidgetModal item
  const configuringItem = configuringInstanceId ? layout.find(i => i.instanceId === configuringInstanceId) ?? null : null;
  const configuringDef = configuringItem ? defMap.get(configuringItem.id) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Mon tableau de bord</h3>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Glissez-déposez, configurez et composez vos widgets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={timePeriod} onValueChange={setTimePeriod}>
            <SelectTrigger className="w-28 sm:w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Ajouter widget</span>
          </Button>
          <Button variant="outline" size="sm" onClick={saveLayout}>
            <span className="hidden sm:inline">Sauvegarder</span>
            <span className="sm:hidden">💾</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportAsReport}>
            <FileDown className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Rapport</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={resetLayout} className="hidden sm:flex">
            Réinitialiser
          </Button>
        </div>
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orderedLayout.map(item => {
          const def = defMap.get(item.id);
          if (!def) return null;
          const state: WidgetRuntimeState = item.state ?? 'ready';
          const stateBadge = stateBadgeMap[state];
          const data = resolveData(item);
          const dashCtx = { terrainId: selectedTerrainId, from: readingsFrom, to: readingsTo };

          // ── Standalone dashboard widget (renders its own Card) ──
          if (def.standalone) {
            return (
              <ContextMenu key={item.instanceId}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      sizeClassMap[item.size],
                      hoverId === item.instanceId && 'ring-2 ring-primary/60 rounded-lg'
                    )}
                    onDragOver={handleDragOver(item.instanceId)}
                    onDrop={handleDrop(item.instanceId)}
                  >
                    <div className="group relative h-full">
                      {/* Floating control strip */}
                      <div className="absolute -top-2 right-2 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch-manipulation transition-opacity bg-background/80 rounded px-1.5 py-0.5 border shadow-sm">
                        <span className="text-muted-foreground cursor-grab" draggable onDragStart={handleDragStart(item.instanceId)}>
                          <GripVertical className="w-3.5 h-3.5" />
                        </span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                          const sizes: WidgetSize[] = ['sm', 'md', 'lg'];
                          const nextSize = sizes[(sizes.indexOf(item.size) + 1) % sizes.length];
                          updateSize(item.instanceId, nextSize);
                        }}>
                          <span className="text-[9px] font-bold uppercase">{item.size}</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFullscreenId(item.instanceId)}>
                          <Maximize2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeWidget(item.instanceId)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {renderWidgetContent(item.id, item.size, data, item.config, dashCtx)}
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onClick={() => togglePin(item.instanceId)}>
                    {item.pinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                    {item.pinned ? 'Dépingler' : 'Épingler'}
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Settings className="w-4 h-4 mr-2" />
                      Taille
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {(['sm', 'md', 'lg'] as WidgetSize[]).map(size => (
                        <ContextMenuItem key={size} onClick={() => updateSize(item.instanceId, size)}>
                          {sizeLabelMap[size]}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="text-destructive" onClick={() => removeWidget(item.instanceId)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Supprimer
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          }

          // ── Standard card-wrapped widget ──

          return (
            <ContextMenu key={item.instanceId}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    sizeClassMap[item.size],
                    hoverId === item.instanceId && 'ring-2 ring-primary/60 rounded-lg'
                  )}
                  onDragOver={handleDragOver(item.instanceId)}
                  onDrop={handleDrop(item.instanceId)}
                >
                  <Card
                    className="h-full group"
                    onDoubleClick={() => setFullscreenId(item.instanceId)}
                  >
                    <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-muted-foreground cursor-grab"
                          draggable
                          onDragStart={handleDragStart(item.instanceId)}
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              <def.icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{def.description}</TooltipContent>
                        </Tooltip>
                        <div>
                          <div className="text-sm font-medium">{def.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {(() => {
                              const ds = item.config.dataSource;
                              if (ds.type === 'POINT') {
                                const pt = resolverCtx.points?.find(p => String(p.id) === ds.refId);
                                return pt ? String(pt.name) : 'Point';
                              }
                              if (ds.type === 'CATEGORY_AGG') {
                                return ENERGY_SOURCE_LABELS[ds.categoryFilter as keyof typeof ENERGY_SOURCE_LABELS] ?? 'Catégorie';
                              }
                              if (ds.type === 'ZONE_AGG') {
                                const z = resolverCtx.zones?.find(z => String(z.id) === ds.refId);
                                return z ? `Zone : ${String(z.name)}` : 'Zone';
                              }
                              return 'Terrain';
                            })()} · {sizeLabelMap[item.size]}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={cn('text-[10px]', stateBadge.className)}>
                          {stateBadge.label}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" onClick={(e) => {
                              e.stopPropagation();
                              const sizes: WidgetSize[] = ['sm', 'md', 'lg'];
                              const currentIdx = sizes.indexOf(item.size);
                              const nextSize = sizes[(currentIdx + 1) % sizes.length];
                              updateSize(item.instanceId, nextSize);
                            }}>
                              <span className="text-[9px] font-bold uppercase">{item.size}</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Taille : {sizeLabelMap[item.size]} — cliquer pour changer</TooltipContent>
                        </Tooltip>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" onClick={(e) => {
                          e.stopPropagation();
                          setConfiguringInstanceId(item.instanceId);
                        }}>
                          <Settings className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                          e.stopPropagation();
                          setFullscreenId(item.instanceId);
                        }}>
                          <Maximize2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-destructive hover:text-destructive" onClick={(e) => {
                          e.stopPropagation();
                          removeWidget(item.instanceId);
                        }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {state === 'loading' && (
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-24 w-full" />
                        </div>
                      )}
                      {state === 'error' && (
                        <div className="flex items-center gap-2 text-sm text-severity-critical">
                          <AlertTriangle className="w-4 h-4" />
                          Erreur de chargement
                        </div>
                      )}
                      {state === 'offline' && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <AlertTriangle className="w-4 h-4" />
                          Données hors ligne
                        </div>
                      )}
                      {state === 'partial' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-severity-warning">
                            <AlertTriangle className="w-3 h-3" />
                            Données partielles
                          </div>
                          {renderWidgetContent(item.id, item.size, data, item.config)}
                        </div>
                      )}
                      {state === 'ready' && renderWidgetContent(item.id, item.size, data, item.config)}
                    </CardContent>
                  </Card>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onClick={() => togglePin(item.instanceId)}>
                  {item.pinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                  {item.pinned ? 'Dépingler' : 'Épingler'}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setConfiguringInstanceId(item.instanceId)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Configurer
                </ContextMenuItem>
                {drillDownRoutes[item.id] && (
                  <ContextMenuItem onClick={() => drillDown(item.id, item.config)}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Voir en détail
                  </ContextMenuItem>
                )}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Settings className="w-4 h-4 mr-2" />
                    Taille
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {(['sm', 'md', 'lg'] as WidgetSize[]).map(size => (
                      <ContextMenuItem key={size} onClick={() => updateSize(item.instanceId, size)}>
                        {sizeLabelMap[size]}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive" onClick={() => removeWidget(item.instanceId)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Supprimer
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {/* Library Dialog – shows ALL widget types (duplicates allowed) */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Bibliothèque de widgets</DialogTitle>
            <DialogDescription>Ajouter un widget au tableau de bord</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto pr-1">
            {allWidgetDefs.map(w => (
              <Card key={w.id} className="border-dashed">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                          <w.icon className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{w.description}</TooltipContent>
                    </Tooltip>
                    <div>
                      <CardTitle className="text-sm">{w.title}</CardTitle>
                      <div className="text-xs text-muted-foreground">{w.description}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] uppercase">{w.category}</Badge>
                  <Button size="sm" onClick={() => addWidget(w)}>
                    Ajouter
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Dialog */}
      <Dialog open={!!fullscreenDef} onOpenChange={(open) => !open && setFullscreenId(null)}>
        <DialogContent className="max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {fullscreenDef?.title}
              {fullscreenItem && (
                <Badge variant="outline" className="text-[10px] ml-2">{fullscreenDef?.description}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">Vue plein écran du widget</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {fullscreenItem && fullscreenDef && (
              <div className="p-6 h-full [&_.h-40]:h-[60vh] [&_.h-28]:h-[55vh] [&_.h-20]:h-[50vh] [&_.h-24]:h-[50vh] [&_.h-32]:h-[55vh]">
                {renderWidgetContent(fullscreenItem.id, 'lg', resolveData(fullscreenItem), fullscreenItem.config, { terrainId: selectedTerrainId, from: readingsFrom, to: readingsTo })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Configure Widget Modal */}
      {configuringDef && configuringItem && (
        <ConfigureWidgetModal
          open={!!configuringInstanceId}
          onOpenChange={(open) => { if (!open) setConfiguringInstanceId(null); }}
          widgetTitle={configuringDef.title}
          configSchema={configuringDef.configSchema}
          initialConfig={configuringItem.config}
          onSave={(config) => updateWidgetConfig(configuringItem.instanceId, config)}
          points={overviewPoints}
          zones={overviewZones}
        />
      )}
    </div>
  );
}
