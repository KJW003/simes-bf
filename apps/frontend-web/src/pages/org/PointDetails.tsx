import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Activity, Zap, Gauge, Thermometer, ArrowLeft, Download, Loader2,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtDT = (t: string) => new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function PointDetails() {
  const { pointId } = useParams<{ pointId: string }>();
  const { selectedTerrainId } = useAppContext();
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState<'1D' | '7D' | '1M'>('1D');

  const now = useMemo(() => new Date(), []);
  const rangeMs = range === '1D' ? 86400_000 : range === '7D' ? 7 * 86400_000 : 30 * 86400_000;
  const from = useMemo(() => new Date(now.getTime() - rangeMs).toISOString(), [now, rangeMs]);

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(selectedTerrainId);
  const { data: readingsData, isLoading: loadR } = useReadings(selectedTerrainId, {
    from, to: now.toISOString(), point_id: pointId, limit: 5000,
  });

  const points = (overviewData?.points ?? []) as Array<Record<string, unknown>>;
  const point = points.find(p => String(p.id) === pointId) as Record<string, unknown> | undefined;
  const readings = (readingsData?.readings ?? []) as Array<Record<string, unknown>>;
  const latest = point ? (point as any).readings as Record<string, unknown> | undefined : undefined;
  const isLoading = loadOv || loadR;

  // ─── Time-series for charts
  const timeSeries = useMemo(() =>
    readings.map(r => ({
      time: fmtDT(String(r.time)),
      p_total: r.active_power_total != null ? Number(r.active_power_total) : null,
      v_a: r.voltage_a != null ? Number(r.voltage_a) : null,
      v_b: r.voltage_b != null ? Number(r.voltage_b) : null,
      v_c: r.voltage_c != null ? Number(r.voltage_c) : null,
      i_a: r.current_a != null ? Number(r.current_a) : null,
      i_b: r.current_b != null ? Number(r.current_b) : null,
      i_c: r.current_c != null ? Number(r.current_c) : null,
      pf: r.power_factor_total != null ? Number(r.power_factor_total) : null,
      thdi_a: r.thdi_a != null ? Number(r.thdi_a) : null,
      thdi_b: r.thdi_b != null ? Number(r.thdi_b) : null,
      thdi_c: r.thdi_c != null ? Number(r.thdi_c) : null,
    })).reverse(),
    [readings],
  );

  // ─── Quality diagnostics from latest reading
  const diags = useMemo(() => {
    if (!latest) return [];
    const list: Array<{ label: string; status: 'ok' | 'warning' | 'critical'; detail: string }> = [];

    const pf = latest.power_factor_total != null ? Number(latest.power_factor_total) : null;
    if (pf != null) list.push({ label: 'Facteur de puissance', status: pf < 0.85 ? 'warning' : 'ok', detail: `PF = ${pf.toFixed(3)}` });

    const thd = latest.thdi_a != null ? Number(latest.thdi_a) : null;
    if (thd != null) list.push({ label: 'THD courant A', status: thd > 8 ? 'critical' : thd > 5 ? 'warning' : 'ok', detail: `${thd.toFixed(1)}%` });

    const vUnbal = latest.voltage_unbalance != null ? Number(latest.voltage_unbalance) : null;
    if (vUnbal != null) list.push({ label: 'Déséquilibre tension', status: vUnbal > 2 ? 'warning' : 'ok', detail: `${vUnbal.toFixed(1)}%` });

    const alarm = latest.alarm_state != null ? Number(latest.alarm_state) : null;
    if (alarm != null) list.push({ label: 'Alarme', status: alarm > 0 ? 'critical' : 'ok', detail: alarm > 0 ? `Code ${alarm}` : 'Aucune' });

    return list;
  }, [latest]);

  // ─── CSV export
  const exportCsv = () => {
    if (!readings.length) return;
    const cols = Object.keys(readings[0]);
    const csv = [cols.join(','), ...readings.map(r => cols.map(c => r[c] ?? '').join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `point_${pointId?.slice(0, 8)}_${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Point de mesure" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Point de mesure" description="Chargement…" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  const pointName = point ? String(point.name) : `Point ${pointId?.slice(0, 8)}`;
  const zoneName = point ? String((point as any).zone_name ?? '') : '';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pointName}
        description={zoneName ? `Zone: ${zoneName}` : `Détail du point ${pointId?.slice(0, 8)}`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/data-monitor"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Retour</Button></Link>
            <div className="flex gap-1">
              {(['1D', '7D', '1M'] as const).map(r => (
                <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>{r}</Button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" />CSV</Button>
          </div>
        }
      />

      {/* KPI row from latest reading */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Puissance active" value={fmt(latest?.active_power_total) + ' W'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="Courant A" value={fmt(latest?.current_a, 1) + ' A'} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Tension A" value={fmt(latest?.voltage_a, 1) + ' V'} icon={<Thermometer className="w-4 h-4" />} />
        <KpiCard label="PF total" value={fmt(latest?.power_factor_total, 3)} icon={<Gauge className="w-4 h-4" />}
          variant={latest?.power_factor_total != null && Number(latest.power_factor_total) < 0.85 ? 'warning' : 'default'} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="voltage">Tensions</TabsTrigger>
          <TabsTrigger value="current">Courants</TabsTrigger>
          <TabsTrigger value="quality">Qualité</TabsTrigger>
          <TabsTrigger value="raw">Données brutes</TabsTrigger>
        </TabsList>

        {/* Overview: load curve */}
        <TabsContent value="overview">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Courbe de charge — Puissance active</CardTitle></CardHeader>
            <CardContent>
              {timeSeries.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Aucune donnée pour cette période</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" W" />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="p_total" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name="P totale (W)" />
                    <Line type="monotone" dataKey="pf" stroke="#f59e0b" dot={false} strokeWidth={1} name="PF" yAxisId="right" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Voltage per phase */}
        <TabsContent value="voltage">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tensions par phase</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" V" />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="v_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Phase A" />
                  <Line type="monotone" dataKey="v_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Phase B" />
                  <Line type="monotone" dataKey="v_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Phase C" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Current per phase */}
        <TabsContent value="current">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Courants par phase</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" A" />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="i_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Phase A" />
                  <Line type="monotone" dataKey="i_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Phase B" />
                  <Line type="monotone" dataKey="i_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Phase C" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quality diagnostics */}
        <TabsContent value="quality">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Diagnostics qualité</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {diags.length === 0 && <div className="text-sm text-muted-foreground">Aucune donnée qualité</div>}
                {diags.map(d => (
                  <div key={d.label} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      {d.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        : d.status === 'warning' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        : <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                      <span>{d.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{d.detail}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">THDi par phase</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="thdi_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="THDi A" />
                    <Line type="monotone" dataKey="thdi_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="THDi B" />
                    <Line type="monotone" dataKey="thdi_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="THDi C" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Raw data table */}
        <TabsContent value="raw">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Données brutes ({readings.length} lignes)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {readings.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Aucune donnée</div>
              ) : (
                <table className="data-table text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Heure</th><th>P (W)</th><th>Q (var)</th><th>S (VA)</th>
                      <th>V_a</th><th>V_b</th><th>V_c</th>
                      <th>I_a</th><th>I_b</th><th>I_c</th>
                      <th>PF</th><th>Énergie imp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 100).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{fmtDT(String(r.time))}</td>
                        <td className="mono">{fmt(r.active_power_total, 0)}</td>
                        <td className="mono">{fmt(r.reactive_power_total, 0)}</td>
                        <td className="mono">{fmt(r.apparent_power_total, 0)}</td>
                        <td className="mono">{fmt(r.voltage_a, 1)}</td>
                        <td className="mono">{fmt(r.voltage_b, 1)}</td>
                        <td className="mono">{fmt(r.voltage_c, 1)}</td>
                        <td className="mono">{fmt(r.current_a, 2)}</td>
                        <td className="mono">{fmt(r.current_b, 2)}</td>
                        <td className="mono">{fmt(r.current_c, 2)}</td>
                        <td className="mono">{fmt(r.power_factor_total, 3)}</td>
                        <td className="mono">{fmt(r.energy_import, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {readings.length > 100 && <p className="text-xs text-muted-foreground mt-2">Affichage limité à 100 lignes sur {readings.length}. Utilisez l'export CSV.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}