import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReadings, useTerrainOverview, useZones } from '@/hooks/useApi';
import { usePreferences } from '@/hooks/usePreferences';
import { cn } from '@/lib/utils';
import { adaptiveBucketMs, computeTimeWindow, downsampleByStep } from '@/lib/time-window';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Database, Zap, TrendingUp, BarChart3,
  Activity, Loader2, AlertCircle, Leaf, GitCompareArrows, Table, CalendarDays, ExternalLink,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Brush,
} from 'recharts';

const RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7j' },
  { key: '30d', label: '30j' },
  { key: 'custom', label: 'Jour précis' },
] as const;

const METRICS = [
  { key: 'active_power_total', label: 'Puissance active totale (kW)', unit: 'kW' },
  { key: 'active_power_a', label: 'Puissance active A (kW)', unit: 'kW' },
  { key: 'active_power_b', label: 'Puissance active B (kW)', unit: 'kW' },
  { key: 'active_power_c', label: 'Puissance active C (kW)', unit: 'kW' },
  { key: 'reactive_power_total', label: 'Puissance réactive (kVar)', unit: 'kVar' },
  { key: 'apparent_power_total', label: 'Puissance apparente (kVA)', unit: 'kVA' },
  { key: 'voltage_a', label: 'Tension phase A (V)', unit: 'V' },
  { key: 'voltage_b', label: 'Tension phase B (V)', unit: 'V' },
  { key: 'voltage_c', label: 'Tension phase C (V)', unit: 'V' },
  { key: 'voltage_ab', label: 'Tension ligne AB (V)', unit: 'V' },
  { key: 'voltage_bc', label: 'Tension ligne BC (V)', unit: 'V' },
  { key: 'voltage_ca', label: 'Tension ligne CA (V)', unit: 'V' },
  { key: 'current_a', label: 'Courant phase A (A)', unit: 'A' },
  { key: 'current_b', label: 'Courant phase B (A)', unit: 'A' },
  { key: 'current_c', label: 'Courant phase C (A)', unit: 'A' },
  { key: 'current_sum', label: 'Courant somme (A)', unit: 'A' },
  { key: 'power_factor_total', label: 'Facteur de puissance total', unit: '' },
  { key: 'power_factor_a', label: 'Facteur de puissance A', unit: '' },
  { key: 'power_factor_b', label: 'Facteur de puissance B', unit: '' },
  { key: 'power_factor_c', label: 'Facteur de puissance C', unit: '' },
  { key: 'energy_import', label: 'Énergie importée (kWh)', unit: 'kWh' },
  { key: 'energy_export', label: 'Énergie exportée (kWh)', unit: 'kWh' },
  { key: 'energy_total', label: 'Énergie totale (kWh)', unit: 'kWh' },
  { key: 'frequency', label: 'Fréquence (Hz)', unit: 'Hz' },
  { key: 'thdi_a', label: 'THD courant A (%)', unit: '%' },
  { key: 'thdi_b', label: 'THD courant B (%)', unit: '%' },
  { key: 'thdi_c', label: 'THD courant C (%)', unit: '%' },
  { key: 'thdu_a', label: 'THD tension A (%)', unit: '%' },
  { key: 'thdu_b', label: 'THD tension B (%)', unit: '%' },
  { key: 'thdu_c', label: 'THD tension C (%)', unit: '%' },
  { key: 'voltage_unbalance', label: 'Déséquilibre tension (%)', unit: '%' },
  { key: 'current_unbalance', label: 'Déséquilibre courant (%)', unit: '%' },
  { key: 'temp_a', label: 'Température A (°C)', unit: '°C' },
  { key: 'temp_b', label: 'Température B (°C)', unit: '°C' },
  { key: 'temp_c', label: 'Température C (°C)', unit: '°C' },
  { key: 'temp_n', label: 'Température N (°C)', unit: '°C' },
] as const;

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function History() {
  const { selectedTerrainId } = useAppContext();
  const navigate = useNavigate();
  const prefs = usePreferences();
  const [range, setRange] = useState<string>('24h');
  const [customDate, setCustomDate] = useState('');
  const [metric, setMetric] = useState<string>('active_power_total');
  const [selectedPoint, setSelectedPoint] = useState<string>('_all');
  const [compareMode, setCompareMode] = useState(false);
  const [compareDate, setCompareDate] = useState('');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [zoneFilter, setZoneFilter] = useState<string>('_all');
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const handleLegendClick = useCallback((e: any) => {
    const key = e.dataKey ?? e.value;
    if (!key) return;
    setHiddenSeries(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }, []);

  const rangeObj = RANGES.find(r => r.key === range) ?? RANGES[0];
  const metricObj = METRICS.find(m => m.key === metric) ?? METRICS[0];
  const window = useMemo(() => computeTimeWindow(range, customDate), [range, customDate]);

  // Flexible comparison date range
  const comparisonWindow = useMemo(() => {
    const durationMs = Math.max(1, window.durationMs);
    if (!compareDate) {
      const toTs = new Date(window.from).getTime();
      const fromTs = toTs - durationMs;
      return { from: new Date(fromTs).toISOString(), to: new Date(toTs).toISOString() };
    }

    const start = new Date(`${compareDate}T00:00:00`);
    if (range === 'custom') {
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    return { from: start.toISOString(), to: new Date(start.getTime() + durationMs).toISOString() };
  }, [compareDate, range, window]);

  const compFrom = comparisonWindow.from;
  const compTo = comparisonWindow.to;
  const compareLabel = useMemo(() => {
    if (!compareDate) return 'J-1';
    return new Date(compareDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }, [compareDate]);

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const { data: zonesData } = useZones(selectedTerrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, unknown>>;
  const zones = ((zonesData ?? []) as unknown) as Array<Record<string, unknown>>;

  // Filter points by zone
  const filteredPoints = useMemo(() => {
    if (zoneFilter === '_all') return points;
    if (zoneFilter === '_unassigned') return points.filter(p => !(p as any).zone_id);
    return points.filter(p => String((p as any).zone_id) === zoneFilter);
  }, [points, zoneFilter]);

  // In chart mode, only fetch the selected metric + energy_total (for daily bars) to reduce payload
  // In table mode, fetch all columns (user explicitly wants full Acrel table)
  const readingsCols = useMemo(() => {
    if (viewMode === 'table') return undefined; // all columns
    const needed = new Set([metric, 'energy_total']);
    return Array.from(needed).join(',');
  }, [viewMode, metric]);

  const { data, isLoading, isError } = useReadings(selectedTerrainId, {
    from: window.from,
    to: window.to,
    point_id: selectedPoint === '_all' ? undefined : selectedPoint,
    cols: readingsCols,
    limit: range === '24h' ? 4000 : range === '7d' ? 12000 : 25000,
  });

  const readings = (data?.readings ?? []) as Array<Record<string, unknown>>;

  // Comparison data (flexible date)
  const { data: compareData } = useReadings(
    compareMode ? selectedTerrainId : null,
    compareMode ? {
      from: compFrom,
      to: compTo,
      point_id: selectedPoint === '_all' ? undefined : selectedPoint,
      cols: metric,
    } : undefined,
  );
  const compareReadings = (compareData?.readings ?? []) as Array<Record<string, unknown>>;

  // ─── Compute chart data (with optional comparison)
  const chartData = useMemo(() => {
    if (!readings.length) return [];
    const includeDay = window.durationMs > 24 * 3600_000;
    const bucketMs = adaptiveBucketMs(window.durationMs);
    const maxPoints = window.durationMs <= 2 * 24 * 3600_000 ? 800 : window.durationMs <= 7 * 24 * 3600_000 ? 1200 : 1600;

    const toSeries = (rows: Array<Record<string, unknown>>, shiftMs = 0) => {
      const buckets = new Map<number, { sum: number; count: number }>();
      for (const r of rows) {
        const rawTs = new Date(String(r.time)).getTime() + shiftMs;
        const ts = Math.floor(rawTs / bucketMs) * bucketMs;
        const val = r[metric] != null ? Number(r[metric]) : NaN;
        if (Number.isNaN(val)) continue;
        const existing = buckets.get(ts);
        if (existing) {
          existing.sum += val;
          existing.count += 1;
        } else {
          buckets.set(ts, { sum: val, count: 1 });
        }
      }
      const ordered = Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([time, agg]) => ({
          time,
          value: agg.sum / agg.count,
          label: new Date(time).toLocaleString('fr-FR', {
            hour: '2-digit', minute: '2-digit',
            ...(includeDay ? { day: '2-digit', month: '2-digit' } : {}),
          }),
        }));
      return downsampleByStep(ordered, maxPoints);
    };

    const mainData = toSeries(readings);

    if (compareMode && compareReadings.length) {
      // Align comparison data to main time axis
      const shiftMs = new Date(window.from).getTime() - new Date(compFrom).getTime();
      const compMap = new Map<number, number>();
      for (const item of toSeries(compareReadings, shiftMs)) {
        compMap.set(item.time, item.value);
      }
      return mainData.map(d => ({
        ...d,
        yesterday: compMap.get(d.time) ?? null,
      }));
    }
    return mainData;
  }, [readings, compareReadings, metric, window, compareMode, compFrom]);

  // ─── Daily energy bars
  const dailyEnergy = useMemo(() => {
    if (!readings.length) return [];
    // Group by (day, point_id) to avoid mixing cumulative counters from different meters
    const byDayPoint = new Map<string, { min: number; max: number }>();
    for (const r of readings) {
      const day = new Date(String(r.time)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const ei = r.energy_total != null ? Number(r.energy_total) : null;
      if (ei == null) continue;
      const pid = String(r.point_id ?? '_unknown');
      const key = `${day}|${pid}`;
      const entry = byDayPoint.get(key);
      if (!entry) byDayPoint.set(key, { min: ei, max: ei });
      else { entry.min = Math.min(entry.min, ei); entry.max = Math.max(entry.max, ei); }
    }
    // Sum per-point deltas per day
    const dayTotals = new Map<string, number>();
    for (const [key, { min, max }] of byDayPoint) {
      const day = key.split('|')[0];
      dayTotals.set(day, (dayTotals.get(day) ?? 0) + Math.max(0, max - min));
    }
    return Array.from(dayTotals.entries()).map(([day, kwh]) => ({ day, kwh }));
  }, [readings]);

  // ─── Heatmap (7 days × 24 hours)
  const heatmapData = useMemo(() => {
    if (!readings.length) return [];
    const grid: Record<string, { sum: number; count: number }> = {};
    for (const r of readings) {
      const dt = new Date(String(r.time));
      const dow = dt.getDay();
      const hour = dt.getHours();
      const key = `${dow}-${hour}`;
      const val = r[metric] != null ? Number(r[metric]) : NaN;
      if (isNaN(val)) continue;
      if (!grid[key]) grid[key] = { sum: 0, count: 0 };
      grid[key].sum += val;
      grid[key].count++;
    }
    const result: Array<{ dow: number; dayName: string; hour: number; avg: number }> = [];
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const entry = grid[`${dow}-${hour}`];
        result.push({ dow, dayName: dayNames[dow], hour, avg: entry ? entry.sum / entry.count : 0 });
      }
    }
    return result;
  }, [readings, metric]);

  const heatMax = useMemo(() => Math.max(1, ...heatmapData.map(h => h.avg)), [heatmapData]);

  // ─── KPIs
  const kpis = useMemo(() => {
    const vals = readings.map(r => r[metric] != null ? Number(r[metric]) : NaN).filter(v => !isNaN(v));
    if (!vals.length) return { max: 0, avg: 0, min: 0, count: 0 };
    return {
      max: Math.max(...vals),
      avg: vals.reduce((s, v) => s + v, 0) / vals.length,
      min: Math.min(...vals),
      count: vals.length,
    };
  }, [readings, metric]);

  const energyDelta = useMemo(() => {
    // Group by point_id to avoid mixing cumulative counters from different meters
    const byPoint = new Map<string, { min: number; max: number }>();
    for (const r of readings) {
      const val = r.energy_total != null ? Number(r.energy_total) : NaN;
      if (isNaN(val)) continue;
      const pid = String(r.point_id ?? '_unknown');
      const entry = byPoint.get(pid);
      if (!entry) byPoint.set(pid, { min: val, max: val });
      else { entry.min = Math.min(entry.min, val); entry.max = Math.max(entry.max, val); }
    }
    let total = 0;
    for (const { min, max } of byPoint.values()) total += Math.max(0, max - min);
    return total;
  }, [readings]);

  const co2 = useMemo(() => energyDelta * prefs.co2Factor, [energyDelta, prefs.co2Factor]);

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Données" description="Analyse de consommation" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain pour voir les données.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Données"
        description="Analyse de consommation"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'chart' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('chart')}
            >
              <BarChart3 className="w-4 h-4 mr-1" />Graphiques
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              <Table className="w-4 h-4 mr-1" />Tableau
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/exports')}>
              <ExternalLink className="w-4 h-4 mr-2" />Exports
            </Button>
          </div>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Période</label>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <Button
                key={r.key}
                variant={range === r.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setRange(r.key);
                  if (r.key === 'custom' && !customDate) setCustomDate(new Date().toISOString().slice(0, 10));
                }}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {range === 'custom' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Jour</label>
            <input
              type="date"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="h-10 rounded border px-2 text-sm bg-background"
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Métrique</label>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METRICS.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Zone</label>
          <Select value={zoneFilter} onValueChange={(v) => { setZoneFilter(v); setSelectedPoint('_all'); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Toutes les zones" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Toutes les zones</SelectItem>
              {zones.map(z => (
                <SelectItem key={String(z.id)} value={String(z.id)}>{String(z.name)}</SelectItem>
              ))}
              <SelectItem value="_unassigned">Hors zone</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Point de mesure</label>
          <Select value={selectedPoint} onValueChange={setSelectedPoint}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Tous les points" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Tous les points</SelectItem>
              {filteredPoints.map(p => (
                <SelectItem key={String(p.id)} value={String(p.id)}>
                  {String(p.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant={compareMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          className="gap-1"
        >
          <GitCompareArrows className="w-4 h-4" />
          {compareMode ? `Comparaison: ${compareLabel}` : 'Comparer'}
        </Button>
        {compareMode && (
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <input
              type="date"
              value={compareDate}
              onChange={e => setCompareDate(e.target.value)}
              className="h-8 rounded border px-2 text-xs bg-background"
              placeholder="Date de comparaison"
            />
            {compareDate && (
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setCompareDate('')}>J-1</Button>
            )}
          </div>
        )}
      </div>

      {isLoading && <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Chargement…</CardContent></Card>}

      {isError && <Card><CardContent className="py-8 text-center text-destructive"><AlertCircle className="w-5 h-5 mx-auto mb-2" />Erreur de chargement</CardContent></Card>}

      {!isLoading && !isError && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 animate-stagger-children">
            <KpiCard label="Maximum" value={fmt(kpis.max)} unit={metricObj.unit} icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="Moyenne" value={fmt(kpis.avg)} unit={metricObj.unit} icon={<Activity className="w-4 h-4" />} />
            <KpiCard label="Minimum" value={fmt(kpis.min)} unit={metricObj.unit} icon={<BarChart3 className="w-4 h-4" />} />
            <KpiCard label="Énergie période" value={fmt(energyDelta, 1)} unit="kWh" icon={<Zap className="w-4 h-4" />} />
            <KpiCard label="CO₂ période" value={fmt(co2, 1)} unit="kg" icon={<Leaf className="w-4 h-4" />} />
            <KpiCard label="Points" value={kpis.count} icon={<Database className="w-4 h-4" />} />
          </div>

          {/* Load curve */}
          {viewMode === 'chart' ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    Courbe de charge — {metricObj.label}
                    {compareMode && <Badge className="text-[10px] bg-orange-100 text-orange-700">vs {compareLabel}</Badge>}
                    <Badge variant="outline" className="text-[10px] ml-auto">{readings.length} mesures</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {chartData.length === 0 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Aucune donnée pour cette période</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12 }}
                          labelFormatter={(_l, payload) => {
                            if (!payload?.length) return '';
                            return new Date(payload[0]?.payload?.time).toLocaleString('fr-FR');
                          }}
                          formatter={(v: number, name: string) => [v != null ? v.toFixed(2) : '—', name === 'yesterday' ? compareLabel : metricObj.unit]}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
                          onClick={handleLegendClick}
                          formatter={(value: string, entry: any) => (
                            <span style={{ color: hiddenSeries.has(entry.dataKey) ? '#9ca3af' : entry.color, textDecoration: hiddenSeries.has(entry.dataKey) ? 'line-through' : 'none' }}>{value}</span>
                          )}
                        />
                        <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name="Aujourd'hui" hide={hiddenSeries.has('value')} isAnimationActive={false} />
                        {compareMode && (
                          <Line type="monotone" dataKey="yesterday" stroke="#f97316" dot={false} strokeWidth={1.5} strokeDasharray="5 5" name={compareLabel} connectNulls hide={hiddenSeries.has('yesterday')} isAnimationActive={false} />
                        )}
                        <Brush dataKey="label" height={20} stroke="hsl(var(--primary))" travellerWidth={8} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

          {/* Daily energy bars */}
          {dailyEnergy.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Énergie journalière (kWh)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dailyEnergy}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toFixed(1), 'kWh']} />
                    <Bar dataKey="kwh" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Heatmap */}
          {heatmapData.length > 0 && window.durationMs >= 7 * 24 * 3600_000 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Profil hebdomadaire — {metricObj.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `60px repeat(24, 1fr)` }}>
                    <div className="text-[10px] text-muted-foreground" />
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={i} className="text-[10px] text-center text-muted-foreground w-6">{i}h</div>
                    ))}
                    {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((dayLabel, di) => (
                      <React.Fragment key={dayLabel}>
                        <div className="text-[10px] text-muted-foreground pr-2 text-right leading-6">{dayLabel}</div>
                        {Array.from({ length: 24 }, (_, hour) => {
                          const realDow = di === 6 ? 0 : di + 1;
                          const cell = heatmapData.find(h => h.dow === realDow && h.hour === hour);
                          const intensity = cell ? cell.avg / heatMax : 0;
                          return (
                            <div
                              key={hour}
                              className="w-6 h-6 rounded-sm"
                              style={{ backgroundColor: `hsl(var(--primary) / ${Math.max(0.05, intensity)})` }}
                              title={`${dayLabel} ${hour}h — ${cell ? cell.avg.toFixed(1) : '—'} ${metricObj.unit}`}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
            </>
          ) : (
            /* Acrel-style table view — all parameters at each timestamp */
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Tableau de données — style Acrel-EEM</CardTitle>
              </CardHeader>
              <CardContent>
                {readings.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Aucune donnée pour cette période</div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-background z-10">
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 px-2 font-medium whitespace-nowrap">Horodatage</th>
                          <th className="pb-2 px-2 font-medium whitespace-nowrap">Point</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ua (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ub (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Uc (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Uab (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ubc (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Uca (V)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ia (A)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ib (A)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Ic (A)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">I∑ (A)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">P tot (kW)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Pa (kW)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Pb (kW)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Pc (kW)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Q (kvar)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">S (kVA)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">PF tot</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">PF a</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">PF b</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">PF c</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">E imp (kWh)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">E exp (kWh)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">E tot (kWh)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Freq (Hz)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDi A</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDi B</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDi C</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDu A</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDu B</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">THDu C</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Déséq. U</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">Déséq. I</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">T°A (°C)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">T°B (°C)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">T°C (°C)</th>
                          <th className="pb-2 px-2 font-medium text-right whitespace-nowrap">T°N (°C)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...readings]
                          .sort((a, b) => new Date(String(b.time)).getTime() - new Date(String(a.time)).getTime())
                          .slice(0, 300)
                          .map((r, i) => {
                            const pointName = points.find(p => String(p.id) === String(r.point_id))?.name;
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                <td className="py-1 px-2 whitespace-nowrap text-muted-foreground">
                                  {new Date(String(r.time)).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="py-1 px-2 font-medium truncate max-w-[120px]">{String(pointName ?? r.point_id ?? '—')}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_ab)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_bc)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_ca)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.current_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.current_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.current_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.current_sum)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.active_power_total)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.active_power_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.active_power_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.active_power_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.reactive_power_total)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.apparent_power_total)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.power_factor_total)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.power_factor_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.power_factor_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.power_factor_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.energy_import)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.energy_export)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.energy_total)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.frequency)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdi_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdi_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdi_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdu_a)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdu_b)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.thdu_c)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.voltage_unbalance)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.current_unbalance)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.temp_a, 1)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.temp_b, 1)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.temp_c, 1)}</td>
                                <td className="py-1 px-2 text-right mono">{fmt(r.temp_n, 1)}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    {readings.length > 300 && (
                      <div className="py-2 text-center text-xs text-muted-foreground">Affichage des 300 dernières mesures sur {readings.length}</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}