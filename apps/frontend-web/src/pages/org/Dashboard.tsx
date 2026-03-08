import React, { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Zap, Activity, Clock, Radio, Loader2, Leaf, TrendingUp,
  DollarSign, AlertTriangle, Bell,
  Settings2, CalendarDays,
} from 'lucide-react';
import { useDashboard, useReadings, useTerrainOverview, useIncidentStats } from '@/hooks/useApi';
import { WidgetBoard } from '@/components/widgets/WidgetBoard';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Brush,
} from 'recharts';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import { SiteMapWidget } from '@/components/widgets/SiteMapWidget';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

const CHART_COLORS = [
  'hsl(var(--primary))',
  '#f97316', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981',
  '#eab308', '#ef4444', '#6366f1', '#14b8a6', '#f59e0b',
];

function LiveKPIs({ terrainId }: { terrainId: string }) {
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
}

/** Unified load curve with clickable legend + zoom brush */
function UnifiedLoadCurve({ terrainId, from, to }: { terrainId: string; from: string; to: string }) {
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
}

/** Power peaks table */
function PowerPeaksTable({ terrainId, from, to }: { terrainId: string; from: string; to: string }) {
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
}

/** Daily Cost Evolution Widget */
function DailyCostWidget({ terrainId }: { terrainId: string }) {
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const from = useMemo(() => new Date(Date.now() - 30 * 86400_000).toISOString(), []);
  const to = useMemo(() => new Date().toISOString(), []);
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
        <ResponsiveContainer width="100%" height={250}>
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
}

