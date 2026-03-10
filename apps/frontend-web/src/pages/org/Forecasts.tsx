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
  TrendingUp, Loader2, Calendar, Activity, Zap, Target, BarChart3, Brain, RefreshCw,
  ArrowRight, Clock, Eye,
} from 'lucide-react';
import { useReadings, useTerrainOverview, stableFrom, stableNow } from '@/hooks/useApi';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, ComposedChart, Bar,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

const FORECAST_HORIZONS = [
  { key: '1D', label: 'J+1', days: 1, historyDays: 7 },
  { key: '3D', label: 'J+3', days: 3, historyDays: 14 },
  { key: '7D', label: 'J+7', days: 7, historyDays: 30 },
] as const;

// ──────────────────────────────────────── helpers ────────────────────────────────────────

/** Build hourly profile for a given date from raw readings */
function buildHourlyProfile(readings: Array<Record<string, unknown>>, targetDate: Date) {
  const targetDay = targetDate.toLocaleDateString('fr-FR');
  const hourlyMap = new Map<number, number[]>();
  for (const r of readings) {
    const t = new Date(String(r.time));
    if (t.toLocaleDateString('fr-FR') !== targetDay) continue;
    const pw = r.active_power_total != null ? Number(r.active_power_total) : null;
    if (pw == null) continue;
    const h = t.getHours();
    if (!hourlyMap.has(h)) hourlyMap.set(h, []);
    hourlyMap.get(h)!.push(pw);
  }
  return Array.from({ length: 24 }, (_, h) => {
    const vals = hourlyMap.get(h) ?? [];
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

/** Build historical daily averages from readings */
function buildDailyHistory(readings: Array<Record<string, unknown>>) {
  const dailyMap = new Map<string, { sum: number; count: number; max: number; date: Date }>();
  for (const r of readings) {
    const t = new Date(String(r.time));
    const dayKey = t.toISOString().slice(0, 10);
    const pw = r.active_power_total != null ? Number(r.active_power_total) : null;
    if (pw == null) continue;
    if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { sum: 0, count: 0, max: -Infinity, date: t });
    const e = dailyMap.get(dayKey)!;
    e.sum += pw; e.count++; e.max = Math.max(e.max, pw);
  }
  return Array.from(dailyMap.entries())
    .map(([key, v]) => ({
      dateKey: key,
      date: v.date,
      label: v.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      avg: Math.round((v.sum / v.count) * 100) / 100,
      max: Math.round(v.max * 100) / 100,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Build predicted hourly profile for a future day based on historical hourly patterns */
function buildPredictedHourly(
  readings: Array<Record<string, unknown>>,
  dailyAvg: number,
  forecastDayIndex: number,
  slope: number,
  n: number,
) {
  // Compute hourly shape from history (avg profile)
  const hourlyShape = new Map<number, number[]>();
  for (const r of readings) {
    const hh = new Date(String(r.time)).getHours();
    const pw = r.active_power_total != null ? Number(r.active_power_total) : null;
    if (pw == null) continue;
    if (!hourlyShape.has(hh)) hourlyShape.set(hh, []);
    hourlyShape.get(hh)!.push(pw);
  }

  const profileAvgs: number[] = [];
  for (let hh = 0; hh < 24; hh++) {
    const vals = hourlyShape.get(hh) ?? [];
    profileAvgs.push(vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
  }
  const profileTotal = profileAvgs.reduce((s, v) => s + v, 0);

  // Predicted daily average with trend
  const predictedDailyAvg = Math.max(0, dailyAvg + slope * (n >= 2 ? forecastDayIndex : 0));

  // Scale hourly shape to predicted daily level
  const scale = profileTotal > 0 ? predictedDailyAvg / (profileTotal / 24) : 1;
  return profileAvgs.map(v => Math.max(0, Math.round(v * scale * 100) / 100));
}

/** Compute daily forecast stats */
function computeForecast(
  readings: Array<Record<string, unknown>>,
  forecastDays: number,
) {
  if (!readings.length) return { history: [] as ReturnType<typeof buildDailyHistory>, forecast: [] as Array<{ day: string; predicted: number; upper: number; lower: number; dateKey: string }>, dailyAvg: 0, trend: 0 };

  const history = buildDailyHistory(readings);
  if (!history.length) return { history, forecast: [], dailyAvg: 0, trend: 0 };

  const n = history.length;
  const avgPower = history.reduce((s, d) => s + d.avg, 0) / n;

  let slope = 0;
  if (n >= 2) {
    const xMean = (n - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (history[i].avg - avgPower);
      den += (i - xMean) ** 2;
    }
    slope = den !== 0 ? num / den : 0;
  }

  const stdDev = n >= 2
    ? Math.sqrt(history.reduce((s, d) => s + (d.avg - avgPower) ** 2, 0) / n)
    : avgPower * 0.3;

  const forecast: Array<{ day: string; predicted: number; upper: number; lower: number; dateKey: string }> = [];
  const today = new Date();
  for (let i = 1; i <= forecastDays; i++) {
    const futureDate = new Date(today.getTime() + i * 86400_000);
    const dayLabel = futureDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const predicted = Math.max(0, avgPower + slope * (n >= 2 ? (n - 1 + i - (n - 1) / 2) : 0));
    const confidence = stdDev * 1.5 * Math.sqrt(1 + i / n);
    forecast.push({
      day: dayLabel,
      dateKey: futureDate.toISOString().slice(0, 10),
      predicted: Math.round(predicted * 100) / 100,
      upper: Math.round((predicted + confidence) * 100) / 100,
      lower: Math.max(0, Math.round((predicted - confidence) * 100) / 100),
    });
  }

  return { history, forecast, dailyAvg: avgPower, trend: slope };
}

// ──────────────────────────── theme-safe chart colors ────────────────────────────
// Using CSS variables via hsl() so they adapt to dark/light
const COLORS = {
  actual:     'hsl(var(--primary))',       // blue — adapts to mode
  predicted:  'hsl(25 95% 53%)',           // orange — consistent both modes
  yesterday:  'hsl(var(--muted-foreground))', // gray — adapts
  confidence: 'hsl(25 95% 53% / 0.12)',    // orange tint
  max:        'hsl(0 84% 60%)',            // red for peaks
  grid:       'hsl(var(--border))',         // adapts to mode
};

// ──────────────────────────────────── component ─────────────────────────────────

export default function Forecasts() {
  const { selectedTerrainId } = useAppContext();
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const [horizon, setHorizon] = useState<string>('1D');
  const [selectedPoint, setSelectedPoint] = useState<string>('_all');
  const [compareDay, setCompareDay] = useState<'today' | 'yesterday'>('yesterday');
  const queryClient = useQueryClient();

  const h = FORECAST_HORIZONS.find(f => f.key === horizon) ?? FORECAST_HORIZONS[0];
  const from = useMemo(() => stableFrom(h.historyDays * 86400_000), [h]);
  const to = useMemo(() => stableNow(), []);

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const { data, isLoading } = useReadings(selectedTerrainId, {
    from,
    to,
    point_id: selectedPoint === '_all' ? undefined : selectedPoint,
    limit: 5000,
    cols: 'active_power_total',
  });

  // LightGBM ML forecast API (auto-trains if no model exists)
  const { data: mlForecast, isLoading: mlLoading, isError: mlError } = useQuery({
    queryKey: ['ml-forecast', selectedTerrainId, h.days],
    queryFn: async () => {
      try { return await api.getMLForecast(selectedTerrainId!, h.days); }
      catch (e: any) {
        if (e.status === 404 || e.status === 422 || e.status === 503) return null;
        throw e;
      }
    },
    enabled: !!selectedTerrainId,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev: unknown) => prev,
  });

  const trainMutation = useMutation({
    mutationFn: () => api.trainMLModel(selectedTerrainId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ml-forecast', selectedTerrainId] }); },
  });

  const mlType = (mlForecast as any)?.model_type as string | undefined;
  const useML = !!mlForecast && !mlError;

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const readings = (data?.readings ?? []) as Array<Record<string, unknown>>;

  const clientForecast = useMemo(() => computeForecast(readings, h.days), [readings, h.days]);

  const history = clientForecast.history;
  const forecast = useML
    ? (mlForecast as any).forecast.map((d: any) => ({ day: d.day, predicted: d.predicted_kwh, upper: d.upper, lower: d.lower, dateKey: '' }))
    : clientForecast.forecast;
  const dailyAvg = clientForecast.dailyAvg;
  const trend = clientForecast.trend;

  // ── Hourly J+1 predicted curve (main feature) ──
  const predictedHourly = useMemo(
    () => buildPredictedHourly(readings, dailyAvg, 1, trend, history.length),
    [readings, dailyAvg, trend, history.length],
  );

  // ── Comparison profiles: today & yesterday ──
  const now = new Date();
  const todayProfile = useMemo(() => buildHourlyProfile(readings, now), [readings]);
  const yesterdayProfile = useMemo(() => {
    const y = new Date(now.getTime() - 86400_000);
    return buildHourlyProfile(readings, y);
  }, [readings]);

  const compareProfile = compareDay === 'today' ? todayProfile : yesterdayProfile;
  const compareLabel = compareDay === 'today' ? "Aujourd'hui" : 'Hier';

  // ── Chart data: hourly predicted curve + comparison ──
  const hourlyChartData = useMemo(() => {
    return Array.from({ length: 24 }, (_, hh) => ({
      hour: `${String(hh).padStart(2, '0')}h`,
      prévision: predictedHourly[hh],
      [compareLabel]: compareProfile[hh],
      max_prévu: predictedHourly[hh] != null ? Math.round(predictedHourly[hh] * 1.25 * 100) / 100 : null,
    }));
  }, [predictedHourly, compareProfile, compareLabel]);

  // ── Multi-day historical chart with forecast overlay ──
  const dailyChart = useMemo(() => {
    const hist = history.map(d => ({
      day: d.label,
      réel: d.avg,
      max_réel: d.max,
      prévision: null as number | null,
      bande_haute: null as number | null,
      bande_basse: null as number | null,
    }));
    const fc = forecast.map(d => ({
      day: d.day,
      réel: null as number | null,
      max_réel: null as number | null,
      prévision: d.predicted,
      bande_haute: d.upper,
      bande_basse: d.lower,
    }));
    // Bridge last history point to first forecast
    if (hist.length && fc.length) {
      fc[0].réel = hist[hist.length - 1].réel;
    }
    return [...hist, ...fc];
  }, [history, forecast]);

  // ── Prediction vs actual comparison (for past forecast days that now have real data) ──
  const predVsActual = useMemo(() => {
    if (!forecast.length || !history.length) return [];
    // For each forecast point, see if we have actual data for that day
    return forecast
      .map(fc => {
        const match = history.find(h => h.label === fc.day);
        if (!match) return null;
        const error = match.avg > 0 ? Math.round(Math.abs(fc.predicted - match.avg) / match.avg * 100) : null;
        return { day: fc.day, prévu: fc.predicted, réel: match.avg, erreur: error };
      })
      .filter(Boolean) as Array<{ day: string; prévu: number; réel: number; erreur: number | null }>;
  }, [forecast, history]);

  // KPIs
  const forecastEnergy = forecast.reduce((s, d) => s + d.predicted * 24, 0);
  const forecastCost = forecastEnergy * prefs.tariffRate;
  const forecastCO2 = forecastEnergy * prefs.co2Factor;
  const trendPercent = dailyAvg > 0 ? (trend / dailyAvg) * 100 : 0;
  const peakPredicted = predictedHourly.length ? Math.max(...predictedHourly) : 0;

  // Model badge label
  const modelBadge = useML
    ? mlType === 'simple'
      ? 'Moyenne par jour de semaine'
      : `LightGBM (MAPE: ${(mlForecast as any)?.model_mape?.toFixed(1) ?? '?'}%)`
    : 'Régression linéaire (local)';

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
          <div className="flex items-center gap-2">
            <Badge variant={useML ? 'default' : 'outline'} className="text-xs">
              {useML ? <Brain className="w-3 h-3 mr-1" /> : <Activity className="w-3 h-3 mr-1" />}
              {modelBadge}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => trainMutation.mutate()}
              disabled={trainMutation.isPending || !selectedTerrainId}
            >
              {trainMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Entraîner
            </Button>
          </div>
        }
      />

      {/* ── Controls ── */}
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
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
            <KpiCard label="Puiss. moy. historique" value={fmt(dailyAvg, 1)} unit="kW" icon={<Zap className="w-4 h-4" />} />
            <KpiCard
              label="Tendance journalière"
              value={`${trendPercent >= 0 ? '+' : ''}${trendPercent.toFixed(1)}`}
              unit="%/j"
              icon={<TrendingUp className="w-4 h-4" />}
              variant={trendPercent > 2 ? 'warning' : trendPercent < -2 ? 'success' : 'default'}
            />
            <KpiCard label="Pic prévu demain" value={fmt(peakPredicted, 1)} unit="kW" icon={<Target className="w-4 h-4" />} />
            <KpiCard label={`Coût estimé (${h.label})`} value={forecastCost >= 1000 ? `${(forecastCost / 1000).toFixed(1)}k` : fmt(forecastCost, 0)} unit={currSym} icon={<BarChart3 className="w-4 h-4" />} />
            <KpiCard label={`CO₂ estimé (${h.label})`} value={fmt(forecastCO2, 1)} unit="kg" icon={<Calendar className="w-4 h-4" />} />
          </div>

          {/* ══════════════════════ CHART 1: Courbe horaire J+1 ══════════════════════ */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Courbe de charge prévue — Demain (J+1)
                </CardTitle>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">Comparer à :</span>
                  <Button variant={compareDay === 'yesterday' ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setCompareDay('yesterday')}>Hier</Button>
                  <Button variant={compareDay === 'today' ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setCompareDay('today')}>Aujourd'hui</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={hourlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.5} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit=" kW" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      color: 'hsl(var(--card-foreground))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number | null, name: string) => [v != null ? `${v.toFixed(1)} kW` : '—', name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* Comparison day (behind) */}
                  <Area
                    type="monotone"
                    dataKey={compareLabel}
                    stroke={COLORS.yesterday}
                    fill="hsl(var(--muted) / 0.4)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                  />
                  {/* Predicted curve (main) */}
                  <Line
                    type="monotone"
                    dataKey="prévision"
                    stroke={COLORS.predicted}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: COLORS.predicted, stroke: COLORS.predicted }}
                    activeDot={{ r: 5 }}
                  />
                  {/* Peak reference */}
                  {peakPredicted > 0 && (
                    <ReferenceLine
                      y={peakPredicted}
                      stroke={COLORS.max}
                      strokeDasharray="4 4"
                      label={{ value: `Pic: ${peakPredicted.toFixed(1)} kW`, position: 'right', fontSize: 10, fill: COLORS.max }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-muted-foreground mt-2 text-center">
                Courbe orange = prévision demain &nbsp;·&nbsp; Zone grise = profil {compareLabel.toLowerCase()} pour comparaison
              </p>
            </CardContent>
          </Card>

          {/* ══════════════════════ CHART 2: Historique + prévision multi-jours ══════════════════════ */}
          {dailyChart.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Historique + Prévision — Puissance active moyenne par jour
                  <Badge variant="outline" className="text-[10px] ml-auto">{history.length} j historiques <ArrowRight className="w-3 h-3 inline" /> {forecast.length} j prévus</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.5} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit=" kW" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        color: 'hsl(var(--card-foreground))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number | null, name: string) => {
                        const labels: Record<string, string> = { réel: 'Réel (moy)', max_réel: 'Réel (pic)', prévision: 'Prévision', bande_haute: 'Intervalle haut', bande_basse: 'Intervalle bas' };
                        return [v != null ? `${v.toFixed(1)} kW` : '—', labels[name] ?? name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => {
                      const labels: Record<string, string> = { réel: 'Réel (moy)', max_réel: 'Pic journalier', prévision: 'Prévision', bande_haute: 'Intervalle de confiance', bande_basse: '' };
                      return labels[v] ?? v;
                    }} />
                    {/* Confidence band */}
                    <Area type="monotone" dataKey="bande_haute" stroke="none" fill={COLORS.confidence} legendType="square" />
                    <Area type="monotone" dataKey="bande_basse" stroke="none" fill="hsl(var(--card))" legendType="none" />
                    {/* Actual */}
                    <Line type="monotone" dataKey="réel" stroke={COLORS.actual} strokeWidth={2} dot={{ r: 3, fill: COLORS.actual }} connectNulls />
                    {/* Max peaks (subtle) */}
                    <Line type="monotone" dataKey="max_réel" stroke={COLORS.max} strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
                    {/* Predicted */}
                    <Line type="monotone" dataKey="prévision" stroke={COLORS.predicted} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.predicted }} strokeDasharray="6 3" connectNulls />
                    {/* Average reference */}
                    <ReferenceLine
                      y={dailyAvg}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      label={{ value: `Moy: ${dailyAvg.toFixed(1)} kW`, position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ══════════════════════ CHART 3: Prévu vs Réel (si données disponibles) ══════════════════════ */}
          {predVsActual.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  Prévu vs Réel — Vérification des prédictions passées
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={predVsActual}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} opacity={0.5} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit=" kW" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        color: 'hsl(var(--card-foreground))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number | null, name: string) => {
                        if (name === 'erreur') return [v != null ? `${v}%` : '—', 'Erreur'];
                        return [v != null ? `${v.toFixed(1)} kW` : '—', name === 'prévu' ? 'Prévu' : 'Réel'];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => {
                      const labels: Record<string, string> = { prévu: 'Prévu', réel: 'Réel', erreur: 'Erreur (%)' };
                      return labels[v] ?? v;
                    }} />
                    <Bar dataKey="prévu" fill={COLORS.predicted} opacity={0.7} radius={[4, 4, 0, 0]} barSize={24} />
                    <Bar dataKey="réel" fill={COLORS.actual} opacity={0.8} radius={[4, 4, 0, 0]} barSize={24} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 mt-3 justify-center">
                  {predVsActual.map(d => (
                    <div key={d.day} className="text-center">
                      <span className="text-xs text-muted-foreground">{d.day}</span>
                      <div className={`text-sm font-semibold ${d.erreur != null && d.erreur > 15 ? 'text-destructive' : d.erreur != null && d.erreur < 5 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                        {d.erreur != null ? `${d.erreur}% erreur` : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No data state */}
          {!dailyChart.length && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Aucune donnée de mesure disponible pour cette période. Vérifiez que les appareils transmettent des données.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}