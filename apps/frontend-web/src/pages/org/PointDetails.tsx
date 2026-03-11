import React, { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import api from '@/lib/api';
import {
  Activity, Zap, Thermometer, ArrowLeft, Download, Loader2,
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Brush,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtDT = (t: string) => new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (v: unknown) => v != null && v !== '' ? Number(v) : null;

/** Auto-fit Y domain with 2 % padding so curves aren't squashed against axis edges. */
const autoFitDomain: [(v: number) => number, (v: number) => number] = [
  (min: number) => { const pad = Math.max(Math.abs(min) * 0.02, 0.5); return Math.floor((min - pad) * 100) / 100; },
  (max: number) => { const pad = Math.max(Math.abs(max) * 0.02, 0.5); return Math.ceil((max + pad) * 100) / 100; },
];

const PARAM_GROUPS = [
  { label: 'Puissances', keys: ['active_power_total', 'active_power_a', 'active_power_b', 'active_power_c', 'reactive_power_total', 'reactive_power_a', 'reactive_power_b', 'reactive_power_c', 'apparent_power_total', 'apparent_power_a', 'apparent_power_b', 'apparent_power_c'] },
  { label: 'Tensions simples', keys: ['voltage_a', 'voltage_b', 'voltage_c'] },
  { label: 'Tensions composées', keys: ['voltage_ab', 'voltage_bc', 'voltage_ca'] },
  { label: 'Courants', keys: ['current_a', 'current_b', 'current_c'] },
  { label: 'Facteur de puissance', keys: ['power_factor_total', 'power_factor_a', 'power_factor_b', 'power_factor_c'] },
  { label: 'THD courant', keys: ['thdi_a', 'thdi_b', 'thdi_c'] },
  { label: 'THD tension', keys: ['thdu_a', 'thdu_b', 'thdu_c'] },
  { label: 'Énergie', keys: ['energy_total'] },
  { label: 'Autres', keys: ['alarm_state', 'voltage_unbalance'] },
];

/** Expandable parameters panel replacing gauges */
function ExpandableParams({ latest }: { latest: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const availableGroups = useMemo(() =>
    PARAM_GROUPS.map(g => ({
      ...g,
      params: g.keys.filter(k => latest[k] != null && latest[k] !== '').map(k => ({ key: k, value: Number(latest[k]) })),
    })).filter(g => g.params.length > 0),
    [latest],
  );

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Tous les paramètres
          <Badge variant="outline" className="text-[10px] ml-1">{availableGroups.reduce((n, g) => n + g.params.length, 0)} disponibles</Badge>
          <span className="ml-auto">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {availableGroups.map(g => (
            <div key={g.label}>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">{g.label}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {g.params.map(p => (
                  <div key={p.key} className="p-2 border rounded text-center">
                    <div className="text-[10px] text-muted-foreground truncate">{p.key.replace(/_/g, ' ')}</div>
                    <div className="text-sm font-semibold mono">{p.value.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

/** Reusable interactive chart wrapper — clickable legend + Brush zoom */
const InteractiveLineChart = React.memo(function InteractiveLineChart({ data, lines, height = 300, unit = '' }: {
  data: Array<Record<string, any>>;
  lines: Array<{ dataKey: string; stroke: string; name: string; strokeWidth?: number; yAxisId?: string }>;
  height?: number;
  unit?: string;
}) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const handleLegendClick = useCallback((e: any) => {
    const key = e.dataKey ?? e.value;
    if (!key) return;
    setHiddenSeries(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }, []);

  if (!data.length) return <div className="text-sm text-muted-foreground py-8 text-center">Aucune donnée pour cette période</div>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} unit={unit ? ` ${unit}` : ''} domain={autoFitDomain} />
        {lines.some(l => l.yAxisId) && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 1]} />}
        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => v?.toFixed(2)} />
        <Legend
          wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
          onClick={handleLegendClick}
          formatter={(value: string, entry: any) => (
            <span style={{ color: hiddenSeries.has(entry.dataKey) ? '#9ca3af' : entry.color, textDecoration: hiddenSeries.has(entry.dataKey) ? 'line-through' : 'none' }}>{value}</span>
          )}
        />
        {lines.map(l => (
          <Line key={l.dataKey} type="monotone" dataKey={l.dataKey} stroke={l.stroke} dot={false}
            strokeWidth={l.strokeWidth ?? 1.5} name={l.name} yAxisId={l.yAxisId}
            hide={hiddenSeries.has(l.dataKey)} />
        ))}
        <Brush dataKey="time" height={20} stroke="hsl(var(--primary))" travellerWidth={8} />
      </LineChart>
    </ResponsiveContainer>
  );
});

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
    from, to: now.toISOString(), point_id: pointId,
    cols: 'active_power_total,active_power_a,active_power_b,active_power_c,reactive_power_total,reactive_power_a,reactive_power_b,reactive_power_c,apparent_power_total,apparent_power_a,apparent_power_b,apparent_power_c,voltage_a,voltage_b,voltage_c,voltage_ab,voltage_bc,voltage_ca,current_a,current_b,current_c,power_factor_total,power_factor_a,power_factor_b,power_factor_c,thdi_a,thdi_b,thdi_c,thdu_a,thdu_b,thdu_c,energy_total',
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
      energy_total: num(r.energy_total),

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
        <KpiCard label="Tension A" value={fmt(latest?.voltage_a) + ' V'} icon={<Thermometer className="w-4 h-4" />} />
        <KpiCard label="Courant A" value={fmt(latest?.current_a) + ' A'} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="PF total" value={fmt(latest?.power_factor_total)} icon={<Zap className="w-4 h-4" />}
          variant={latest?.power_factor_total != null && Number(latest.power_factor_total) < 0.85 ? 'warning' : 'default'} />
      </div>

      {/* Expandable parameters */}
      {latest && (
        <ExpandableParams latest={latest} />
      )}

      {/* Quality diagnostics */}
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
              <InteractiveLineChart data={timeSeries} unit="kW" lines={[
                { dataKey: 'p_total', stroke: 'hsl(var(--primary))', name: 'P totale (kW)', strokeWidth: 1.5 },
                { dataKey: 'pf', stroke: '#f59e0b', name: 'PF', strokeWidth: 1, yAxisId: 'right' },
              ]} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Puissances P / Q / S */}
        <TabsContent value="power">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance active (kW)</CardTitle></CardHeader>
              <CardContent>
                <InteractiveLineChart data={timeSeries} unit="kW" height={250} lines={[
                  { dataKey: 'p_total', stroke: 'hsl(var(--primary))', name: 'P total', strokeWidth: 1.5 },
                  { dataKey: 'p_a', stroke: '#ef4444', name: 'Pa', strokeWidth: 1 },
                  { dataKey: 'p_b', stroke: '#3b82f6', name: 'Pb', strokeWidth: 1 },
                  { dataKey: 'p_c', stroke: '#22c55e', name: 'Pc', strokeWidth: 1 },
                ]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance réactive (kvar)</CardTitle></CardHeader>
              <CardContent>
                <InteractiveLineChart data={timeSeries} unit="kvar" height={250} lines={[
                  { dataKey: 'q_total', stroke: '#8b5cf6', name: 'Q total', strokeWidth: 1.5 },
                  { dataKey: 'q_a', stroke: '#ef4444', name: 'Qa', strokeWidth: 1 },
                  { dataKey: 'q_b', stroke: '#3b82f6', name: 'Qb', strokeWidth: 1 },
                  { dataKey: 'q_c', stroke: '#22c55e', name: 'Qc', strokeWidth: 1 },
                ]} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base">Puissance apparente (kVA)</CardTitle></CardHeader>
              <CardContent>
                <InteractiveLineChart data={timeSeries} unit="kVA" height={250} lines={[
                  { dataKey: 's_total', stroke: '#f97316', name: 'S total', strokeWidth: 1.5 },
                  { dataKey: 's_a', stroke: '#ef4444', name: 'Sa', strokeWidth: 1 },
                  { dataKey: 's_b', stroke: '#3b82f6', name: 'Sb', strokeWidth: 1 },
                  { dataKey: 's_c', stroke: '#22c55e', name: 'Sc', strokeWidth: 1 },
                ]} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tensions simples */}
        <TabsContent value="voltage">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tensions simples (V)</CardTitle></CardHeader>
            <CardContent>
              <InteractiveLineChart data={timeSeries} unit="V" lines={[
                { dataKey: 'v_a', stroke: '#ef4444', name: 'Va (Phase A)' },
                { dataKey: 'v_b', stroke: '#3b82f6', name: 'Vb (Phase B)' },
                { dataKey: 'v_c', stroke: '#22c55e', name: 'Vc (Phase C)' },
              ]} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tensions composées */}
        <TabsContent value="voltage-ll">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Tensions composées (V)</CardTitle></CardHeader>
            <CardContent>
              <InteractiveLineChart data={timeSeries} unit="V" lines={[
                { dataKey: 'v_ab', stroke: '#ef4444', name: 'Vab' },
                { dataKey: 'v_bc', stroke: '#3b82f6', name: 'Vbc' },
                { dataKey: 'v_ca', stroke: '#22c55e', name: 'Vca' },
              ]} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Courants */}
        <TabsContent value="current">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Courants par phase (A)</CardTitle></CardHeader>
            <CardContent>
              <InteractiveLineChart data={timeSeries} unit="A" lines={[
                { dataKey: 'i_a', stroke: '#ef4444', name: 'Ia (Phase A)' },
                { dataKey: 'i_b', stroke: '#3b82f6', name: 'Ib (Phase B)' },
                { dataKey: 'i_c', stroke: '#22c55e', name: 'Ic (Phase C)' },
              ]} />
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
                <InteractiveLineChart data={timeSeries} unit="%" height={220} lines={[
                  { dataKey: 'thdi_a', stroke: '#ef4444', name: 'THDi A' },
                  { dataKey: 'thdi_b', stroke: '#3b82f6', name: 'THDi B' },
                  { dataKey: 'thdi_c', stroke: '#22c55e', name: 'THDi C' },
                ]} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* THD tension */}
        <TabsContent value="thdu">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">THD tension par phase (%)</CardTitle></CardHeader>
            <CardContent>
              <InteractiveLineChart data={timeSeries} unit="%" lines={[
                { dataKey: 'thdu_a', stroke: '#ef4444', name: 'THDu A' },
                { dataKey: 'thdu_b', stroke: '#3b82f6', name: 'THDu B' },
                { dataKey: 'thdu_c', stroke: '#22c55e', name: 'THDu C' },
              ]} />
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
                      <th>E tot.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{fmtDT(String(r.time))}</td>
                        <td className="mono">{fmt(r.active_power_total)}</td>
                        <td className="mono">{fmt(r.reactive_power_total)}</td>
                        <td className="mono">{fmt(r.apparent_power_total)}</td>
                        <td className="mono">{fmt(r.voltage_a)}</td>
                        <td className="mono">{fmt(r.voltage_b)}</td>
                        <td className="mono">{fmt(r.voltage_c)}</td>
                        <td className="mono">{fmt(r.voltage_ab)}</td>
                        <td className="mono">{fmt(r.voltage_bc)}</td>
                        <td className="mono">{fmt(r.voltage_ca)}</td>
                        <td className="mono">{fmt(r.current_a)}</td>
                        <td className="mono">{fmt(r.current_b)}</td>
                        <td className="mono">{fmt(r.current_c)}</td>
                        <td className="mono">{fmt(r.power_factor_total)}</td>
                        <td className="mono">{fmt(r.thdi_a)}</td>
                        <td className="mono">{fmt(r.thdi_b)}</td>
                        <td className="mono">{fmt(r.thdi_c)}</td>
                        <td className="mono">{fmt(r.thdu_a)}</td>
                        <td className="mono">{fmt(r.thdu_b)}</td>
                        <td className="mono">{fmt(r.thdu_c)}</td>
                        <td className="mono">{fmt(r.energy_total)}</td>
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