/** Carbon Footprint Widget */
function CarbonWidget({ terrainId }: { terrainId: string }) {
  const prefs = usePreferences();
  const from = useMemo(() => new Date(Date.now() - 30 * 86400_000).toISOString(), []);
  const to = useMemo(() => new Date().toISOString(), []);
  const { data } = useReadings(terrainId, { from, to, limit: 10000 });
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const dailyCarbon = useMemo(() => {
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
    let cumulative = 0;
    return Array.from(byDay.entries()).map(([day, { min, max }]) => {
      const kwh = Math.max(0, max - min);
      const co2 = kwh * prefs.co2Factor;
      cumulative += co2;
      return { day, co2: Number(co2.toFixed(2)), cumulative: Number(cumulative.toFixed(2)) };
    });
  }, [readings, prefs.co2Factor]);

  if (!dailyCarbon.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Leaf className="w-4 h-4 text-green-600" />
          Empreinte carbone
          <span className="text-xs font-normal text-muted-foreground">({prefs.co2Factor} kgCO₂/kWh)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={dailyCarbon}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit=" kg" />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v.toFixed(2) + ' kg', name === 'cumulative' ? 'CO₂ cumulé' : 'CO₂ journalier']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="cumulative" stroke="#16a34a" fill="#16a34a" fillOpacity={0.15} strokeWidth={2} name="CO₂ cumulé" />
            <Area type="monotone" dataKey="co2" stroke="#86efac" fill="#86efac" fillOpacity={0.3} strokeWidth={1} name="CO₂ journalier" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Alarm Widget */
function AlarmWidget({ terrainId }: { terrainId: string }) {
  const { data: overviewData } = useTerrainOverview(terrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { alarmsByDay, todayAlarms, allAlarms } = useMemo(() => {
    const alarms: Array<{ point: string; type: string; time: string; severity: 'warning' | 'critical'; day: string }> = [];

    for (const p of points) {
      const r = p.readings;
      if (!r) continue;
      const time = r.time ? String(r.time) : new Date().toISOString();
      const day = new Date(time).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

      const alarmState = r.alarm_state != null ? Number(r.alarm_state) : 0;
      if (alarmState > 0) {
        const types: Array<{ type: string; severity: 'warning' | 'critical' }> = [];
        if (alarmState & 1) types.push({ type: 'Surtension', severity: 'critical' });
        if (alarmState & 2) types.push({ type: 'Sous-tension', severity: 'critical' });
        if (alarmState & 4) types.push({ type: 'Surintensité', severity: 'critical' });
        if (alarmState & 8) types.push({ type: 'Perte de phase', severity: 'critical' });
        if (alarmState & 16) types.push({ type: 'THD élevé', severity: 'warning' });
        if (alarmState & 32) types.push({ type: 'PF faible', severity: 'warning' });
        if (types.length === 0) types.push({ type: `Alarme code ${alarmState}`, severity: 'warning' });
        for (const t of types) alarms.push({ point: String(p.name), time, day, ...t });
      }

      // Quality-based warnings
      const pf = r.power_factor_total != null ? Number(r.power_factor_total) : null;
      if (pf != null && pf < 0.85 && pf > 0) {
        alarms.push({ point: String(p.name), type: `PF faible (${pf.toFixed(2)})`, time, day, severity: 'warning' });
      }
      const thd = r.thdi_a != null ? Number(r.thdi_a) : null;
      if (thd != null && thd > 8) {
        alarms.push({ point: String(p.name), type: `THD élevé (${thd.toFixed(1)}%)`, time, day, severity: thd > 20 ? 'critical' : 'warning' });
      }
    }

    const byDay = new Map<string, number>();
    for (const a of alarms) byDay.set(a.day, (byDay.get(a.day) ?? 0) + 1);

    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return {
      alarmsByDay: Array.from(byDay.entries()).map(([day, count]) => ({ day, count })),
      todayAlarms: alarms.filter(a => a.day === today),
      allAlarms: alarms,
    };
  }, [points]);

  const displayAlarms = selectedDay ? allAlarms.filter(a => a.day === selectedDay) : todayAlarms;
  const displayLabel = selectedDay ?? new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Bell className="w-4 h-4 text-red-500" />
          Alarmes
          {todayAlarms.length > 0 && <Badge className="bg-red-500 text-white text-[10px]">{todayAlarms.length} aujourd'hui</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <div className="w-36 shrink-0 border-r pr-3 space-y-1 max-h-64 overflow-y-auto">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Par jour</div>
            {alarmsByDay.length === 0 && <div className="text-xs text-muted-foreground">Aucune alarme</div>}
            {alarmsByDay.map(({ day, count }) => (
              <button
                key={day}
                onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${day === selectedDay ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}
              >
                <span>{day}</span>
                <Badge variant={day === selectedDay ? 'default' : 'outline'} className="text-[10px] h-5">{count}</Badge>
              </button>
            ))}
          </div>
          <div className="flex-1 max-h-64 overflow-y-auto space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground mb-2">Alarmes du {displayLabel}</div>
            {displayAlarms.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">Aucune alarme</div>}
            {displayAlarms.map((a, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded text-sm border ${a.severity === 'critical' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'}`}>
                <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.point}</div>
                  <div className="text-xs text-muted-foreground">{a.type}</div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(a.time).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Alarm Configuration Panel */
function AlarmConfigPanel({ terrainId }: { terrainId: string }) {
  const [rules, setRules] = useState<Array<{ id: number; condition: string; element: string; value: string; active: boolean }>>(() => {
    try { const s = localStorage.getItem('simes_alarm_rules'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [newCondition, setNewCondition] = useState('>');
  const [newElement, setNewElement] = useState('');
  const [newValue, setNewValue] = useState('');

  // Device status thresholds (shared with SiteMapWidget via simes-map-config)
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
    'current_a', 'current_b', 'current_c', 'power_factor_total', 'energy_import', 'frequency', 'thdi_a'];

  const saveRules = (updated: typeof rules) => { setRules(updated); localStorage.setItem('simes_alarm_rules', JSON.stringify(updated)); };
  const addRule = () => { if (!newElement || !newValue) return; saveRules([...rules, { id: Date.now(), condition: newCondition, element: newElement, value: newValue, active: true }]); setNewElement(''); setNewValue(''); };
  const toggleRule = (id: number) => saveRules(rules.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const deleteRule = (id: number) => saveRules(rules.filter(r => r.id !== id));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          Configuration des alarmes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device status thresholds */}
        <div className="p-3 border rounded-lg bg-muted/30 space-y-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">Statut des appareils (dernière donnée reçue)</div>
          <div className="flex items-center gap-3 text-xs">
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
        {/* Parameter-based alarm rules */}
        <div className="flex flex-wrap items-end gap-2 p-3 border rounded-lg bg-muted/30">
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
            <label className="text-[10px] font-medium text-muted-foreground">Paramètre</label>
            <Select value={newElement} onValueChange={setNewElement}>
              <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Choisir..." /></SelectTrigger>
              <SelectContent>
                {parameters.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground">Valeur seuil</label>
            <input type="number" step="any" value={newValue} onChange={e => setNewValue(e.target.value)} className="h-8 w-24 rounded border px-2 text-xs bg-background" placeholder="ex: 0.7" />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={addRule} disabled={!newElement || !newValue}>+ Ajouter</Button>
        </div>
        {rules.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">Aucune règle configurée</div>}
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {rules.map(rule => (
            <div key={rule.id} className={`flex items-center gap-3 px-3 py-2 rounded border text-sm ${rule.active ? '' : 'opacity-50'}`}>
              <button onClick={() => toggleRule(rule.id)} className={`w-4 h-4 rounded-sm border ${rule.active ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                {rule.active && <span className="text-primary-foreground text-[10px] flex items-center justify-center">✓</span>}
              </button>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{rule.element.replace(/_/g, ' ')} {rule.condition} {rule.value}</code>
              <span className="flex-1" />
              <button onClick={() => deleteRule(rule.id)} className="text-xs text-destructive hover:underline">Supprimer</button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* PointsMapWidget is now <SiteMapWidget> from @/components/widgets/SiteMapWidget */

export default function Dashboard() {
  const { selectedTerrain, selectedSite, selectedTerrainId, aggregatedView } = useAppContext();
  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | '7d' | '30d' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { from, to } = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'today': return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), to: now.toISOString() };
      case 'yesterday': { const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); return { from: yd.toISOString(), to: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }; }
      case '7d': return { from: new Date(now.getTime() - 7 * 86400_000).toISOString(), to: now.toISOString() };
      case '30d': return { from: new Date(now.getTime() - 30 * 86400_000).toISOString(), to: now.toISOString() };
      case 'custom': return { from: customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 86400_000).toISOString(), to: customTo ? new Date(customTo).toISOString() : now.toISOString() };
    }
  }, [datePreset, customFrom, customTo]);

  const title = aggregatedView
    ? 'Site: ' + (selectedSite?.name ?? 'Site')
    : selectedTerrain?.name ?? 'Tableau de bord';
  const description = aggregatedView
    ? 'Vue agrégée sur ' + (selectedSite?.terrainsCount ?? 0) + ' terrain(s)'
    : 'Monitoring temps réel — ' + (selectedTerrain?.pointsCount ?? 0) + ' points';

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[
          { label: 'Accueil', href: '/' },
          { label: 'Tableau de bord' },
        ]}
      />

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain dans la barre supérieure pour voir les données.
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && (
        <>
          <LiveKPIs terrainId={selectedTerrainId} />

          {/* Date range */}
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground mr-1">Période :</span>
              {([{ key: 'today' as const, label: "Aujourd'hui" }, { key: 'yesterday' as const, label: 'Hier' }, { key: '7d' as const, label: '7 jours' }, { key: '30d' as const, label: '30 jours' }, { key: 'custom' as const, label: 'Personnalisé' }]).map(p => (
                <Button key={p.key} size="sm" variant={datePreset === p.key ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setDatePreset(p.key)}>{p.label}</Button>
              ))}
              {datePreset === 'custom' && (
                <div className="flex items-center gap-2 ml-2">
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-7 rounded border px-2 text-xs bg-background" />
                  <span className="text-xs text-muted-foreground">→</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-7 rounded border px-2 text-xs bg-background" />
                </div>
              )}
            </CardContent>
          </Card>

          <UnifiedLoadCurve terrainId={selectedTerrainId} from={from} to={to} />

          <SiteMapWidget terrainId={selectedTerrainId} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AlarmWidget terrainId={selectedTerrainId} />
            <AlarmConfigPanel terrainId={selectedTerrainId} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DailyCostWidget terrainId={selectedTerrainId} />
            <CarbonWidget terrainId={selectedTerrainId} />
          </div>

          <PowerPeaksTable terrainId={selectedTerrainId} from={from} to={to} />

          <WidgetBoard />

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary" />
              Détail par point ({(selectedTerrain?.pointsCount ?? 0)} points)
            </h3>
            <Link to="/points">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Voir la page complète
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}