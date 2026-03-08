import React, { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReadings, useTerrainOverview, useZones } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Database, Download, Zap, TrendingUp, BarChart3,
  Activity, Loader2, AlertCircle, Leaf, GitCompareArrows, Table,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const CO2_FACTOR = 0.71;

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
  { key: 'voltage_b', label: 'Tension phase B (V)', unit: 'V' },
  { key: 'voltage_c', label: 'Tension phase C (V)', unit: 'V' },
  { key: 'current_a', label: 'Courant phase A (A)', unit: 'A' },
  { key: 'current_b', label: 'Courant phase B (A)', unit: 'A' },
  { key: 'current_c', label: 'Courant phase C (A)', unit: 'A' },
  { key: 'power_factor_total', label: 'Facteur de puissance', unit: '' },
  { key: 'energy_import', label: 'Énergie importée (kWh)', unit: 'kWh' },
  { key: 'frequency', label: 'Fréquence (Hz)', unit: 'Hz' },
  { key: 'thdi_a', label: 'THD courant A (%)', unit: '%' },
] as const;

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function History() {
  const { selectedTerrainId } = useAppContext();
  const [range, setRange] = useState<string>('1D');
  const [metric, setMetric] = useState<string>('active_power_total');
  const [selectedPoint, setSelectedPoint] = useState<string>('_all');
  const [compareMode, setCompareMode] = useState(false);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [zoneFilter, setZoneFilter] = useState<string>('_all');

  const rangeObj = RANGES.find(r => r.key === range) ?? RANGES[0];
  const metricObj = METRICS.find(m => m.key === metric) ?? METRICS[0];
  const now = useMemo(() => new Date(), [range]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = useMemo(() => new Date(now.getTime() - rangeObj.hours * 3600_000).toISOString(), [now, rangeObj]);

  // Yesterday's range for comparison
  const yesterdayFrom = useMemo(() => new Date(now.getTime() - rangeObj.hours * 3600_000 - 86400_000).toISOString(), [now, rangeObj]);
  const yesterdayTo = useMemo(() => new Date(now.getTime() - 86400_000).toISOString(), [now]);

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

  const { data, isLoading, isError } = useReadings(selectedTerrainId, {
    from,
    to: now.toISOString(),
    point_id: selectedPoint === '_all' ? undefined : selectedPoint,
    limit: 5000,
  });

  const readings = (data?.readings ?? []) as Array<Record<string, unknown>>;

  // Comparison (yesterday) data
  const { data: compareData } = useReadings(
    compareMode ? selectedTerrainId : null,
    compareMode ? {
      from: yesterdayFrom,
      to: yesterdayTo,
      point_id: selectedPoint === '_all' ? undefined : selectedPoint,
      limit: 5000,
    } : undefined,
  );
  const compareReadings = (compareData?.readings ?? []) as Array<Record<string, unknown>>;

  // ─── Compute chart data (with optional comparison)
  const chartData = useMemo(() => {
    if (!readings.length) return [];
    const mainData = readings
      .map(r => ({
        time: new Date(String(r.time)).getTime(),
        value: r[metric] != null ? Number(r[metric]) : null,
        label: new Date(String(r.time)).toLocaleString('fr-FR', {
          hour: '2-digit', minute: '2-digit',
          ...(rangeObj.hours > 24 ? { day: '2-digit', month: '2-digit' } : {}),
        }),
      }))
      .sort((a, b) => a.time - b.time);

    if (compareMode && compareReadings.length) {
      // Align yesterday's data to today's time axis (shift by 24h)
      const compMap = new Map<string, number>();
      for (const r of compareReadings) {
        const shifted = new Date(new Date(String(r.time)).getTime() + 86400_000);
        const label = shifted.toLocaleString('fr-FR', {
          hour: '2-digit', minute: '2-digit',
          ...(rangeObj.hours > 24 ? { day: '2-digit', month: '2-digit' } : {}),
        });
        const val = r[metric] != null ? Number(r[metric]) : null;
        if (val != null) compMap.set(label, val);
      }
      return mainData.map(d => ({
        ...d,
        yesterday: compMap.get(d.label) ?? null,
      }));
    }
    return mainData;
  }, [readings, compareReadings, metric, rangeObj, compareMode]);

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

  const co2 = useMemo(() => energyDelta * CO2_FACTOR, [energyDelta]);

  // ─── CSV export (multi-metric)
  const exportCsv = useCallback(() => {
    if (!readings.length) return;
    const columns = ['time', 'point_id', 'active_power_total', 'reactive_power_total', 'apparent_power_total',
      'voltage_a', 'voltage_b', 'voltage_c', 'current_a', 'current_b', 'current_c',
      'power_factor_total', 'energy_import', 'frequency', 'thdi_a'];
    const header = columns.join(',') + '\n';
    const rows = [...readings]
      .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())
      .map(r => columns.map(c => r[c] ?? '').join(','))
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simes_donnees_${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [readings, range]);

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
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!readings.length}>
              <Download className="w-4 h-4 mr-2" />CSV
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
          {compareMode ? 'Comparaison ON' : 'Comparer J-1'}
        </Button>
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
                    {compareMode && <Badge className="text-[10px] bg-orange-100 text-orange-700">vs J-1</Badge>}
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
                          formatter={(v: number, name: string) => [v != null ? v.toFixed(2) : '—', name === 'yesterday' ? 'J-1' : metricObj.unit]}
                        />
                        {compareMode && <Legend wrapperStyle={{ fontSize: 11 }} />}
                        <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name="Aujourd'hui" />
                        {compareMode && (
                          <Line type="monotone" dataKey="yesterday" stroke="#f97316" dot={false} strokeWidth={1.5} strokeDasharray="5 5" name="J-1" connectNulls />
                        )}
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
          ) : (
            /* Table view mode */
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Données brutes — {metricObj.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {readings.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Aucune donnée pour cette période</div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Horodatage</th>
                          <th className="pb-2 font-medium">Point</th>
                          <th className="pb-2 font-medium text-right">{metricObj.label}</th>
                          <th className="pb-2 font-medium text-right">Énergie (kWh)</th>
                          <th className="pb-2 font-medium text-right">PF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...readings]
                          .sort((a, b) => new Date(String(b.time)).getTime() - new Date(String(a.time)).getTime())
                          .slice(0, 200)
                          .map((r, i) => {
                            const pointName = points.find(p => String(p.id) === String(r.point_id))?.name;
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                <td className="py-1.5 text-muted-foreground">
                                  {new Date(String(r.time)).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </td>
                                <td className="py-1.5 font-medium">{String(pointName ?? r.point_id ?? '—')}</td>
                                <td className="py-1.5 text-right mono">{fmt(r[metric])} {metricObj.unit}</td>
                                <td className="py-1.5 text-right mono">{fmt(r.energy_import, 1)}</td>
                                <td className="py-1.5 text-right mono">{fmt(r.power_factor_total, 3)}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    {readings.length > 200 && (
                      <div className="py-2 text-center text-xs text-muted-foreground">Affichage des 200 dernières mesures sur {readings.length}</div>
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