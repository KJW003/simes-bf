import React, { useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadialGauge } from '@/components/ui/radial-gauge';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import {
  CheckCircle2, AlertTriangle, FileText, Gauge, Activity,
  Zap, Loader2, TrendingUp, ShieldCheck, ThermometerSun,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function EnergyAudit() {
  const { selectedTerrainId } = useAppContext();
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);

  const now = useMemo(() => new Date(), []);
  const from24h = useMemo(() => new Date(now.getTime() - 24 * 3600_000).toISOString(), [now]);

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(selectedTerrainId);
  const { data: readingsData, isLoading: loadR } = useReadings(selectedTerrainId, { from: from24h, to: now.toISOString() });

  const points = (overviewData?.points ?? []) as Array<Record<string, unknown>>;
  const readings = (readingsData?.readings ?? []) as Array<Record<string, unknown>>;
  const isLoading = loadOv || loadR;

  // ─── Computed diagnostics from real data
  const diagnostics = useMemo(() => {
    const diags: Array<{ label: string; status: 'ok' | 'warning' | 'critical'; detail: string }> = [];

    // PF average
    const pfValues = readings.map(r => r.power_factor_total).filter(v => v != null).map(Number);
    const pfAvg = pfValues.length ? pfValues.reduce((s, v) => s + v, 0) / pfValues.length : null;
    if (pfAvg != null) {
      diags.push({ label: 'Facteur de puissance', status: pfAvg < 0.85 ? 'warning' : 'ok', detail: `PF moyen ${pfAvg.toFixed(3)} (24h, ${pfValues.length} mesures)` });
    }

    // THD average
    const thdValues = readings.flatMap(r => [r.thdi_a, r.thdi_b, r.thdi_c]).filter(v => v != null).map(Number);
    const thdAvg = thdValues.length ? thdValues.reduce((s, v) => s + v, 0) / thdValues.length : null;
    const thdMax = thdValues.length ? Math.max(...thdValues) : 0;
    if (thdAvg != null) {
      diags.push({ label: 'Distorsion harmonique (THD)', status: thdMax > 8 ? 'critical' : thdMax > 5 ? 'warning' : 'ok', detail: `Moy ${thdAvg.toFixed(1)}% — Max ${thdMax.toFixed(1)}%` });
    }

    // Voltage quality (unbalance)
    const vUnbal = readings.map(r => r.voltage_unbalance).filter(v => v != null).map(Number);
    const vUnbalMax = vUnbal.length ? Math.max(...vUnbal) : 0;
    const vUnbalAvg = vUnbal.length ? vUnbal.reduce((s, v) => s + v, 0) / vUnbal.length : null;
    if (vUnbalAvg != null) {
      diags.push({ label: 'Qualité tension', status: vUnbalMax > 3 ? 'warning' : 'ok', detail: `Déséquilibre moy ${vUnbalAvg.toFixed(1)}% — max ${vUnbalMax.toFixed(1)}%` });
    }

    // Data completeness: expected ~96 readings per 24h (15min intervals)
    const expectedReadings = points.length * 96;
    const actual = readings.length;
    const completeness = expectedReadings > 0 ? (actual / expectedReadings) * 100 : 0;
    diags.push({
      label: 'Complétude données',
      status: completeness < 80 ? 'warning' : 'ok',
      detail: `${actual} mesures / ~${expectedReadings} attendues (${completeness.toFixed(0)}%)`,
    });

    return diags;
  }, [readings, points]);

  // ─── Computed recommendations
  const recommendations = useMemo(() => {
    const recs: Array<{ priority: 'Haute' | 'Moyenne' | 'Basse'; title: string; impact: string }> = [];

    // Low PF points
    const lowPfPoints = points.filter(p => {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      return r?.power_factor_total != null && Number(r.power_factor_total) < 0.85;
    });
    if (lowPfPoints.length > 0) {
      recs.push({ priority: 'Haute', title: `${lowPfPoints.length} point(s) avec PF < 0.85`, impact: 'Risque de pénalité facteur de puissance' });
    }

    // High THD points
    const highThdPoints = points.filter(p => {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      return [r?.thdi_a, r?.thdi_b, r?.thdi_c].some(v => v != null && Number(v) > 8);
    });
    if (highThdPoints.length > 0) {
      recs.push({ priority: 'Haute', title: `${highThdPoints.length} point(s) avec THD > 8%`, impact: 'Harmoniques élevées — risque d\'échauffement' });
    }

    // Voltage unbalance
    const unbalPoints = points.filter(p => {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      return r?.voltage_unbalance != null && Number(r.voltage_unbalance) > 2;
    });
    if (unbalPoints.length > 0) {
      recs.push({ priority: 'Moyenne', title: `${unbalPoints.length} point(s) avec déséquilibre > 2%`, impact: 'Vérifier distribution monophasée' });
    }

    // If no issues found
    if (recs.length === 0) {
      recs.push({ priority: 'Basse', title: 'Aucun problème critique détecté', impact: 'Installation dans les normes' });
    }

    return recs;
  }, [points]);

  // ─── KPIs
  const pfAll = points.map(p => (p as any).readings?.power_factor_total).filter((v: unknown) => v != null).map(Number);
  const pfGlobal = pfAll.length ? pfAll.reduce((s: number, v: number) => s + v, 0) / pfAll.length : 0;

  // ─── Energy Efficiency Score (0–100)
  const efficiencyScore = useMemo(() => {
    let score = 100;
    // PF penalty: -20 if < 0.85, -10 if < 0.92
    if (pfGlobal > 0 && pfGlobal < 0.85) score -= 20;
    else if (pfGlobal > 0 && pfGlobal < 0.92) score -= 10;

    // THD penalty
    const thdVals = readings.flatMap(r => [r.thdi_a, r.thdi_b, r.thdi_c]).filter(v => v != null).map(Number);
    const thdMax = thdVals.length ? Math.max(...thdVals) : 0;
    if (thdMax > 8) score -= 15;
    else if (thdMax > 5) score -= 8;

    // Voltage unbalance penalty
    const vUnbal = readings.map(r => r.voltage_unbalance).filter(v => v != null).map(Number);
    const vUnbalMax = vUnbal.length ? Math.max(...vUnbal) : 0;
    if (vUnbalMax > 3) score -= 15;
    else if (vUnbalMax > 2) score -= 8;

    // Data completeness penalty
    const expectedReadings = points.length * 96;
    const completeness = expectedReadings > 0 ? (readings.length / expectedReadings) * 100 : 100;
    if (completeness < 80) score -= 10;
    else if (completeness < 90) score -= 5;

    // Diagnostic issues penalty
    const issues = diagnostics.filter(d => d.status !== 'ok').length;
    score -= issues * 5;

    return Math.max(0, Math.min(100, score));
  }, [pfGlobal, readings, points, diagnostics]);

  const scoreLabel = efficiencyScore >= 85 ? 'Excellent' : efficiencyScore >= 70 ? 'Bon' : efficiencyScore >= 50 ? 'Moyen' : 'Critique';

  // ─── Per-point PF table with diagnostics
  const pointDiagnostics = useMemo(() => {
    return points.map(p => {
      const r = (p as any).readings as Record<string, any> | undefined;
      if (!r) return null;
      const pf = r.power_factor_total != null ? Number(r.power_factor_total) : null;
      const thdA = r.thdi_a != null ? Number(r.thdi_a) : null;
      const vUnbal = r.voltage_unbalance != null ? Number(r.voltage_unbalance) : null;
      const power = r.active_power_total != null ? Number(r.active_power_total) : 0;

      let pointScore = 100;
      if (pf != null && pf < 0.85) pointScore -= 25;
      else if (pf != null && pf < 0.92) pointScore -= 10;
      if (thdA != null && thdA > 8) pointScore -= 20;
      else if (thdA != null && thdA > 5) pointScore -= 10;
      if (vUnbal != null && vUnbal > 3) pointScore -= 15;

      return {
        name: String((p as any).name),
        pf, thdA, vUnbal, power,
        score: Math.max(0, pointScore),
      };
    }).filter(Boolean) as Array<{ name: string; pf: number | null; thdA: number | null; vUnbal: number | null; power: number; score: number }>;
  }, [points]);

  // Energy cost estimation
  const energyVals = readings.map(r => r.energy_total != null ? Number(r.energy_total) : (r.energy_import != null ? Number(r.energy_import) : NaN)).filter(v => !isNaN(v));
  const energyDelta = energyVals.length >= 2 ? Math.max(...energyVals) - Math.min(...energyVals) : 0;
  const costEstimate = energyDelta * prefs.tariffRate;
  const co2Estimate = energyDelta * prefs.co2Factor;

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit énergétique" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit énergétique" description="Chargement…" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Audit énergétique"
        description="Diagnostic automatique et recommandations — basé sur les 24 dernières heures"
        actions={
          <Button variant="outline" size="sm" disabled>
            <FileText className="w-4 h-4 mr-2" />
            Générer rapport
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Points analysés" value={points.length} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Mesures 24h" value={readings.length} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="PF global" value={fmt(pfGlobal, 3)} icon={<Gauge className="w-4 h-4" />}
          variant={pfGlobal < 0.85 ? 'warning' : 'success'} />
        <KpiCard label="Énergie 24h" value={fmt(energyDelta, 1)} unit="kWh" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Alertes" value={diagnostics.filter(d => d.status !== 'ok').length} icon={<AlertTriangle className="w-4 h-4" />}
          variant={diagnostics.some(d => d.status === 'critical') ? 'critical' : diagnostics.some(d => d.status === 'warning') ? 'warning' : 'success'} />
      </div>

      {/* Efficiency Score Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="flex items-center justify-center py-4">
          <div className="text-center">
            <RadialGauge
              value={efficiencyScore}
              min={0} max={100}
              label="Score d'efficacité"
              unit="/100"
              size={180}
              thresholds={[
                { value: 0, color: '#ef4444' },
                { value: 50, color: '#f59e0b' },
                { value: 70, color: '#22c55e' },
                { value: 85, color: '#10b981' },
              ]}
            />
            <Badge className={`mt-2 ${efficiencyScore >= 70 ? 'bg-green-100 text-green-700' : efficiencyScore >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              <ShieldCheck className="w-3 h-3 mr-1" />{scoreLabel}
            </Badge>
          </div>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">État du diagnostic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnostics.length === 0 && <div className="text-sm text-muted-foreground">Aucune donnée pour calculer le diagnostic</div>}
            {diagnostics.map(item => (
              <div key={item.label} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  {item.status === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 text-severity-ok" />
                  ) : item.status === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-severity-warning" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                  <span>{item.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Recommandations prioritaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map(item => (
              <div key={item.title} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{item.title}</div>
                  <Badge variant="secondary" className="text-[10px]">{item.priority}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Impact: {item.impact}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Per-point efficiency chart */}
      {pointDiagnostics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ThermometerSun className="w-4 h-4 text-primary" />
              Score par point de mesure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, pointDiagnostics.length * 40)}>
              <BarChart data={pointDiagnostics} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="/100" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => {
                  const labels: Record<string, string> = { score: 'Score', pf: 'PF', thdA: 'THD A%', power: 'kW' };
                  return [typeof v === 'number' ? v.toFixed(2) : v, labels[name] ?? name];
                }} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))">
                </Bar>
                <ReferenceLine x={70} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Seuil', fontSize: 10 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-point table */}
      {pointDiagnostics.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Détail par point</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Point</th>
                    <th className="pb-2 font-medium text-right">Puiss. (kW)</th>
                    <th className="pb-2 font-medium text-right">PF</th>
                    <th className="pb-2 font-medium text-right">THD A (%)</th>
                    <th className="pb-2 font-medium text-right">Déséq. V (%)</th>
                    <th className="pb-2 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {pointDiagnostics.sort((a, b) => a.score - b.score).map(p => (
                    <tr key={p.name} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="py-2 text-right mono">{fmt(p.power, 1)}</td>
                      <td className={`py-2 text-right mono ${p.pf != null && p.pf < 0.85 ? 'text-red-600 font-semibold' : ''}`}>{fmt(p.pf, 3)}</td>
                      <td className={`py-2 text-right mono ${p.thdA != null && p.thdA > 8 ? 'text-red-600 font-semibold' : ''}`}>{fmt(p.thdA, 1)}</td>
                      <td className={`py-2 text-right mono ${p.vUnbal != null && p.vUnbal > 3 ? 'text-red-600 font-semibold' : ''}`}>{fmt(p.vUnbal, 1)}</td>
                      <td className="py-2 text-right">
                        <Badge className={`text-[10px] ${p.score >= 70 ? 'bg-green-100 text-green-700' : p.score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {p.score}/100
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
