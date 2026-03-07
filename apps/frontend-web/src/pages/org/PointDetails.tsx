import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import {
  Activity, Zap, Gauge, Thermometer, ArrowLeft, Download, Loader2,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtDT = (t: string) => new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (v: unknown) => v != null && v !== '' ? Number(v) : null;

/** Auto-fit Y domain with 2 % padding so curves aren't squashed against axis edges. */
const autoFitDomain: [(v: number) => number, (v: number) => number] = [
  (min: number) => { const pad = Math.max(Math.abs(min) * 0.02, 0.5); return Math.floor((min - pad) * 100) / 100; },
  (max: number) => { const pad = Math.max(Math.abs(max) * 0.02, 0.5); return Math.ceil((max + pad) * 100) / 100; },
];

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

  // ─── Time-series for charts (all available metrics)
  const timeSeries = useMemo(() =>
    readings.map(r => ({
      time: fmtDT(String(r.time)),
      // Puissances
      p_total: num(r.active_power_total),
      p_a: num(r.active_power_a), p_b: num(r.active_power_b), p_c: num(r.active_power_c),
      q_total: num(r.reactive_power_total),
      q_a: num(r.reactive_power_a), q_b: num(r.reactive_power_b), q_c: num(r.reactive_power_c),
      s_total: num(r.apparent_power_total),
      s_a: num(r.apparent_power_a), s_b: num(r.apparent_power_b), s_c: num(r.apparent_power_c),
      // Tensions simples
      v_a: num(r.voltage_a), v_b: num(r.voltage_b), v_c: num(r.voltage_c),
      // Tensions composées
      v_ab: num(r.voltage_ab), v_bc: num(r.voltage_bc), v_ca: num(r.voltage_ca),
      // Courants
      i_a: num(r.current_a), i_b: num(r.current_b), i_c: num(r.current_c),
      // PF
      pf: num(r.power_factor_total),
      pf_a: num(r.power_factor_a), pf_b: num(r.power_factor_b), pf_c: num(r.power_factor_c),
      // THD courant
      thdi_a: num(r.thdi_a), thdi_b: num(r.thdi_b), thdi_c: num(r.thdi_c),
      // THD tension
      thdu_a: num(r.thdu_a), thdu_b: num(r.thdu_b), thdu_c: num(r.thdu_c),
      // Énergie
      energy_import: num(r.energy_import), energy_export: num(r.energy_export),
      // Fréquence
      frequency: num(r.frequency),
    })).reverse(),
    [readings],
  );

  // ─── Quality diagnostics from latest reading
  const diags = useMemo(() => {
    if (!latest) return [];
    const list: Array<{ label: string; status: 'ok' | 'warning' | 'critical'; detail: string }> = [];

    const pf = num(latest.power_factor_total);
    if (pf != null) list.push({ label: 'Facteur de puissance', status: pf < 0.85 ? 'warning' : 'ok', detail: `PF = ${pf.toFixed(3)}` });

    const thd = num(latest.thdi_a);
    if (thd != null) list.push({ label: 'THD courant A', status: thd > 8 ? 'critical' : thd > 5 ? 'warning' : 'ok', detail: `${thd.toFixed(1)}%` });

    const vUnbal = num(latest.voltage_unbalance);
    if (vUnbal != null) list.push({ label: 'Déséquilibre tension', status: vUnbal > 2 ? 'warning' : 'ok', detail: `${vUnbal.toFixed(1)}%` });

    const alarm = num(latest.alarm_state);
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 animate-stagger-children">
        <KpiCard label="P active" value={fmt(latest?.active_power_total) + ' kW'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="Q réactive" value={fmt(latest?.reactive_power_total) + ' kvar'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="S apparente" value={fmt(latest?.apparent_power_total) + ' kVA'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="Tension A" value={fmt(latest?.voltage_a, 1) + ' V'} icon={<Thermometer className="w-4 h-4" />} />
        <KpiCard label="Courant A" value={fmt(latest?.current_a, 1) + ' A'} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="PF total" value={fmt(latest?.power_factor_total, 3)} icon={<Gauge className="w-4 h-4" />}
          variant={latest?.power_factor_total != null && Number(latest.power_factor_total) < 0.85 ? 'warning' : 'default'} />
        <KpiCard label="Fréquence" value={fmt(latest?.frequency, 2) + ' Hz'} icon={<Activity className="w-4 h-4" />} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="power">Puissances</TabsTrigger>
          <TabsTrigger value="voltage">Tensions simples</TabsTrigger>
          <TabsTrigger value="voltage-ll">Tensions composées</TabsTrigger>
          <TabsTrigger value="current">Courants</TabsTrigger>
          <TabsTrigger value="quality">Qualité</TabsTrigger>
          <TabsTrigger value="thdu">THD tension</TabsTrigger>
          <TabsTrigger value="raw">Données brutes</TabsTrigger>
        </TabsList>

        {/* Overview: load curve P + PF */}
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
                    <YAxis tick={{ fontSize: 10 }} unit=" kW" domain={autoFitDomain} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 1]} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="p_total" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name="P totale (kW)" />
                    <Line type="monotone" dataKey="pf" stroke="#f59e0b" dot={false} strokeWidth={1} name="PF" yAxisId="right" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Puissances P / Q / S */}
        <TabsContent value="power">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance active (kW)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" kW" domain={autoFitDomain} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="p_total" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} name="P total" />
                    <Line type="monotone" dataKey="p_a" stroke="#ef4444" dot={false} strokeWidth={1} name="Pa" />
                    <Line type="monotone" dataKey="p_b" stroke="#3b82f6" dot={false} strokeWidth={1} name="Pb" />
                    <Line type="monotone" dataKey="p_c" stroke="#22c55e" dot={false} strokeWidth={1} name="Pc" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance réactive (kvar)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" kvar" domain={autoFitDomain} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="q_total" stroke="#8b5cf6" dot={false} strokeWidth={1.5} name="Q total" />
                    <Line type="monotone" dataKey="q_a" stroke="#ef4444" dot={false} strokeWidth={1} name="Qa" />
                    <Line type="monotone" dataKey="q_b" stroke="#3b82f6" dot={false} strokeWidth={1} name="Qb" />
                    <Line type="monotone" dataKey="q_c" stroke="#22c55e" dot={false} strokeWidth={1} name="Qc" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance apparente (kVA)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" kVA" domain={autoFitDomain} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="s_total" stroke="#f97316" dot={false} strokeWidth={1.5} name="S total" />
                    <Line type="monotone" dataKey="s_a" stroke="#ef4444" dot={false} strokeWidth={1} name="Sa" />
                    <Line type="monotone" dataKey="s_b" stroke="#3b82f6" dot={false} strokeWidth={1} name="Sb" />
                    <Line type="monotone" dataKey="s_c" stroke="#22c55e" dot={false} strokeWidth={1} name="Sc" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tensions simples */}
        <TabsContent value="voltage">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tensions simples (V)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" V" domain={autoFitDomain} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Line type="monotone" dataKey="v_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Va (Phase A)" />
                  <Line type="monotone" dataKey="v_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Vb (Phase B)" />
                  <Line type="monotone" dataKey="v_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Vc (Phase C)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tensions composées */}
        <TabsContent value="voltage-ll">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tensions composées (V)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" V" domain={autoFitDomain} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Line type="monotone" dataKey="v_ab" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Vab" />
                  <Line type="monotone" dataKey="v_bc" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Vbc" />
                  <Line type="monotone" dataKey="v_ca" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Vca" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Courants */}
        <TabsContent value="current">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Courants par phase (A)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" A" domain={autoFitDomain} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Line type="monotone" dataKey="i_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="Ia (Phase A)" />
                  <Line type="monotone" dataKey="i_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="Ib (Phase B)" />
                  <Line type="monotone" dataKey="i_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Ic (Phase C)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quality diagnostics + THDi */}
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
              <CardHeader className="pb-2"><CardTitle className="text-base">THDi par phase (%)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" %" domain={autoFitDomain} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="thdi_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="THDi A" />
                    <Line type="monotone" dataKey="thdi_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="THDi B" />
                    <Line type="monotone" dataKey="thdi_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="THDi C" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* THD tension */}
        <TabsContent value="thdu">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">THD tension par phase (%)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" %" domain={autoFitDomain} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Line type="monotone" dataKey="thdu_a" stroke="#ef4444" dot={false} strokeWidth={1.5} name="THDu A" />
                  <Line type="monotone" dataKey="thdu_b" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="THDu B" />
                  <Line type="monotone" dataKey="thdu_c" stroke="#22c55e" dot={false} strokeWidth={1.5} name="THDu C" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Raw data table */}
        <TabsContent value="raw">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Données brutes ({readings.length} lignes)</CardTitle></CardHeader>
            <CardContent className="overflow-auto max-h-[70vh]">
              {readings.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Aucune donnée</div>
              ) : (
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>Heure</th>
                      <th>P (kW)</th><th>Q (kvar)</th><th>S (kVA)</th>
                      <th>Va</th><th>Vb</th><th>Vc</th>
                      <th>Vab</th><th>Vbc</th><th>Vca</th>
                      <th>Ia</th><th>Ib</th><th>Ic</th>
                      <th>PF</th>
                      <th>THDi A</th><th>THDi B</th><th>THDi C</th>
                      <th>THDu A</th><th>THDu B</th><th>THDu C</th>
                      <th>Freq</th>
                      <th>E imp.</th><th>E exp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{fmtDT(String(r.time))}</td>
                        <td className="mono">{fmt(r.active_power_total, 2)}</td>
                        <td className="mono">{fmt(r.reactive_power_total, 2)}</td>
                        <td className="mono">{fmt(r.apparent_power_total, 2)}</td>
                        <td className="mono">{fmt(r.voltage_a, 1)}</td>
                        <td className="mono">{fmt(r.voltage_b, 1)}</td>
                        <td className="mono">{fmt(r.voltage_c, 1)}</td>
                        <td className="mono">{fmt(r.voltage_ab, 1)}</td>
                        <td className="mono">{fmt(r.voltage_bc, 1)}</td>
                        <td className="mono">{fmt(r.voltage_ca, 1)}</td>
                        <td className="mono">{fmt(r.current_a, 2)}</td>
                        <td className="mono">{fmt(r.current_b, 2)}</td>
                        <td className="mono">{fmt(r.current_c, 2)}</td>
                        <td className="mono">{fmt(r.power_factor_total, 3)}</td>
                        <td className="mono">{fmt(r.thdi_a, 1)}</td>
                        <td className="mono">{fmt(r.thdi_b, 1)}</td>
                        <td className="mono">{fmt(r.thdi_c, 1)}</td>
                        <td className="mono">{fmt(r.thdu_a, 1)}</td>
                        <td className="mono">{fmt(r.thdu_b, 1)}</td>
                        <td className="mono">{fmt(r.thdu_c, 1)}</td>
                        <td className="mono">{fmt(r.frequency, 2)}</td>
                        <td className="mono">{fmt(r.energy_import, 1)}</td>
                        <td className="mono">{fmt(r.energy_export, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {readings.length > 200 && <p className="text-xs text-muted-foreground mt-2">Affichage limité à 200 lignes sur {readings.length}. Utilisez l'export CSV.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}