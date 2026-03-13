/**
 * Dashboard section components extracted for use in the unified WidgetBoard.
 * Each component is self-contained and fetches its own data.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Zap, Activity, Clock, Loader2, Leaf, TrendingUp,
  DollarSign, AlertTriangle, Bell,
  Settings2, CheckCircle2, Plus, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useDashboard, useReadings, useChartData, useTerrainOverview, useIncidentStats, usePowerPeaks, useAnomalies, stableFrom, stableNow } from '@/hooks/useApi';
import { useAlarmEngine, loadRules, saveRules, type AlarmCondition, type AlarmRule } from '@/hooks/useAlarmEngine';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Brush,
} from 'recharts';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';

const CHART_COLORS = [
  'hsl(var(--primary))',
  '#f97316', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981',
  '#eab308', '#ef4444', '#6366f1', '#14b8a6', '#f59e0b',
];

/* ── LiveKPIs ── */
export const LiveKPIs = React.memo(function LiveKPIs({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useDashboard(terrainId);
  const { data: incidentStats } = useIncidentStats();
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Chargement des données temps réel...
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) return null;

  const timeAgo = data.last_update
    ? String(Math.floor((Date.now() - new Date(data.last_update).getTime()) / 60000)) + ' min'
    : '-';

  const totalEnergy = data.energy_today.total_kwh;
  const co2Today = totalEnergy * prefs.co2Factor;
  const costToday = totalEnergy * prefs.tariffRate;
  const openAlerts = (incidentStats as any)?.open ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 animate-stagger-children">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Zap className="w-4 h-4 text-primary" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Puissance instantanée</div>
            <div className="text-lg font-semibold mono">{data.power_now_kw.toFixed(2)} <span className="text-xs font-normal">kW</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-import/10 p-2"><Activity className="w-4 h-4 text-energy-import" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Consommation totale (J)</div>
            <div className="text-lg font-semibold mono">{totalEnergy.toFixed(2)} <span className="text-xs font-normal">kWh</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-green-500/10 p-2"><Leaf className="w-4 h-4 text-green-600" /></div>
          <div>
            <div className="text-xs text-muted-foreground">CO₂ (J)</div>
            <div className="text-lg font-semibold mono">{co2Today.toFixed(2)} <span className="text-xs font-normal">kg</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2"><DollarSign className="w-4 h-4 text-amber-600" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Coût (J estimé)</div>
            <div className="text-lg font-semibold mono">{costToday >= 1000 ? (costToday / 1000).toFixed(2) + 'k' : costToday.toFixed(2)} <span className="text-xs font-normal">{currSym}</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-red-500/10 p-2"><Bell className="w-4 h-4 text-red-600" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Alertes ouvertes</div>
            <div className="text-lg font-semibold mono">{openAlerts}</div>
          </div>
          {openAlerts > 0 && (
            <Badge className="ml-auto bg-red-500 text-white text-[10px]">{openAlerts}</Badge>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2"><Clock className="w-4 h-4 text-muted-foreground" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Dernière MAJ</div>
            <div className="text-sm font-medium">il y a {timeAgo}</div>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] badge-ok">Live</Badge>
        </CardContent>
      </Card>
    </div>
  );
});

/* ── Periods for Courbe des points ── */
const LOAD_PERIODS = [
  { key: '24h', label: '24h', ms: 24 * 3600_000 },
  { key: '48h', label: '48h', ms: 48 * 3600_000 },
  { key: '7d', label: '7 jours', ms: 7 * 86400_000 },
  { key: '30d', label: '30 jours', ms: 30 * 86400_000 },
] as const;

const METRIC_OPTIONS = [
  { value: 'active_power_total', label: 'Puissance active (kW)', unit: ' kW' },
  { value: 'voltage_a', label: 'Tension phase A (V)', unit: ' V' },
  { value: 'voltage_b', label: 'Tension phase B (V)', unit: ' V' },
  { value: 'voltage_c', label: 'Tension phase C (V)', unit: ' V' },
  { value: 'current_a', label: 'Courant phase A (A)', unit: ' A' },
  { value: 'current_b', label: 'Courant phase B (A)', unit: ' A' },
  { value: 'current_c', label: 'Courant phase C (A)', unit: ' A' },
  { value: 'power_factor_total', label: 'Facteur de puissance', unit: '' },
  { value: 'energy_total', label: 'Énergie totale (kWh)', unit: ' kWh' },
] as const;

