import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadialGauge } from '@/components/ui/radial-gauge';
import { useAuditReport } from '@/hooks/useApi';
import {
  CheckCircle2, AlertTriangle, ArrowLeft, Gauge, Activity,
  Zap, Loader2, TrendingUp, ShieldCheck, ThermometerSun, XCircle, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function AuditDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useAuditReport(id ?? null);
  const audit = data?.audit;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rapport d'audit" description="Chargement..." />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rapport d'audit" description="Rapport introuvable" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Ce rapport n'existe pas ou a été supprimé.</CardContent></Card>
      </div>
    );
  }

  // If still computing, auto-refetch
  const isPending = audit.status === 'pending' || audit.status === 'computing';
  React.useEffect(() => {
    if (!isPending) return;
    const timer = setInterval(() => refetch(), 3000);
    return () => clearInterval(timer);
  }, [isPending, refetch]);

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Rapport d'audit"
          description="Calcul en cours..."
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('/audit-history')}><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button>}
        />
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-sm text-muted-foreground">Analyse des données en cours...</p>
            <p className="text-xs text-muted-foreground mt-1">Le calcul du score d'efficacité peut prendre quelques secondes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (audit.status === 'failed') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Rapport d'audit"
          description="Échec du calcul"
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('/audit-history')}><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button>}
        />
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="w-8 h-8 mx-auto mb-3 text-red-500" />
            <p className="text-sm font-medium text-red-600">Le calcul de l'audit a échoué</p>
            {audit.error && <p className="text-xs text-muted-foreground mt-2">{audit.error}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Ready state — full report ──
  const kpi = audit.kpi ?? {};
  const diagnostics = audit.diagnostics ?? [];
  const recommendations = audit.recommendations ?? [];
  const pointDiagnostics = (audit.point_diagnostics ?? []).sort((a: any, b: any) => a.score - b.score);
  const score = audit.efficiency_score;
  const scoreLabel = audit.score_label;

  const createdDate = new Date(audit.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const periodFrom = new Date(audit.period_from).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const periodTo = new Date(audit.period_to).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Rapport d'audit énergétique"
        description={`Généré le ${createdDate} — Période : ${periodFrom} → ${periodTo}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/audit-history')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour à l'historique
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Points analysés" value={kpi.points_count ?? 0} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Mesures 24h" value={kpi.readings_count ?? 0} icon={<Zap className="w-4 h-4" />} />
        <KpiCard
          label="PF global"
          value={fmt(kpi.pf_global, 3)}
          icon={<Gauge className="w-4 h-4" />}
          variant={kpi.pf_global != null && kpi.pf_global < 0.85 ? 'warning' : 'success'}
        />
        <KpiCard label="Énergie 24h" value={fmt(kpi.energy_kwh, 1)} unit="kWh" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard
          label="Alertes"
          value={diagnostics.filter((d: any) => d.status !== 'ok').length}
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={diagnostics.some((d: any) => d.status === 'critical') ? 'critical' : diagnostics.some((d: any) => d.status === 'warning') ? 'warning' : 'success'}
        />
      </div>

      {/* Score + Diagnostics + Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Efficiency Score Gauge */}
        <Card className="flex items-center justify-center py-4">
          <div className="text-center">
            <RadialGauge
              value={score}
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
            <Badge className={`mt-2 ${score >= 70 ? 'bg-green-100 text-green-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              <ShieldCheck className="w-3 h-3 mr-1" />{scoreLabel}
            </Badge>
            <div className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              {audit.computed_at ? new Date(audit.computed_at).toLocaleString('fr-FR') : ''}
            </div>
          </div>
        </Card>

        {/* Diagnostics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">État du diagnostic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnostics.length === 0 && <div className="text-sm text-muted-foreground">Aucune donnée</div>}
            {diagnostics.map((item: any) => (
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

        {/* Recommendations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Recommandations prioritaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((item: any, i: number) => (
              <div key={i} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{item.title}</div>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${
                      item.priority === 'Haute' ? 'bg-red-100 text-red-700' :
                      item.priority === 'Moyenne' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}
                  >
                    {item.priority}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Impact: {item.impact}</div>
                {item.points && item.points.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Points: {item.points.join(', ')}
                  </div>
                )}
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
                <Bar dataKey="score" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))" />
                <ReferenceLine x={70} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Seuil', fontSize: 10 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-point detail table */}
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
                  {pointDiagnostics.map((p: any) => (
                    <tr key={p.point_id || p.name} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
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

      {/* Data quality footer */}
      <div className="text-xs text-muted-foreground text-center py-2">
        Complétude des données : {kpi.data_completeness_pct?.toFixed(0) ?? '—'}% — THD max : {kpi.thd_max?.toFixed(1) ?? '—'}% — Déséquilibre max : {kpi.v_unbalance_max?.toFixed(1) ?? '—'}%
      </div>
    </div>
  );
}
