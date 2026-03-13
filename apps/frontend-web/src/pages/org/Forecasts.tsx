import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp, Loader2, Calendar, Activity, Zap, Target, BarChart3, Brain, RefreshCw,
  ArrowRight, Clock, Eye, AlertTriangle,
} from 'lucide-react';
import { useTerrainOverview, useHourlyForecast, useComparisonProfiles, useDailyChartData, useMLForecast } from '@/hooks/useApi';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  const pointId = selectedPoint === '_all' ? undefined : selectedPoint;

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);

  // ── Backend-computed forecasts (replaces client-side logic) ──
  const { data: hourlyData, isLoading: hourlyLoading } = useHourlyForecast(selectedTerrainId, {
    days: h.days,
    point_id: pointId,
    history_days: h.historyDays,
  });

  const { data: profilesData } = useComparisonProfiles(selectedTerrainId, pointId);

  const { data: dailyChartData, isLoading: dailyLoading } = useDailyChartData(selectedTerrainId, {
    history_days: h.historyDays,
    forecast_days: h.days,
  });

  // LightGBM ML forecast (for multi-day predictions)
  const { data: mlForecast, isError: mlError } = useMLForecast(selectedTerrainId, h.days);

  const trainMutation = useMutation({
    mutationFn: () => api.trainMLModel(selectedTerrainId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mlForecast', selectedTerrainId] });
      queryClient.invalidateQueries({ queryKey: ['hourlyForecast', selectedTerrainId] });
      queryClient.invalidateQueries({ queryKey: ['dailyChartData', selectedTerrainId] });
    },
  });

  const isLoading = hourlyLoading || dailyLoading;
  const useML = !!mlForecast && !mlError;
  const mlType = (mlForecast as any)?.model_type as string | undefined;

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;

  // ── Extract data from backend responses ──
  const dailyAvg = hourlyData?.daily_avg_kw ?? 0;
  const trend = hourlyData?.trend_per_day ?? 0;
  const confidenceLevel = hourlyData?.confidence_level ?? 0;
  const warnings = hourlyData?.warnings ?? [];
  const dataDays = hourlyData?.data_days ?? 0;

  // Predicted hourly curve (J+1)
  const predictedHourly: number[] = useMemo(() => {
    if (!hourlyData?.hourly_forecast?.length) return [];
    const firstDay = hourlyData.hourly_forecast[0];
    return firstDay?.hours?.map(h => h.predicted_kw) ?? [];
  }, [hourlyData]);

  // Comparison profiles from backend
  const todayProfile = useMemo(() => profilesData?.today?.map(h => h.kw) ?? Array(24).fill(null), [profilesData]);
  const yesterdayProfile = useMemo(() => profilesData?.yesterday?.map(h => h.kw) ?? Array(24).fill(null), [profilesData]);

  const compareProfile = compareDay === 'today' ? todayProfile : yesterdayProfile;
  const compareLabel = compareDay === 'today' ? "Aujourd'hui" : 'Hier';

  // ── Chart data: hourly predicted curve + comparison ──
  const hourlyChartData = useMemo(() => {
    return Array.from({ length: 24 }, (_, hh) => ({
      hour: `${String(hh).padStart(2, '0')}h`,
      prévision: predictedHourly[hh] ?? null,
      [compareLabel]: compareProfile[hh],
      max_prévu: predictedHourly[hh] != null ? Math.round(predictedHourly[hh] * 1.25 * 100) / 100 : null,
    }));
  }, [predictedHourly, compareProfile, compareLabel]);

  // ── Multi-day daily chart from backend ──
  const dailyChart = useMemo(() => {
    if (!dailyChartData?.chart_data) return [];
    return dailyChartData.chart_data.map(d => ({
      day: d.day,
      réel: d.actual_kwh,
      max_réel: d.actual_max,
      prévision: d.predicted_kwh,
      bande_haute: d.upper,
      bande_basse: d.lower,
    }));
  }, [dailyChartData]);

  // Forecast array for KPIs (use ML if available, otherwise backend hourly)
  const forecast = useMemo(() => {
    if (useML && mlForecast?.forecast) {
      return mlForecast.forecast.map((d: any) => ({
        day: d.day,
        predicted: d.predicted_kwh,
        upper: d.upper,
        lower: d.lower,
      }));
    }
    if (hourlyData?.daily_forecast) {
      return hourlyData.daily_forecast.map(d => ({
        day: d.day,
        predicted: d.predicted_kwh,
        upper: d.upper,
        lower: d.lower,
      }));
    }
    return [];
  }, [useML, mlForecast, hourlyData]);

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
    : hourlyData?.model_type
      ? `Profil horaire (${dataDays}j historique)`
      : 'Régression linéaire';

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
        {/* Confidence & data quality indicator */}
        {confidenceLevel > 0 && confidenceLevel < 0.7 && (
          <Badge variant="outline" className="text-xs text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Confiance: {Math.round(confidenceLevel * 100)}%
          </Badge>
        )}
      </div>

      {/* ── Data quality warnings ── */}
      {warnings.length > 0 && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-sm text-yellow-700 dark:text-yellow-400">
            {warnings.join(' • ')}
          </AlertDescription>
        </Alert>
      )}

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
                  <Badge variant="outline" className="text-[10px] ml-auto">{dailyChartData?.history_days ?? 0} j historiques <ArrowRight className="w-3 h-3 inline" /> {forecast.length} j prévus</Badge>
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

          {/* ══════════════════════ Model Quality Card (if ML available) ══════════════════════ */}
          {useML && mlForecast && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  Qualité du modèle prédictif
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {(mlForecast as any)?.model_mape?.toFixed(1) ?? '—'}%
                    </div>
                    <div className="text-xs text-muted-foreground">MAPE (erreur moyenne)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {(mlForecast as any)?.model_rmse?.toFixed(1) ?? '—'}
                    </div>
                    <div className="text-xs text-muted-foreground">RMSE (kWh)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {dataDays}
                    </div>
                    <div className="text-xs text-muted-foreground">Jours d'historique</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {Math.round(confidenceLevel * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Niveau de confiance</div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 text-center">
                  MAPE &lt; 10% = excellent · MAPE 10-20% = bon · MAPE &gt; 20% = à améliorer (plus de données nécessaires)
                </p>
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