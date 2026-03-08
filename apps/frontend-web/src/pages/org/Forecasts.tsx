import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp, Loader2, Calendar, Activity, Zap, Target, BarChart3,
} from 'lucide-react';
import { useReadings, useTerrainOverview } from '@/hooks/useApi';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const CO2_FACTOR = 0.71;
const TARIFF_CFA_KWH = 97;

const FORECAST_HORIZONS = [
  { key: '1D', label: 'J+1', days: 1, historyDays: 7 },
  { key: '3D', label: 'J+3', days: 3, historyDays: 14 },
  { key: '7D', label: 'J+7', days: 7, historyDays: 30 },
] as const;

/** Simple moving-average forecast with confidence bands */
function computeForecast(
  readings: Array<Record<string, unknown>>,
  forecastDays: number,
) {
  if (!readings.length) return { history: [], forecast: [], dailyAvg: 0, trend: 0 };

  // Group readings into daily energy totals
  const dailyMap = new Map<string, { min: number; max: number; readings: number[] }>();
  for (const r of readings) {
    const day = new Date(String(r.time)).toLocaleDateString('fr-FR');
    const pw = r.active_power_total != null ? Number(r.active_power_total) : null;
    if (pw == null) continue;
    if (!dailyMap.has(day)) dailyMap.set(day, { min: Infinity, max: -Infinity, readings: [] });
    const entry = dailyMap.get(day)!;
    entry.readings.push(pw);
    entry.min = Math.min(entry.min, pw);
    entry.max = Math.max(entry.max, pw);
  }

  // Compute daily averages
  const days = Array.from(dailyMap.entries())
    .map(([day, v]) => ({
      day,
      avg: v.readings.reduce((s, x) => s + x, 0) / v.readings.length,
      max: v.max,
      count: v.readings.length,
    }))
    .sort((a, b) => {
      const [da, ma] = a.day.split('/').map(Number);
      const [db, mb] = b.day.split('/').map(Number);
      return (ma * 100 + da) - (mb * 100 + db);
    });

  if (days.length < 2) return { history: days, forecast: [], dailyAvg: 0, trend: 0 };

  // Compute rolling average (window 3) and linear trend
  const n = days.length;
  const avgPower = days.reduce((s, d) => s + d.avg, 0) / n;

  // Linear regression for trend
  const xMean = (n - 1) / 2;
  const yMean = avgPower;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (days[i].avg - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator !== 0 ? numerator / denominator : 0;

  // Standard deviation for confidence bands
  const stdDev = Math.sqrt(days.reduce((s, d) => s + (d.avg - avgPower) ** 2, 0) / n);

  // Generate forecast points
  const forecast: Array<{ day: string; predicted: number; upper: number; lower: number }> = [];
  const lastDate = new Date();
  for (let i = 1; i <= forecastDays; i++) {
    const futureDate = new Date(lastDate.getTime() + i * 86400_000);
    const dayLabel = futureDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const predicted = Math.max(0, yMean + slope * (n - 1 + i - xMean));
    const confidence = stdDev * 1.5 * Math.sqrt(1 + i / n);
    forecast.push({
      day: dayLabel,
      predicted: Math.round(predicted * 100) / 100,
      upper: Math.round((predicted + confidence) * 100) / 100,
      lower: Math.max(0, Math.round((predicted - confidence) * 100) / 100),
    });
  }

  return {
    history: days,
    forecast,
    dailyAvg: avgPower,
    trend: slope,
  };
}

/** Compute hourly profile (typical day) from readings */
function computeHourlyProfile(readings: Array<Record<string, unknown>>) {
  const hourlyMap = new Map<number, number[]>();
  for (const r of readings) {
    const h = new Date(String(r.time)).getHours();
    const pw = r.active_power_total != null ? Number(r.active_power_total) : null;
    if (pw == null) continue;
    if (!hourlyMap.has(h)) hourlyMap.set(h, []);
    hourlyMap.get(h)!.push(pw);
  }
  return Array.from({ length: 24 }, (_, h) => {
    const vals = hourlyMap.get(h) ?? [];
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    return { hour: `${h}h`, avg: Math.round(avg * 100) / 100, max: Math.round(max * 100) / 100 };
  });
}

export default function Forecasts() {
  const { selectedTerrainId } = useAppContext();
  const [horizon, setHorizon] = useState<string>('1D');
  const [selectedPoint, setSelectedPoint] = useState<string>('_all');

  const h = FORECAST_HORIZONS.find(f => f.key === horizon) ?? FORECAST_HORIZONS[0];
  const from = useMemo(() => new Date(Date.now() - h.historyDays * 86400_000).toISOString(), [h]);
  const to = useMemo(() => new Date().toISOString(), []);

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const { data, isLoading } = useReadings(selectedTerrainId, {
    from,
    to,
    point_id: selectedPoint === '_all' ? undefined : selectedPoint,
    limit: 10000,
  });

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, unknown>>;

  const { history, forecast, dailyAvg, trend } = useMemo(
    () => computeForecast(readings, h.days),
    [readings, h.days],
  );

  const hourlyProfile = useMemo(() => computeHourlyProfile(readings), [readings]);

  // Merge history + forecast for unified chart
  const combinedChart = useMemo(() => {
    const historyPoints = history.map(d => ({
      day: d.day,
      actual: d.avg,
      predicted: null as number | null,
      upper: null as number | null,
      lower: null as number | null,
    }));
    const forecastPoints = forecast.map(d => ({
      day: d.day,
      actual: null as number | null,
      predicted: d.predicted,
      upper: d.upper,
      lower: d.lower,
    }));
    // Bridge: last history → first forecast
    if (historyPoints.length && forecastPoints.length) {
      forecastPoints[0].actual = historyPoints[historyPoints.length - 1].actual;
    }
    return [...historyPoints, ...forecastPoints];
  }, [history, forecast]);

  // Forecast KPIs
  const forecastEnergy = forecast.reduce((s, d) => s + d.predicted * 24, 0);
  const forecastCost = forecastEnergy * TARIFF_CFA_KWH;
  const forecastCO2 = forecastEnergy * CO2_FACTOR;
  const trendPercent = dailyAvg > 0 ? (trend / dailyAvg) * 100 : 0;

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Prévisions" description="Prévisions de consommation" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain pour voir les prévisions.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prévisions"
        description="Prévision de consommation basée sur l'historique récent"
        actions={
          <Badge variant="outline" className="text-xs">
            <Activity className="w-3 h-3 mr-1" />
            Modèle: Moyenne mobile + régression linéaire
          </Badge>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Horizon</label>
          <div className="flex gap-1">
            {FORECAST_HORIZONS.map(f => (
              <Button key={f.key} variant={horizon === f.key ? 'default' : 'outline'} size="sm" onClick={() => setHorizon(f.key)}>
                {f.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Point de mesure</label>
          <Select value={selectedPoint} onValueChange={setSelectedPoint}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Tous les points" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Tous les points</SelectItem>
              {points.map(p => <SelectItem key={String(p.id)} value={String(p.id)}>{String(p.name)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Calcul des prévisions…</CardContent></Card>
      )}

      {!isLoading && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
            <KpiCard label="Puiss. moy. historique" value={fmt(dailyAvg, 1)} unit="kW" icon={<Zap className="w-4 h-4" />} />
            <KpiCard
              label="Tendance journalière"
              value={`${trendPercent >= 0 ? '+' : ''}${trendPercent.toFixed(1)}`}
              unit="%/j"
              icon={<TrendingUp className="w-4 h-4" />}
              variant={trendPercent > 2 ? 'warning' : trendPercent < -2 ? 'success' : 'default'}
            />
            <KpiCard label={`Énergie prévisionnelle (${h.label})`} value={fmt(forecastEnergy, 0)} unit="kWh" icon={<Target className="w-4 h-4" />} />
            <KpiCard label={`Coût estimé (${h.label})`} value={forecastCost >= 1000 ? `${(forecastCost / 1000).toFixed(1)}k` : fmt(forecastCost, 0)} unit="FCFA" icon={<BarChart3 className="w-4 h-4" />} />
            <KpiCard label={`CO₂ estimé (${h.label})`} value={fmt(forecastCO2, 1)} unit="kg" icon={<Calendar className="w-4 h-4" />} />
          </div>

          {/* Forecast chart */}
          {combinedChart.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Historique + Prévision — Puissance active moyenne
                  <Badge variant="outline" className="text-[10px] ml-auto">{history.length} jours historiques → {forecast.length} jours prévus</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={combinedChart}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit=" kW" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => {
                      const labels: Record<string, string> = { actual: 'Réel', predicted: 'Prévision', upper: 'Borne sup.', lower: 'Borne inf.' };
                      return [v?.toFixed(2) ?? '—', labels[name] ?? name];
                    }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => {
                      const labels: Record<string, string> = { actual: 'Réel', predicted: 'Prévision', upper: 'Borne supérieure', lower: 'Borne inférieure' };
                      return labels[v] ?? v;
                    }} />
                    <Area type="monotone" dataKey="upper" stroke="none" fill="hsl(var(--primary) / 0.1)" />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="hsl(var(--background))" />
                    <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" dot={{ r: 3 }} strokeWidth={2} name="actual" connectNulls />
                    <Line type="monotone" dataKey="predicted" stroke="#f97316" dot={{ r: 3 }} strokeWidth={2} strokeDasharray="6 3" name="predicted" connectNulls />
                    <ReferenceLine y={dailyAvg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Moy: ${dailyAvg.toFixed(1)} kW`, position: 'right', fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Données insuffisantes pour générer une prévision. Attendez au moins 2 jours de données.
              </CardContent>
            </Card>
          )}

          {/* Hourly profile */}
          {hourlyProfile.some(h => h.avg > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Profil de charge horaire typique
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={hourlyProfile}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit=" kW" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v.toFixed(2), name === 'avg' ? 'Moyenne' : 'Maximum']} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => v === 'avg' ? 'Puissance moyenne' : 'Puissance max'} />
                    <Area type="monotone" dataKey="avg" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="avg" />
                    <Line type="monotone" dataKey="max" stroke="#ef4444" dot={false} strokeWidth={1} strokeDasharray="3 3" name="max" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}