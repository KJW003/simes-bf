/**
 * Dashboard section components extracted for use in the unified WidgetBoard.
 * Each component is self-contained and fetches its own data.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Zap, Activity, Clock, Loader2, Leaf, TrendingUp,
  DollarSign, AlertTriangle, Bell,
  Settings2, CheckCircle2, Plus, X,
} from 'lucide-react';
import { useDashboard, useReadings, useTerrainOverview, useIncidentStats, stableFrom, stableNow } from '@/hooks/useApi';
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

  const totalEnergy = data.energy_today.import_kwh;
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

/* ── UnifiedLoadCurve ── */
export const UnifiedLoadCurve = React.memo(function UnifiedLoadCurve({ terrainId, from, to }: { terrainId: string; from: string; to: string }) {
  const { data: overviewData } = useTerrainOverview(terrainId);
  const { data, isLoading } = useReadings(terrainId, { from, to, limit: 5000 });
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const { chartData, pointNames } = useMemo(() => {
    if (!readings.length || !points.length) return { chartData: [], pointNames: [] as string[] };

    const pointMap = new Map(points.map(p => [String(p.id), String(p.name)]));
    const pNames = [...new Set(readings.map(r => String(r.point_id)))].map(id => pointMap.get(id) ?? id);

    const buckets = new Map<number, Record<string, number | null>>();
    for (const r of readings) {
      const t = Math.floor(new Date(String(r.time)).getTime() / 300_000) * 300_000;
      if (!buckets.has(t)) buckets.set(t, {});
      const name = pointMap.get(String(r.point_id)) ?? String(r.point_id);
      const val = r.active_power_total != null ? Number(r.active_power_total) : null;
      if (val != null) buckets.get(t)![name] = val;
    }

    const sorted = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, vals]) => ({
        time: t,
        label: new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        ...vals,
      }));

    return { chartData: sorted, pointNames: pNames };
  }, [readings, points]);

  const handleLegendClick = useCallback((entry: any) => {
    const name = entry.value ?? entry.dataKey;
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  if (isLoading) return <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  if (!chartData.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Courbe de charge
          <span className="text-xs font-normal text-muted-foreground ml-1">(cliquez légende pour isoler)</span>
          <Badge variant="outline" className="text-[10px] ml-auto">{readings.length} mesures</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit=" kW" />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              labelFormatter={(_l, payload) => {
                if (!payload?.length) return '';
                return new Date(payload[0]?.payload?.time).toLocaleString('fr-FR');
              }}
              formatter={(v: number) => [v != null ? v.toFixed(2) : '—', 'kW']}
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
            {pointNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={false}
                strokeWidth={hiddenSeries.has(name) ? 0 : 1.5}
                connectNulls
                hide={hiddenSeries.has(name)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
});

/* ── PowerPeaksTable ── */
export const PowerPeaksTable = React.memo(function PowerPeaksTable({ terrainId, from, to }: { terrainId: string; from: string; to: string }) {
  const { data: overviewData } = useTerrainOverview(terrainId);
  const { data } = useReadings(terrainId, { from, to, limit: 5000 });

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

  if (!peaks.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Pics de puissance — 24h
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">Point</th>
                <th className="pb-2 font-medium text-right">Puissance max</th>
                <th className="pb-2 font-medium text-right">Horodatage</th>
              </tr>
            </thead>
            <tbody>
              {peaks.map((p, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td className="py-2 text-right mono">{p.max.toFixed(2)} kW</td>
                  <td className="py-2 text-right text-muted-foreground">
                    {new Date(p.time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
});

/* ── DailyCostWidget ── */
export const DailyCostWidget = React.memo(function DailyCostWidget({ terrainId }: { terrainId: string }) {
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const from = useMemo(() => stableFrom(30 * 86400_000), []);
  const to = useMemo(() => stableNow(), []);
  const { data } = useReadings(terrainId, { from, to, limit: 10000 });
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const dailyCost = useMemo(() => {
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
    return Array.from(byDay.entries()).map(([day, { min, max }]) => {
      const kwh = Math.max(0, max - min);
      return { day, kwh: Number(kwh.toFixed(2)), cost: Number((kwh * prefs.tariffRate).toFixed(2)) };
    });
  }, [readings, prefs.tariffRate]);

  if (!dailyCost.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-600" />
          Coût journalier — évolution
          <span className="text-xs font-normal text-muted-foreground">({prefs.tariffRate} {currSym}/kWh)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={dailyCost}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit={` ${currSym}`} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v.toFixed(2), name === 'cost' ? currSym : 'kWh']} />
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

export const CarbonWidget = React.memo(function CarbonWidget({ terrainId }: { terrainId: string }) {
  const prefs = usePreferences();
  const [period, setPeriod] = useState<string>('30d');

  const periodDays = CARBON_PERIODS.find(p => p.key === period)?.days ?? 30;
  const from = useMemo(() => stableFrom(periodDays * 86400_000), [periodDays]);
  const to = useMemo(() => stableNow(), []);
  const { data } = useReadings(terrainId, { from, to, limit: 50000 });
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const dailyCarbon = useMemo(() => {
    if (!readings.length) return [];
    // Group readings by point then by day for accurate delta-based kWh
    const pointDays = new Map<string, Map<string, { min: number; max: number }>>();
    for (const r of readings) {
      const pid = String(r.point_id ?? 'all');
      const day = new Date(String(r.time)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const ei = r.energy_import != null ? Number(r.energy_import) : null;
      if (ei == null) continue;
      if (!pointDays.has(pid)) pointDays.set(pid, new Map());
      const dayMap = pointDays.get(pid)!;
      const entry = dayMap.get(day);
      if (!entry) dayMap.set(day, { min: ei, max: ei });
      else { entry.min = Math.min(entry.min, ei); entry.max = Math.max(entry.max, ei); }
    }
    // Aggregate all points per day
    const totalByDay = new Map<string, number>();
    for (const dayMap of pointDays.values()) {
      for (const [day, { min, max }] of dayMap) {
        totalByDay.set(day, (totalByDay.get(day) ?? 0) + Math.max(0, max - min));
      }
    }
    let cumulative = 0;
    return Array.from(totalByDay.entries()).map(([day, kwh]) => {
      const co2 = kwh * prefs.co2Factor;
      cumulative += co2;
      return { day, kwh: Number(kwh.toFixed(2)), co2: Number(co2.toFixed(2)), cumulative: Number(cumulative.toFixed(2)) };
    });
  }, [readings, prefs.co2Factor]);

  const totalCO2 = dailyCarbon.length ? dailyCarbon[dailyCarbon.length - 1].cumulative : 0;
  const totalKwh = dailyCarbon.reduce((s, d) => s + d.kwh, 0);

  if (!dailyCarbon.length) return null;

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
            {CARBON_PERIODS.map(p => (
              <Button key={p.key} variant={period === p.key ? 'default' : 'outline'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          <span>Total: <b className="text-foreground">{totalCO2.toFixed(1)} kg CO₂</b></span>
          <span>Conso: <b className="text-foreground">{totalKwh.toFixed(1)} kWh</b></span>
          <span>Moy/jour: <b className="text-foreground">{(totalCO2 / dailyCarbon.length).toFixed(2)} kg</b></span>
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
    try { const c = JSON.parse(localStorage.getItem('simes-map-config') || '{}'); return c.staleThresholdMin ?? 15; } catch { return 15; }
  });
  const [offlineMin, setOfflineMin] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem('simes-map-config') || '{}'); return c.offlineThresholdMin ?? 60; } catch { return 60; }
  });
  const saveStatusThresholds = (s: number, o: number) => {
    try {
      const c = JSON.parse(localStorage.getItem('simes-map-config') || '{}');
      c.staleThresholdMin = s; c.offlineThresholdMin = o;
      localStorage.setItem('simes-map-config', JSON.stringify(c));
    } catch { /* ignore */ }
  };

  const parameters = ['active_power_total', 'reactive_power_total', 'voltage_a', 'voltage_b', 'voltage_c',
    'current_a', 'current_b', 'current_c', 'power_factor_total', 'energy_import', 'thdi_a'];

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
              <SelectContent>
                {parameters.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}
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
                      <SelectContent>
                        <SelectItem value="_none" disabled>Paramètre</SelectItem>
                        {parameters.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}
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
