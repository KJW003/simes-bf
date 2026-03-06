import React, { useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import {
  CheckCircle2, AlertTriangle, FileText, Gauge, Activity,
  Zap, Loader2,
} from 'lucide-react';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function EnergyAudit() {
  const { selectedTerrainId } = useAppContext();

  const now = useMemo(() => new Date(), []);
  const from24h = useMemo(() => new Date(now.getTime() - 24 * 3600_000).toISOString(), [now]);

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(selectedTerrainId);
  const { data: readingsData, isLoading: loadR } = useReadings(selectedTerrainId, { from: from24h, to: now.toISOString(), limit: 5000 });

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

    // Frequency stability
    const freqValues = readings.map(r => r.frequency).filter(v => v != null).map(Number);
    if (freqValues.length) {
      const freqMin = Math.min(...freqValues);
      const freqMax = Math.max(...freqValues);
      const deviation = Math.max(Math.abs(freqMax - 50), Math.abs(50 - freqMin));
      diags.push({ label: 'Stabilité fréquence', status: deviation > 0.5 ? 'warning' : 'ok', detail: `${freqMin.toFixed(2)} – ${freqMax.toFixed(2)} Hz` });
    }

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Points analysés" value={points.length} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Mesures 24h" value={readings.length} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="PF global" value={fmt(pfGlobal, 3)} icon={<Gauge className="w-4 h-4" />}
          variant={pfGlobal < 0.85 ? 'warning' : 'success'} />
        <KpiCard label="Alertes" value={diagnostics.filter(d => d.status !== 'ok').length} icon={<AlertTriangle className="w-4 h-4" />}
          variant={diagnostics.some(d => d.status === 'critical') ? 'critical' : diagnostics.some(d => d.status === 'warning') ? 'warning' : 'success'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
    </div>
  );
}
