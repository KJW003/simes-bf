import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Gauge, AlertTriangle, CheckCircle2, Loader2, Activity, Info,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const PF_THRESHOLD = 0.85;
const THD_WARNING = 5;
const THD_CRITICAL = 8;

const PERIOD_OPTIONS = [
  { value: '6h', label: '6 heures', ms: 6 * 3600_000 },
  { value: '12h', label: '12 heures', ms: 12 * 3600_000 },
  { value: '24h', label: '24 heures', ms: 24 * 3600_000 },
  { value: '7d', label: '7 jours', ms: 7 * 86400_000 },
  { value: '30d', label: '30 jours', ms: 30 * 86400_000 },
];

export default function PowerQuality() {
  const { selectedTerrainId } = useAppContext();
  const [tab, setTab] = useState('pf');
  const [selectedPoint, setSelectedPoint] = useState<string>('_all');
  const [period, setPeriod] = useState('24h');

  const now = useMemo(() => new Date(), []);
  const periodMs = PERIOD_OPTIONS.find(p => p.value === period)?.ms ?? 24 * 3600_000;
  const fromDate = useMemo(() => new Date(now.getTime() - periodMs).toISOString(), [now, periodMs]);

  const { data: overviewData, isLoading: loadingOv } = useTerrainOverview(selectedTerrainId);
  const { data: readingsData, isLoading: loadingR } = useReadings(selectedTerrainId, {
    from: fromDate, to: now.toISOString(),
    point_id: selectedPoint === '_all' ? undefined : selectedPoint,
    cols: 'power_factor_total,power_factor_a,power_factor_b,power_factor_c,thdi_a,thdi_b,thdi_c,thdu_a,thdu_b,thdu_c,voltage_unbalance,current_unbalance',
  });

  const points = (overviewData?.points ?? []) as Array<Record<string, unknown>>;
  const readings = (readingsData?.readings ?? []) as Array<Record<string, unknown>>;
  const selectedPointName = selectedPoint === '_all' ? 'Tous les points' : String(points.find(p => String(p.id) === selectedPoint)?.name ?? selectedPoint);
  const isLoading = loadingOv || loadingR;

  // ─── Per-point latest PF / THD
  const pointStats = useMemo(() => {
    return points.map(p => {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      return {
        id: String(p.id),
        name: String(p.name),
        zone: String((p as any).zone_id ?? '').slice(0, 8) || '—',
        pf: r?.power_factor_total != null ? Number(r.power_factor_total) : null,
        thd_a: r?.thdi_a != null ? Number(r.thdi_a) : null,
        thd_b: r?.thdi_b != null ? Number(r.thdi_b) : null,
        thd_c: r?.thdi_c != null ? Number(r.thdi_c) : null,
        thdu_a: r?.thdu_a != null ? Number(r.thdu_a) : null,
        v_unbal: r?.voltage_unbalance != null ? Number(r.voltage_unbalance) : null,
        i_unbal: r?.current_unbalance != null ? Number(r.current_unbalance) : null,
      };
    });
  }, [points]);

  // ─── KPIs
  const pfValues = pointStats.map(p => p.pf).filter((v): v is number => v != null);
  const thdMaxValues = pointStats.flatMap(p => [p.thd_a, p.thd_b, p.thd_c]).filter((v): v is number => v != null);
  const vUnbalValues = pointStats.map(p => p.v_unbal).filter((v): v is number => v != null);
  const pfAvg = pfValues.length ? pfValues.reduce((s, v) => s + v, 0) / pfValues.length : 0;
  const thdMax = thdMaxValues.length ? Math.max(...thdMaxValues) : 0;
  const vUnbalMax = vUnbalValues.length ? Math.max(...vUnbalValues) : 0;
  const pfBelowCount = pfValues.filter(v => v < PF_THRESHOLD).length;

  // ─── Hourly PF trend from readings
  const pfHourly = useMemo(() => {
    const byHour = new Map<number, number[]>();
    for (const r of readings) {
      const h = new Date(String(r.time)).getHours();
      const v = r.power_factor_total != null ? Number(r.power_factor_total) : NaN;
      if (isNaN(v)) continue;
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h)!.push(v);
    }
    return Array.from({ length: 24 }, (_, h) => {
      const vals = byHour.get(h) ?? [];
      return { hour: `${h}h`, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null };
    }).filter(d => d.avg !== null);
  }, [readings]);

  // ─── Hourly THD per phase trend
  const thdHourly = useMemo(() => {
    const byHour = new Map<number, { a: number[]; b: number[]; c: number[] }>();
    for (const r of readings) {
      const h = new Date(String(r.time)).getHours();
      if (!byHour.has(h)) byHour.set(h, { a: [], b: [], c: [] });
      const entry = byHour.get(h)!;
      if (r.thdi_a != null) entry.a.push(Number(r.thdi_a));
      if (r.thdi_b != null) entry.b.push(Number(r.thdi_b));
      if (r.thdi_c != null) entry.c.push(Number(r.thdi_c));
    }
    return Array.from({ length: 24 }, (_, h) => {
      const e = byHour.get(h);
      const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
      return { hour: `${h}h`, phase_a: e ? avg(e.a) : null, phase_b: e ? avg(e.b) : null, phase_c: e ? avg(e.c) : null };
    }).filter(d => d.phase_a !== null || d.phase_b !== null || d.phase_c !== null);
  }, [readings]);

  // ─── Worst PF points
  const worstPf = useMemo(() =>
    [...pointStats].filter(p => p.pf != null).sort((a, b) => (a.pf ?? 1) - (b.pf ?? 1)).slice(0, 5),
    [pointStats],
  );

  // ─── Worst THD points
  const worstThd = useMemo(() => {
    const items: Array<{ name: string; phase: string; value: number }> = [];
    for (const p of pointStats) {
      if (p.thd_a != null) items.push({ name: p.name, phase: 'A', value: p.thd_a });
      if (p.thd_b != null) items.push({ name: p.name, phase: 'B', value: p.thd_b });
      if (p.thd_c != null) items.push({ name: p.name, phase: 'C', value: p.thd_c });
    }
    return items.sort((a, b) => b.value - a.value).slice(0, 6);
  }, [pointStats]);

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Qualité réseau" description="Qualité de l'énergie électrique" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain.</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Qualité réseau" description="Qualité de l'énergie électrique" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Qualité réseau" description={`Qualité de l'énergie électrique — ${PERIOD_OPTIONS.find(p => p.value === period)?.label ?? '24 heures'} — ${selectedPointName}`} />

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Point de mesure :</span>
        <Select value={selectedPoint} onValueChange={setSelectedPoint}>
          <SelectTrigger className="w-64 h-8 text-xs">
            <SelectValue placeholder="Tous les points" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tous les points</SelectItem>
            {points.map(p => <SelectItem key={String(p.id)} value={String(p.id)}>{String(p.name)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-2">Période :</span>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Info Banner */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">État actuel</p>
            <p>Cette page affiche les mesures électriques en temps réel. Pour analyser les anomalies historiques et obtenir des recommandations détaillées, consultez la page <span className="font-semibold">Anomalies IA</span>.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard
          label="PF moyen 24h"
          value={fmt(pfAvg)}
          icon={<Gauge className="w-4 h-4" />}
          variant={pfAvg < PF_THRESHOLD ? 'warning' : 'success'}
        />
        <KpiCard
          label="THD max 24h"
          value={fmt(thdMax, 1) + '%'}
          icon={<Activity className="w-4 h-4" />}
          variant={thdMax > THD_CRITICAL ? 'critical' : thdMax > THD_WARNING ? 'warning' : 'default'}
        />
        <KpiCard
          label="Déséquilibre V max"
          value={fmt(vUnbalMax, 1) + '%'}
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={vUnbalMax > 3 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Points PF critique"
          value={pfBelowCount}
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={pfBelowCount > 0 ? 'warning' : 'success'}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pf">Facteur de puissance</TabsTrigger>
          <TabsTrigger value="thd">THD & Harmoniques</TabsTrigger>
          <TabsTrigger value="unbalance">Déséquilibre</TabsTrigger>
        </TabsList>

        {/* PF Tab */}
        <TabsContent value="pf" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base">PF moyen par heure (24h) — {selectedPointName}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={pfHourly}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v?.toFixed(3) ?? '—', 'PF']} />
                    <ReferenceLine y={PF_THRESHOLD} stroke="hsl(var(--destructive))" strokeDasharray="5 3" label={{ value: `Seuil ${PF_THRESHOLD}`, fontSize: 10, fill: 'hsl(var(--destructive))' }} />
                    <Bar dataKey="avg" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Points les plus faibles</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {worstPf.length === 0 && <div className="text-sm text-muted-foreground">Aucune donnée PF</div>}
                {worstPf.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      {p.pf != null && p.pf < PF_THRESHOLD
                        ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                      <span className="truncate max-w-[120px]">{p.name}</span>
                    </div>
                    <Badge variant="outline" className={cn('text-[10px]', p.pf != null && p.pf < PF_THRESHOLD ? 'badge-warning' : 'badge-ok')}>
                      {fmt(p.pf, 3)}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* THD Tab */}
        <TabsContent value="thd" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">THDi par phase — tendance 24h — {selectedPointName}</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={thdHourly}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v?.toFixed(1) ?? '—', '%']} />
                  <ReferenceLine y={THD_CRITICAL} stroke="hsl(var(--destructive))" strokeDasharray="5 3" label={{ value: `${THD_CRITICAL}%`, fontSize: 10, fill: 'hsl(var(--destructive))' }} />
                  <Legend />
                  <Line type="monotone" dataKey="phase_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Phase A" />
                  <Line type="monotone" dataKey="phase_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Phase B" />
                  <Line type="monotone" dataKey="phase_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Phase C" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Points avec THD élevé</CardTitle></CardHeader>
            <CardContent>
              {worstThd.length === 0 ? (
                <div className="text-sm text-muted-foreground">Aucune donnée THD</div>
              ) : (
                <div className="table-responsive">
                <table className="data-table">
                  <thead><tr className="bg-muted/50"><th>Point</th><th>Phase</th><th>THDi %</th><th>Sévérité</th></tr></thead>
                  <tbody>
                    {worstThd.map((item, i) => (
                      <tr key={i}>
                        <td className="text-sm font-medium">{item.name}</td>
                        <td className="text-sm">{item.phase}</td>
                        <td className="mono text-sm">{item.value.toFixed(1)}%</td>
                        <td>
                          <Badge variant="outline" className={cn('text-[10px]',
                            item.value >= THD_CRITICAL ? 'badge-critical' : item.value >= THD_WARNING ? 'badge-warning' : 'badge-ok',
                          )}>
                            {item.value >= THD_CRITICAL ? 'Critique' : item.value >= THD_WARNING ? 'Attention' : 'OK'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unbalance Tab */}
        <TabsContent value="unbalance" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Déséquilibre courant et tension par point</CardTitle></CardHeader>
            <CardContent>
              {pointStats.length === 0 ? (
                <div className="text-sm text-muted-foreground">Aucune donnée</div>
              ) : (
                <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Point</th>
                      <th>Déséquilibre tension</th>
                      <th>Déséquilibre courant</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pointStats.filter(p => p.v_unbal != null || p.i_unbal != null).map(p => {
                      const vStatus = p.v_unbal != null && p.v_unbal > 2 ? 'warning' : 'ok';
                      const iStatus = p.i_unbal != null && p.i_unbal > 10 ? 'warning' : 'ok';
                      const overallStatus = vStatus === 'warning' || iStatus === 'warning' ? 'warning' : 'ok';
                      return (
                        <tr key={p.id}>
                          <td className="font-medium text-sm">{p.name}</td>
                          <td>
                            <span className={cn('mono text-sm', vStatus === 'warning' && 'text-amber-600 font-semibold')}>
                              {p.v_unbal != null ? p.v_unbal.toFixed(1) + '%' : '—'}
                            </span>
                          </td>
                          <td>
                            <span className={cn('mono text-sm', iStatus === 'warning' && 'text-amber-600 font-semibold')}>
                              {p.i_unbal != null ? p.i_unbal.toFixed(1) + '%' : '—'}
                            </span>
                          </td>
                          <td>
                            <Badge variant="outline" className={cn('text-[10px]', overallStatus === 'warning' ? 'badge-warning' : 'badge-ok')}>
                              {overallStatus === 'warning' ? 'Attention' : 'OK'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}