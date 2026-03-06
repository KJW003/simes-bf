import React, { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReadings, useTerrainOverview } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  History as HistoryIcon, Download, Zap, TrendingUp, BarChart3,
  Activity, Loader2, AlertCircle,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const RANGES = [
  { key: '1D', label: '1 jour', hours: 24 },
  { key: '7D', label: '7 jours', hours: 168 },
  { key: '1M', label: '1 mois', hours: 720 },
] as const;

const METRICS = [
  { key: 'active_power_total', label: 'Puissance active (kW)', unit: 'kW' },
  { key: 'reactive_power_total', label: 'Puissance réactive (kVar)', unit: 'kVar' },
  { key: 'apparent_power_total', label: 'Puissance apparente (kVA)', unit: 'kVA' },
  { key: 'voltage_a', label: 'Tension phase A (V)', unit: 'V' },
  { key: 'current_a', label: 'Courant phase A (A)', unit: 'A' },
  { key: 'power_factor_total', label: 'Facteur de puissance', unit: '' },
  { key: 'frequency', label: 'Fréquence (Hz)', unit: 'Hz' },
  { key: 'energy_import', label: 'Énergie importée (kWh)', unit: 'kWh' },
] as const;

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function History() {
  const { selectedTerrainId } = useAppContext();
  const [range, setRange] = useState<string>('1D');
  const [metric, setMetric] = useState<string>('active_power_total');
  const [selectedPoint, setSelectedPoint] = useState<string>('');

  const rangeObj = RANGES.find(r => r.key === range) ?? RANGES[0];
  const metricObj = METRICS.find(m => m.key === metric) ?? METRICS[0];
  const now = useMemo(() => new Date(), [range]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = useMemo(() => new Date(now.getTime() - rangeObj.hours * 3600_000).toISOString(), [now, rangeObj]);

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, unknown>>;

  const { data, isLoading, isError } = useReadings(selectedTerrainId, {
    from,
    to: now.toISOString(),
    point_id: selectedPoint || undefined,
    limit: 5000,
  });

  const readings = (data?.readings ?? []) as Array<Record<string, unknown>>;

  // ─── Compute chart data
  const chartData = useMemo(() => {
    if (!readings.length) return [];
    return readings
      .map(r => ({
        time: new Date(String(r.time)).getTime(),
        value: r[metric] != null ? Number(r[metric]) : null,
        label: new Date(String(r.time)).toLocaleString('fr-FR', {
          hour: '2-digit', minute: '2-digit',
          ...(rangeObj.hours > 24 ? { day: '2-digit', month: '2-digit' } : {}),
        }),
      }))
      .sort((a, b) => a.time - b.time);
  }, [readings, metric, rangeObj]);

  // ─── Daily energy bars
  const dailyEnergy = useMemo(() => {
    if (!readings.length) return [];
    const byDay = new Map<string, { min: number; max: number }>();
    for (const r of readings) {
      const day = new Date(String(r.time)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const ei = r.energy_import != null ? Number(r.energy_import) : null;
      if (ei == null) continue;
      const entry = byDay.get(day);
      if (!entry) byDay.set(day, { min: ei, max: ei });
      else { entry.min = Math.min(entry.min, ei); entry.max = Math.max(entry.max, ei); }
    }
    return Array.from(byDay.entries()).map(([day, { min, max }]) => ({
      day,
      kwh: Math.max(0, max - min),
    }));
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
    const eis = readings.map(r => r.energy_import != null ? Number(r.energy_import) : NaN).filter(v => !isNaN(v));
    if (eis.length < 2) return 0;
    return Math.max(...eis) - Math.min(...eis);
  }, [readings]);

  // ─── CSV export
  const exportCsv = useCallback(() => {
    if (!readings.length) return;
    const header = 'time,' + metric + '\n';
    const rows = [...readings]
      .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())
      .map(r => `${r.time},${r[metric] ?? ''}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simes_${metric}_${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [readings, metric, range]);

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Historique" description="Analyse historique de consommation" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain pour voir l'historique.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Historique"
        description="Analyse historique de consommation"
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!readings.length}>
            <Download className="w-4 h-4 mr-2" />CSV
          </Button>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Période</label>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <Button key={r.key} variant={range === r.key ? 'default' : 'outline'} size="sm" onClick={() => setRange(r.key)}>
                {r.key}
              </Button>
            ))}
          </div>
        </div>

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
          <label className="text-xs font-medium text-muted-foreground">Point de mesure</label>
          <Select value={selectedPoint} onValueChange={setSelectedPoint}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Tous les points" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous les points</SelectItem>
              {points.map(p => (
                <SelectItem key={String(p.id)} value={String(p.id)}>
                  {String(p.name)} ({String(p.device)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Chargement…</CardContent></Card>}

      {isError && <Card><CardContent className="py-8 text-center text-destructive"><AlertCircle className="w-5 h-5 mx-auto mb-2" />Erreur de chargement</CardContent></Card>}

      {!isLoading && !isError && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
            <KpiCard label="Maximum" value={fmt(kpis.max)} unit={metricObj.unit} icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="Moyenne" value={fmt(kpis.avg)} unit={metricObj.unit} icon={<Activity className="w-4 h-4" />} />
            <KpiCard label="Minimum" value={fmt(kpis.min)} unit={metricObj.unit} icon={<BarChart3 className="w-4 h-4" />} />
            <KpiCard label="Énergie période" value={fmt(energyDelta, 1)} unit="kWh" icon={<Zap className="w-4 h-4" />} />
            <KpiCard label="Points" value={kpis.count} icon={<HistoryIcon className="w-4 h-4" />} />
          </div>

          {/* Load curve */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                Courbe de charge — {metricObj.label}
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
                      formatter={(v: number) => [v != null ? v.toFixed(2) : '—', metricObj.unit]}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name={metricObj.label} />
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
          {heatmapData.length > 0 && rangeObj.hours >= 168 && (
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
      )}
    </div>
  );
}