/* ── UnifiedLoadCurve (Courbe des points) ── */
export const UnifiedLoadCurve = React.memo(function UnifiedLoadCurve({ terrainId, dashboardPeriod }: { terrainId: string; from?: string; to?: string; dashboardPeriod?: string }) {
  const [period, setPeriod] = useState<string>('24h');
  const [offsetDays, setOffsetDays] = useState(0);
  const [metric, setMetric] = useState<string>('active_power_total');
  const [selectedPoints, setSelectedPoints] = useState<Set<string>>(new Set());

  // Sync with dashboard time selector
  useEffect(() => {
    if (dashboardPeriod && dashboardPeriod !== 'live') {
      const match = LOAD_PERIODS.find(p => p.key === dashboardPeriod);
      if (match) { setPeriod(match.key); setOffsetDays(0); }
    }
  }, [dashboardPeriod]);

  const periodMs = LOAD_PERIODS.find(p => p.key === period)?.ms ?? 86400_000;
  const from = useMemo(() => stableFrom(offsetDays * 86400_000 + periodMs), [periodMs, offsetDays]);
  const to = useMemo(() => stableFrom(offsetDays * 86400_000), [offsetDays]);

  // Scale limit based on period to avoid data truncation
  const limit = periodMs <= 48 * 3600_000 ? 10000 : periodMs <= 7 * 86400_000 ? 30000 : 50000;

  const metricOpt = METRIC_OPTIONS.find(m => m.value === metric) ?? METRIC_OPTIONS[0];

  const { data: overviewData } = useTerrainOverview(terrainId);
  const { data, isLoading } = useReadings(terrainId, { from, to, cols: metric, limit });
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  // Build deterministic point → color mapping (sorted by name) 
  const pointColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const sorted = [...points].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    sorted.forEach((p, i) => map.set(String(p.id), CHART_COLORS[i % CHART_COLORS.length]));
    return map;
  }, [points]);

  const togglePoint = useCallback((id: string) => {
    setSelectedPoints(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const { chartData, pointNames, pointIdByName } = useMemo(() => {
    if (!readings.length || !points.length) return { chartData: [], pointNames: [] as string[], pointIdByName: new Map<string, string>() };

    const pointMap = new Map(points.map(p => [String(p.id), String(p.name)]));
    const activePts = selectedPoints.size > 0 ? selectedPoints : new Set(points.map(p => String(p.id)));
    const pNames: string[] = [];
    const idByName = new Map<string, string>();

    for (const id of activePts) {
      const name = pointMap.get(id) ?? id;
      pNames.push(name);
      idByName.set(name, id);
    }

    const buckets = new Map<number, Record<string, number | null>>();
    for (const r of readings) {
      const pid = String(r.point_id);
      if (!activePts.has(pid)) continue;
      const t = Math.floor(new Date(String(r.time)).getTime() / 300_000) * 300_000;
      if (!buckets.has(t)) buckets.set(t, {});
      const name = pointMap.get(pid) ?? pid;
      const val = r[metric] != null ? Number(r[metric]) : null;
      if (val != null) buckets.get(t)![name] = val;
    }

    const sorted = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, vals]) => ({
        time: t,
        label: new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        ...vals,
      }));

    return { chartData: sorted, pointNames: pNames, pointIdByName: idByName };
  }, [readings, points, metric, selectedPoints]);

  const handleLegendClick = useCallback((entry: any) => {
    const name = entry.value ?? entry.dataKey;
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  if (isLoading) return <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  if (!points.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Courbe des points
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => d + (periodMs / 86400_000))} title="Période précédente">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {LOAD_PERIODS.map(p => (
              <Button key={p.key} variant={period === p.key ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => { setPeriod(p.key); setOffsetDays(0); }}>
                {p.label}
              </Button>
            ))}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => Math.max(0, d - (periodMs / 86400_000)))} disabled={offsetDays === 0} title="Période suivante">
              <ChevronRight className="w-4 h-4" />
            </Button>
            {offsetDays > 0 && <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOffsetDays(0)}>Auj.</Button>}
          </div>
        </div>
        {/* Metric selector + point chips */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select value={metric} onChange={e => setMetric(e.target.value)} className="h-7 rounded border border-input bg-background px-2 text-xs">
            {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <div className="flex flex-wrap gap-1">
            {points.map(p => {
              const pid = String(p.id);
              const active = selectedPoints.has(pid) || selectedPoints.size === 0;
              const color = pointColorMap.get(pid) ?? CHART_COLORS[0];
              return (
                <button
                  key={pid}
                  onClick={() => togglePoint(pid)}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'border-muted-foreground/20 text-muted-foreground'
                  }`}
                  style={active ? { borderColor: color + '88', boxShadow: `0 0 0 1px ${color}44` } : undefined}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: color }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px]">{readings.length} mesures</Badge>
          {offsetDays > 0 && <span className="text-[10px] text-muted-foreground">({new Date(Date.now() - (offsetDays + periodMs / 86400_000) * 86400_000).toLocaleDateString('fr-FR')} → {new Date(Date.now() - offsetDays * 86400_000).toLocaleDateString('fr-FR')})</span>}
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit={metricOpt.unit} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              labelFormatter={(_l, payload) => {
                if (!payload?.length) return '';
                return new Date(payload[0]?.payload?.time).toLocaleString('fr-FR');
              }}
              formatter={(v: number, name: string) => [v != null ? v.toFixed(2) + metricOpt.unit : '—', name]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
              onClick={handleLegendClick}
              formatter={(value: string) => (
                <span style={{ color: hiddenSeries.has(value) ? '#999' : undefined, textDecoration: hiddenSeries.has(value) ? 'line-through' : undefined }}>
                  {value}
                </span>
              )}
            />
            <Brush dataKey="label" height={20} stroke="hsl(var(--primary))" travellerWidth={8} />
            {pointNames.map(name => {
              const pid = pointIdByName.get(name) ?? '';
              const color = pointColorMap.get(pid) ?? CHART_COLORS[0];
              return (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={color}
                  dot={false}
                  strokeWidth={hiddenSeries.has(name) ? 0 : 1.5}
                  connectNulls
                  hide={hiddenSeries.has(name)}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
        ) : (
          <div className="text-center py-8 text-sm text-muted-foreground">Aucune donnée pour cette période</div>
        )}
      </CardContent>
    </Card>
  );
});

/* ── PowerPeaksTable ── */
export const PowerPeaksTable = React.memo(function PowerPeaksTable({ terrainId, from, to }: { terrainId: string; from: string; to: string }) {
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const { data: overviewData } = useTerrainOverview(terrainId);
  const { data } = useReadings(terrainId, { from, to, cols: 'active_power_total' });
  const { data: historyData } = usePowerPeaks(terrainId, 30);

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const peaks = useMemo(() => {
    if (!readings.length) return [];
    const pointMap = new Map(points.map(p => [String(p.id), String(p.name)]));
    const peakMap = new Map<string, { name: string; max: number; time: string }>();

    for (const r of readings) {
      const pid = String(r.point_id);
      const val = r.active_power_total != null ? Number(r.active_power_total) : null;
      if (val == null) continue;
      const existing = peakMap.get(pid);
      if (!existing || val > existing.max) {
        peakMap.set(pid, { name: pointMap.get(pid) ?? pid, max: val, time: String(r.time) });
      }
    }

    return Array.from(peakMap.values()).sort((a, b) => b.max - a.max);
  }, [readings, points]);

  const historyPeaks = (historyData?.peaks ?? []) as Array<{ point_id: string; peak_date: string; max_power: number; peak_time: string; point_name: string }>;

  if (!peaks.length && !historyPeaks.length) return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Pics de puissance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-sm text-muted-foreground">Aucune donnée de pics disponible pour cette période</div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Pics de puissance
          </CardTitle>
          <div className="flex gap-1">
            <Button variant={tab === 'current' ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setTab('current')}>Temps réel</Button>
            <Button variant={tab === 'history' ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setTab('history')}>Historique</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">Point</th>
                {tab === 'history' && <th className="pb-2 font-medium text-right">Date</th>}
                <th className="pb-2 font-medium text-right">Puissance max</th>
                <th className="pb-2 font-medium text-right">Horodatage</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'current' && peaks.map((p, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td className="py-2 text-right mono">{p.max.toFixed(2)} kW</td>
                  <td className="py-2 text-right text-muted-foreground">
                    {new Date(p.time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
              {tab === 'history' && historyPeaks.map((p, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2 font-medium">{p.point_name}</td>
                  <td className="py-2 text-right text-muted-foreground">{new Date(p.peak_date).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2 text-right mono">{Number(p.max_power).toFixed(2)} kW</td>
                  <td className="py-2 text-right text-muted-foreground">
                    {new Date(p.peak_time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
              {tab === 'history' && !historyPeaks.length && (
                <tr><td colSpan={4} className="py-4 text-center text-xs text-muted-foreground">Aucun historique disponible</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
});

/* ── DailyCostWidget ── */
const COST_PERIODS = [
  { key: '7d', label: '7j', days: 7 },
  { key: '30d', label: '30j', days: 30 },
  { key: '90d', label: '3 mois', days: 90 },
  { key: '365d', label: '1 an', days: 365 },
] as const;

export const DailyCostWidget = React.memo(function DailyCostWidget({ terrainId, dashboardPeriod }: { terrainId: string; dashboardPeriod?: string }) {
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const [period, setPeriod] = useState<string>('30d');
  const [offsetDays, setOffsetDays] = useState(0);

  // Sync with dashboard time selector
  useEffect(() => {
    if (dashboardPeriod && dashboardPeriod !== 'live') {
      const match = COST_PERIODS.find(p => p.key === dashboardPeriod);
      if (match) { setPeriod(match.key); setOffsetDays(0); }
    }
  }, [dashboardPeriod]);

  const periodDays = COST_PERIODS.find(p => p.key === period)?.days ?? 30;
  const from = useMemo(() => stableFrom((offsetDays + periodDays) * 86400_000), [periodDays, offsetDays]);
  const to = useMemo(() => stableFrom(offsetDays * 86400_000), [offsetDays]);
  const { data: chartResult } = useChartData(terrainId, { from, to, bucket: 'daily' });

  // Fetch today's data from 15-minute aggregation (daily agg doesn't have today yet)
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const { data: todayResult } = useChartData(
    offsetDays === 0 ? terrainId : null,
    { from: todayStart, bucket: '15m' },
  );

  const dailyCost = useMemo(() => {
    const rows = (chartResult?.data ?? []) as Array<Record<string, any>>;
    // Aggregate energy_total_delta across all points per day
    const byDay = new Map<string, number>();
    const todayLabel = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    for (const r of rows) {
      const day = new Date(String(r.day)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      // Skip today's partial data from daily bucket; will use 15m data instead
      if (offsetDays === 0 && day === todayLabel) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + (Number(r.energy_total_delta) || 0));
    }
    // Add today from 15-minute buckets (always use 15m for today to avoid stale daily data)
    if (offsetDays === 0 && todayResult?.data?.length) {
      let todayKwh = 0;
      for (const r of todayResult.data) todayKwh += Number(r.energy_total_delta) || 0;
      byDay.set(todayLabel, todayKwh);
    }
    if (!byDay.size) return [];
    // Sort dates chronologically: convert 'dd/mm' format back to Date for comparison
    return Array.from(byDay.entries())
      .sort((a, b) => {
        const [dayA, monthA] = a[0].split('/').map(Number);
        const [dayB, monthB] = b[0].split('/').map(Number);
        if (monthA !== monthB) return monthA - monthB;
        return dayA - dayB;
      })
      .map(([day, kwh]) => ({
        day, kwh: Number(kwh.toFixed(2)), cost: Number((kwh * prefs.tariffRate).toFixed(2)),
      }));
  }, [chartResult, todayResult, prefs.tariffRate, offsetDays]);

  if (!dailyCost.length) return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-600" />
          Coût journalier
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-sm text-muted-foreground">Aucune donnée de coût disponible pour cette période</div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-amber-600" />
            Coût journalier
            <span className="text-xs font-normal text-muted-foreground">({prefs.tariffRate} {currSym}/kWh)</span>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => d + periodDays)} title="Période précédente">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {COST_PERIODS.map(p => (
              <Button key={p.key} variant={period === p.key ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => { setPeriod(p.key); setOffsetDays(0); }}>
                {p.label}
              </Button>
            ))}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => Math.max(0, d - periodDays))} disabled={offsetDays === 0} title="Période suivante">
              <ChevronRight className="w-4 h-4" />
            </Button>
            {offsetDays > 0 && <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOffsetDays(0)}>Auj.</Button>}
          </div>
        </div>
        {offsetDays > 0 && <span className="text-[10px] text-muted-foreground mt-1">{new Date(Date.now() - (offsetDays + periodDays) * 86400_000).toLocaleDateString('fr-FR')} → {new Date(Date.now() - offsetDays * 86400_000).toLocaleDateString('fr-FR')}</span>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={dailyCost}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit={` ${currSym}`} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v.toFixed(2) + ' ' + (name === 'Coût' ? currSym : 'kWh'), name]} />
            <Bar dataKey="cost" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Coût" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
});

/* ── CarbonWidget ── */
const CARBON_PERIODS = [
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '90d', label: '3 mois', days: 90 },
  { key: '365d', label: '1 an', days: 365 },
] as const;

export const CarbonWidget = React.memo(function CarbonWidget({ terrainId, dashboardPeriod }: { terrainId: string; dashboardPeriod?: string }) {
  const prefs = usePreferences();
  const [period, setPeriod] = useState<string>('30d');
  const [offsetDays, setOffsetDays] = useState(0);

  // Sync with dashboard time selector
  useEffect(() => {
    if (dashboardPeriod && dashboardPeriod !== 'live') {
      const match = CARBON_PERIODS.find(p => p.key === dashboardPeriod);
      if (match) { setPeriod(match.key); setOffsetDays(0); }
    }
  }, [dashboardPeriod]);

  const periodDays = CARBON_PERIODS.find(p => p.key === period)?.days ?? 30;
  const from = useMemo(() => stableFrom((offsetDays + periodDays) * 86400_000), [periodDays, offsetDays]);
  const to = useMemo(() => stableFrom(offsetDays * 86400_000), [offsetDays]);
  const { data: chartResult } = useChartData(terrainId, { from, to, bucket: 'daily' });

  // Fetch today's data from 15-minute aggregation (daily agg doesn't have today yet)
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const { data: todayResult } = useChartData(
    offsetDays === 0 ? terrainId : null,
    { from: todayStart, bucket: '15m' },
  );

  const dailyCarbon = useMemo(() => {
    const rows = (chartResult?.data ?? []) as Array<Record<string, any>>;
    // Aggregate energy_total_delta across all points per day
    const totalByDay = new Map<string, number>();
    const todayLabel = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    for (const r of rows) {
      const day = new Date(String(r.day)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      // Skip today's partial data from daily bucket; will use 15m data instead
      if (offsetDays === 0 && day === todayLabel) continue;
      totalByDay.set(day, (totalByDay.get(day) ?? 0) + (Number(r.energy_total_delta) || 0));
    }
    // Add today from 15-minute buckets (always use 15m for today to avoid stale daily data)
    if (offsetDays === 0 && todayResult?.data?.length) {
      let todayKwh = 0;
      for (const r of todayResult.data) todayKwh += Number(r.energy_total_delta) || 0;
      totalByDay.set(todayLabel, todayKwh);
    }
    if (!totalByDay.size) return [];
    let cumulative = 0;
    // Sort dates chronologically: convert 'dd/mm' format back to Date for comparison
    return Array.from(totalByDay.entries())
      .sort((a, b) => {
        const [dayA, monthA] = a[0].split('/').map(Number);
        const [dayB, monthB] = b[0].split('/').map(Number);
        if (monthA !== monthB) return monthA - monthB;
        return dayA - dayB;
      })
      .map(([day, kwh]) => {
        const co2 = kwh * prefs.co2Factor;
        cumulative += co2;
        return { day, kwh: Number(kwh.toFixed(2)), co2: Number(co2.toFixed(2)), cumulative: Number(cumulative.toFixed(2)) };
      });
  }, [chartResult, todayResult, prefs.co2Factor, offsetDays]);

  const totalCO2 = dailyCarbon.length ? dailyCarbon[dailyCarbon.length - 1].cumulative : 0;
  const totalKwh = dailyCarbon.reduce((s, d) => s + d.kwh, 0);

  if (!dailyCarbon.length) return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Leaf className="w-4 h-4 text-green-600" />
          Empreinte carbone
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-sm text-muted-foreground">Aucune donnée carbone disponible pour cette période</div>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Leaf className="w-4 h-4 text-green-600" />
            Empreinte carbone
            <span className="text-xs font-normal text-muted-foreground">({prefs.co2Factor} kgCO₂/kWh)</span>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => d + periodDays)} title="Période précédente">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {CARBON_PERIODS.map(p => (
              <Button key={p.key} variant={period === p.key ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => { setPeriod(p.key); setOffsetDays(0); }}>
                {p.label}
              </Button>
            ))}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOffsetDays(d => Math.max(0, d - periodDays))} disabled={offsetDays === 0} title="Période suivante">
              <ChevronRight className="w-4 h-4" />
            </Button>
            {offsetDays > 0 && <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setOffsetDays(0)}>Auj.</Button>}
          </div>
        </div>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
          <span>Total: <b className="text-foreground">{totalCO2.toFixed(1)} kg CO₂</b></span>
          <span>Conso: <b className="text-foreground">{totalKwh.toFixed(1)} kWh</b></span>
          <span>Moy/jour: <b className="text-foreground">{(totalCO2 / dailyCarbon.length).toFixed(2)} kg</b></span>
          {offsetDays > 0 && <span>({new Date(Date.now() - (offsetDays + periodDays) * 86400_000).toLocaleDateString('fr-FR')} → {new Date(Date.now() - offsetDays * 86400_000).toLocaleDateString('fr-FR')})</span>}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyCarbon} barCategoryGap="15%">
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={periodDays > 90 ? Math.floor(dailyCarbon.length / 12) : 'preserveStartEnd'} />
            <YAxis yAxisId="bar" tick={{ fontSize: 10 }} unit=" kg" />
            <YAxis yAxisId="line" orientation="right" tick={{ fontSize: 10 }} unit=" kg" hide />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => {
              if (name === 'CO₂ cumulé') return [v.toFixed(1) + ' kg', name];
              if (name === 'CO₂ journalier') return [v.toFixed(2) + ' kg', name];
              return [v.toFixed(2) + ' kWh', name];
            }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="bar" dataKey="co2" fill="#86efac" radius={[3, 3, 0, 0]} name="CO₂ journalier" />
            <Line yAxisId="line" type="monotone" dataKey="cumulative" stroke="#16a34a" strokeWidth={2} dot={false} name="CO₂ cumulé" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
});

/* ── AlarmWidget ── */
export function AlarmWidget({ terrainId }: { terrainId: string }) {
  const { activeAlarms, resolvedAlarms, alarmsByDay, stats, clearHistory } = useAlarmEngine(terrainId);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const displayAlarms = useMemo(() => {
    const base = showResolved ? resolvedAlarms : activeAlarms;
    if (!selectedDay) return base;
    return base.filter(a => new Date(a.triggeredAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) === selectedDay);
  }, [activeAlarms, resolvedAlarms, selectedDay, showResolved]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Bell className="w-4 h-4 text-red-500" />
          Alarmes
          {stats.active > 0 && <Badge className="bg-red-500 text-white text-[10px]">{stats.active} actives</Badge>}
          {stats.resolved > 0 && <Badge className="bg-green-600 text-white text-[10px]">{stats.resolved} résolues</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Button size="sm" variant={!showResolved ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setShowResolved(false)}>
            <AlertTriangle className="w-3 h-3 mr-1" /> Actives ({stats.active})
          </Button>
          <Button size="sm" variant={showResolved ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setShowResolved(true)}>
            <CheckCircle2 className="w-3 h-3 mr-1" /> Résolues ({stats.resolved})
          </Button>
          {stats.total > 0 && (
            <button onClick={clearHistory} className="ml-auto text-[10px] text-muted-foreground hover:text-destructive">Effacer l&apos;historique</button>
          )}
        </div>
        <div className="flex gap-4">
          <div className="w-36 shrink-0 border-r pr-3 space-y-1 max-h-64 overflow-y-auto">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Par jour</div>
            {alarmsByDay.length === 0 && <div className="text-xs text-muted-foreground">Aucune alarme</div>}
            {alarmsByDay.map(({ day, active, resolved }) => (
              <button
                key={day}
                onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${day === selectedDay ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}
              >
                <span>{day}</span>
                <span className="flex items-center gap-1">
                  {active > 0 && <Badge className="bg-red-500 text-white text-[10px] h-5">{active}</Badge>}
                  {resolved > 0 && <Badge className="bg-green-600 text-white text-[10px] h-5">{resolved}</Badge>}
                </span>
              </button>
            ))}
          </div>
          <div className="flex-1 max-h-64 overflow-y-auto space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {showResolved ? 'Alarmes résolues' : 'Alarmes actives'}{selectedDay ? ` — ${selectedDay}` : ''}
            </div>
            {displayAlarms.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">Aucune alarme</div>}
            {displayAlarms.map((a) => {
              const isResolved = a.resolvedAt !== null;
              return (
                <div key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded text-sm border ${isResolved ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' : a.severity === 'critical' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'}`}>
                  {isResolved
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />
                    : <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.pointName}</div>
                    <div className="text-xs text-muted-foreground">{a.type}</div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(a.triggeredAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {isResolved && (
                      <div className="text-[10px] text-green-600">
                        Résolu {new Date(a.resolvedAt!).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0">{a.source === 'device' ? 'HW' : 'Règle'}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── AlarmConfigPanel ── */
export function AlarmConfigPanel({ terrainId }: { terrainId: string }) {
  const { data: overviewData } = useTerrainOverview(terrainId);
  const devicePoints = (overviewData?.points ?? []) as Array<Record<string, any>>;

  const [rules, setRules] = useState<AlarmRule[]>(() => loadRules());

  // New-rule form state (first condition)
  const [newCondition, setNewCondition] = useState('>');
  const [newElement, setNewElement] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newPointId, setNewPointId] = useState('');

  const [staleMin, setStaleMin] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem('simes-alarm-thresholds') || '{}'); return c.staleThresholdMin ?? 15; } catch { return 15; }
  });
  const [offlineMin, setOfflineMin] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem('simes-alarm-thresholds') || '{}'); return c.offlineThresholdMin ?? 60; } catch { return 60; }
  });
  const saveStatusThresholds = (s: number, o: number) => {
    try {
      const c = JSON.parse(localStorage.getItem('simes-alarm-thresholds') || '{}');
      c.staleThresholdMin = s; c.offlineThresholdMin = o;
      localStorage.setItem('simes-alarm-thresholds', JSON.stringify(c));
    } catch { /* ignore */ }
  };

  const parameters = [
    // Power
    'active_power_total', 'active_power_a', 'active_power_b', 'active_power_c',
    'reactive_power_total', 'reactive_power_a', 'reactive_power_b', 'reactive_power_c',
    'apparent_power_total', 'apparent_power_a', 'apparent_power_b', 'apparent_power_c',
    // Voltage
    'voltage_a', 'voltage_b', 'voltage_c', 'voltage_ab', 'voltage_bc', 'voltage_ca',
    // Current
    'current_a', 'current_b', 'current_c', 'current_sum',
    // Power factor
    'power_factor_total', 'power_factor_a', 'power_factor_b', 'power_factor_c',
    // Energy
    'energy_total', 'energy_export',
    // THD
    'thdi_a', 'thdi_b', 'thdi_c', 'thdu_a', 'thdu_b', 'thdu_c',
    // Network
    'frequency', 'voltage_unbalance', 'current_unbalance',
    // Temperature
    'temp_a', 'temp_b', 'temp_c', 'temp_n',
  ];

  const PARAM_LABELS: Record<string, string> = {
    active_power_total: 'P totale (kW)', active_power_a: 'P phase A', active_power_b: 'P phase B', active_power_c: 'P phase C',
    reactive_power_total: 'Q totale (kvar)', reactive_power_a: 'Q phase A', reactive_power_b: 'Q phase B', reactive_power_c: 'Q phase C',
    apparent_power_total: 'S totale (kVA)', apparent_power_a: 'S phase A', apparent_power_b: 'S phase B', apparent_power_c: 'S phase C',
    voltage_a: 'Tension A (V)', voltage_b: 'Tension B (V)', voltage_c: 'Tension C (V)',
    voltage_ab: 'Tension AB (V)', voltage_bc: 'Tension BC (V)', voltage_ca: 'Tension CA (V)',
    current_a: 'Courant A (A)', current_b: 'Courant B (A)', current_c: 'Courant C (A)', current_sum: 'Courant total (A)',
    power_factor_total: 'FP total', power_factor_a: 'FP phase A', power_factor_b: 'FP phase B', power_factor_c: 'FP phase C',
    energy_total: 'Énergie totale (kWh)', energy_export: 'Énergie export (kWh)',
    thdi_a: 'THDi A (%)', thdi_b: 'THDi B (%)', thdi_c: 'THDi C (%)',
    thdu_a: 'THDu A (%)', thdu_b: 'THDu B (%)', thdu_c: 'THDu C (%)',
    frequency: 'Fréquence (Hz)', voltage_unbalance: 'Déséq. tension (%)', current_unbalance: 'Déséq. courant (%)',
    temp_a: 'Temp. A (°C)', temp_b: 'Temp. B (°C)', temp_c: 'Temp. C (°C)', temp_n: 'Temp. N (°C)',
  };

  const doSaveRules = (updated: AlarmRule[]) => { setRules(updated); saveRules(updated); };

  const addRule = () => {
    if (!newElement || !newValue) return;
    const rule: AlarmRule = {
      id: Date.now(),
      conditions: [{ element: newElement, condition: newCondition, value: newValue }],
      active: true,
      pointId: newPointId || null,
    };
    doSaveRules([...rules, rule]);
    setNewElement(''); setNewValue(''); setNewPointId('');
  };

  const addConditionToRule = (ruleId: number) => {
    doSaveRules(rules.map(r => r.id === ruleId
      ? { ...r, conditions: [...r.conditions, { element: '', condition: '>', value: '' }] }
      : r));
  };

  const updateCondition = (ruleId: number, idx: number, patch: Partial<AlarmCondition>) => {
    doSaveRules(rules.map(r => r.id === ruleId
      ? { ...r, conditions: r.conditions.map((c, i) => i === idx ? { ...c, ...patch } : c) }
      : r));
  };

  const removeCondition = (ruleId: number, idx: number) => {
    doSaveRules(rules.map(r => {
      if (r.id !== ruleId) return r;
      const next = r.conditions.filter((_, i) => i !== idx);
      return { ...r, conditions: next };
    }).filter(r => r.conditions.length > 0));
  };

  const toggleRule = (id: number) => doSaveRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const deleteRule = (id: number) => doSaveRules(rules.filter(r => r.id !== id));

  const getPointName = (pid: string | null | undefined) => {
    if (!pid) return 'Tous';
    const pt = devicePoints.find(p => String(p.id) === pid);
    return pt ? String(pt.name) : pid;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          Configuration des alarmes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status thresholds */}
        <div className="p-3 border rounded-lg bg-muted/30 space-y-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">Statut des appareils (dernière donnée reçue)</div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> En ligne</span>
            <span className="text-muted-foreground">&lt;</span>
            <input type="number" min={1} value={staleMin} onChange={e => { const v = Number(e.target.value); setStaleMin(v); saveStatusThresholds(v, offlineMin); }} className="h-7 w-16 rounded border px-2 text-xs bg-background text-center" />
            <span className="text-muted-foreground">min</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Inactif</span>
            <span className="text-muted-foreground">&lt;</span>
            <input type="number" min={1} value={offlineMin} onChange={e => { const v = Number(e.target.value); setOfflineMin(v); saveStatusThresholds(staleMin, v); }} className="h-7 w-16 rounded border px-2 text-xs bg-background text-center" />
            <span className="text-muted-foreground">min</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Hors ligne</span>
          </div>
        </div>

        {/* Add new rule */}
        <div className="flex flex-wrap items-end gap-2 p-3 border rounded-lg bg-muted/30">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">Appareil</label>
            <Select value={newPointId || '_all'} onValueChange={v => setNewPointId(v === '_all' ? '' : v)}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Tous" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Tous les appareils</SelectItem>
                {devicePoints.map(p => <SelectItem key={String(p.id)} value={String(p.id)}>{String(p.name)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">Paramètre</label>
            <Select value={newElement} onValueChange={setNewElement}>
              <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Choisir..." /></SelectTrigger>
              <SelectContent className="max-h-60">
                {parameters.map(p => <SelectItem key={p} value={p}>{PARAM_LABELS[p] ?? p.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">Condition</label>
            <Select value={newCondition} onValueChange={setNewCondition}>
              <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value=">">&gt;</SelectItem>
                <SelectItem value="<">&lt;</SelectItem>
                <SelectItem value=">=">&ge;</SelectItem>
                <SelectItem value="<=">&le;</SelectItem>
                <SelectItem value="==">=</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">Valeur seuil</label>
            <input type="number" step="any" value={newValue} onChange={e => setNewValue(e.target.value)} className="h-8 w-24 rounded border px-2 text-xs bg-background" placeholder="ex: 0.7" />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={addRule} disabled={!newElement || !newValue}>+ Ajouter règle</Button>
        </div>

        {/* Rules list */}
        {rules.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">Aucune règle configurée — les alarmes ne se déclencheront que sur les codes matériels (alarm_state)</div>}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {rules.map(rule => (
            <div key={rule.id} className={`p-3 rounded border space-y-2 ${rule.active ? '' : 'opacity-50'}`}>
              {/* Rule header */}
              <div className="flex items-center gap-2">
                <button onClick={() => toggleRule(rule.id)} className={`w-4 h-4 rounded-sm border shrink-0 ${rule.active ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                  {rule.active && <span className="text-primary-foreground text-[10px] flex items-center justify-center">✓</span>}
                </button>
                <Badge variant="outline" className="text-[9px] shrink-0">{getPointName(rule.pointId)}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {rule.conditions.length} condition{rule.conditions.length > 1 ? 's' : ''} (ET)
                </span>
                <span className="flex-1" />
                <button onClick={() => addConditionToRule(rule.id)} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> Condition
                </button>
                <button onClick={() => deleteRule(rule.id)} className="text-xs text-destructive hover:underline">Supprimer</button>
              </div>
              {/* Conditions */}
              <div className="space-y-1 pl-6">
                {rule.conditions.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-[10px] font-semibold text-muted-foreground w-6">ET</span>}
                    {idx === 0 && <span className="w-6" />}
                    <Select value={cond.element || '_none'} onValueChange={v => updateCondition(rule.id, idx, { element: v === '_none' ? '' : v })}>
                      <SelectTrigger className="w-44 h-7 text-xs"><SelectValue placeholder="Paramètre" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="_none" disabled>Paramètre</SelectItem>
                        {parameters.map(p => <SelectItem key={p} value={p}>{PARAM_LABELS[p] ?? p.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={cond.condition} onValueChange={v => updateCondition(rule.id, idx, { condition: v })}>
                      <SelectTrigger className="w-16 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value=">">&gt;</SelectItem>
                        <SelectItem value="<">&lt;</SelectItem>
                        <SelectItem value=">=">&ge;</SelectItem>
                        <SelectItem value="<=">&le;</SelectItem>
                        <SelectItem value="==">=</SelectItem>
                      </SelectContent>
                    </Select>
                    <input
                      type="number" step="any" value={cond.value}
                      onChange={e => updateCondition(rule.id, idx, { value: e.target.value })}
                      className="h-7 w-20 rounded border px-2 text-xs bg-background"
                      placeholder="seuil"
                    />
                    {rule.conditions.length > 1 && (
                      <button onClick={() => removeCondition(rule.id, idx)} className="text-muted-foreground hover:text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── AnomalyWidget ── */
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-blue-400 text-white',
};

const TYPE_LABELS: Record<string, string> = {
  residual: 'Résidu vs prévision',
  isolation_forest: 'Isolation Forest',
};

export const AnomalyWidget = React.memo(function AnomalyWidget({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useAnomalies(terrainId, 30);
  const anomalies = data?.anomalies ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Anomalies détectées</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Anomalies détectées</CardTitle></CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">Service indisponible</p></CardContent>
      </Card>
    );
  }

  const unresolved = anomalies.filter(a => !a.resolved);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Anomalies détectées
          {unresolved.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-xs">{unresolved.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Aucune anomalie détectée sur les 30 derniers jours</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {anomalies.slice(0, 20).map(a => (
              <div key={a.id} className={`flex items-start gap-2 p-2 rounded-md border text-xs ${a.resolved ? 'opacity-50' : ''}`}>
                <Badge className={`shrink-0 text-[10px] px-1.5 ${SEVERITY_COLORS[a.severity] ?? 'bg-gray-400 text-white'}`}>
                  {a.severity}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{new Date(a.anomaly_date).toLocaleDateString('fr-FR')}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{TYPE_LABELS[a.anomaly_type] ?? a.anomaly_type}</span>
                  </div>
                  {a.description && <p className="text-muted-foreground mt-0.5 truncate">{a.description}</p>}
                  {a.deviation_pct != null && (
                    <p className="text-muted-foreground mt-0.5">
                      Déviation: {a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct.toFixed(1)}%
                      {a.expected_kwh != null && a.actual_kwh != null && (
                        <span> ({a.actual_kwh.toFixed(1)} vs {a.expected_kwh.toFixed(1)} kWh attendus)</span>
                      )}
                    </p>
                  )}
                </div>
                {a.resolved && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
