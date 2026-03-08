import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Zap, Activity, BatteryCharging, Clock, Radio, Loader2, Leaf, TrendingUp,
} from 'lucide-react';
import { useDashboard, useReadings, useTerrainOverview } from '@/hooks/useApi';
import { WidgetBoard } from '@/components/widgets/WidgetBoard';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const CO2_FACTOR = 0.71; // kgCO₂e per kWh – Burkina Faso grid

const CHART_COLORS = [
  'hsl(var(--primary))',
  '#f97316', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981',
  '#eab308', '#ef4444', '#6366f1', '#14b8a6', '#f59e0b',
];

function LiveKPIs({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useDashboard(terrainId);

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

  const co2Today = (data.energy_today.import_kwh * CO2_FACTOR);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Zap className="w-4 h-4 text-primary" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Puissance instantanée</div>
            <div className="text-lg font-semibold mono">{data.power_now_kw.toFixed(1)} <span className="text-xs font-normal">kW</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-import/10 p-2"><Activity className="w-4 h-4 text-energy-import" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Énergie import (aujourd'hui)</div>
            <div className="text-lg font-semibold mono">{data.energy_today.import_kwh.toFixed(1)} <span className="text-xs font-normal">kWh</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-green-500/10 p-2"><Leaf className="w-4 h-4 text-green-600" /></div>
          <div>
            <div className="text-xs text-muted-foreground">CO₂ (aujourd'hui)</div>
            <div className="text-lg font-semibold mono">{co2Today.toFixed(1)} <span className="text-xs font-normal">kg</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-pv/10 p-2"><BatteryCharging className="w-4 h-4 text-energy-pv" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Points actifs</div>
            <div className="text-lg font-semibold mono">{data.points_count}</div>
          </div>
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

/** Unified load curve showing active_power_total per point */
function UnifiedLoadCurve({ terrainId }: { terrainId: string }) {
  const from = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const to = useMemo(() => new Date().toISOString(), []);
  const { data: overviewData } = useTerrainOverview(terrainId);
  const { data, isLoading } = useReadings(terrainId, { from, to, limit: 5000 });

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, any>>;

  const { chartData, pointNames } = useMemo(() => {
    if (!readings.length || !points.length) return { chartData: [], pointNames: [] as string[] };

    const pointMap = new Map(points.map(p => [String(p.id), String(p.name)]));
    const pNames = [...new Set(readings.map(r => String(r.point_id)))].map(id => pointMap.get(id) ?? id);

    // Group readings by time bucket (5-min)
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

  if (isLoading) return <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  if (!chartData.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Courbe de charge unifiée — 24h
          <Badge variant="outline" className="text-[10px] ml-auto">{readings.length} mesures</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
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
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {pointNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Power peaks table showing max power per point */
function PowerPeaksTable({ terrainId }: { terrainId: string }) {
  const from = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const to = useMemo(() => new Date().toISOString(), []);
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

export default function Dashboard() {
  const { selectedTerrain, selectedSite, selectedTerrainId, aggregatedView } = useAppContext();

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
          {/* Enriched KPIs with CO₂ */}
          <LiveKPIs terrainId={selectedTerrainId} />

          {/* Unified load curve — all points on one chart */}
          <UnifiedLoadCurve terrainId={selectedTerrainId} />

          {/* Power peaks table */}
          <PowerPeaksTable terrainId={selectedTerrainId} />

          {/* Widget Board — full drag-drop, configure, resize management */}
          <WidgetBoard />

          {/* Toggle + Per-point detail tiles */}
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