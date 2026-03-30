import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { useSolarScenario } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Loader2, Sun, Battery, TrendingUp,
  XCircle, Clock, DollarSign, Leaf,
} from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const METHOD_LABELS: Record<string, string> = {
  average_load: 'Charge moyenne',
  peak_demand: 'Puissance de pointe',
  theoretical_production: 'Production théorique',
  available_surface: 'Surface disponible',
};

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtInt = (v: unknown) => v != null ? Math.round(Number(v)).toLocaleString('fr-FR') : '—';

export default function SolarScenarioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useSolarScenario(id ?? null);
  const scenario = data?.scenario;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Scénario solaire" description="Chargement..." />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="space-y-6">
        <PageHeader title="Scénario solaire" description="Introuvable" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Ce scénario n'existe pas ou a été supprimé.</CardContent></Card>
      </div>
    );
  }

  // Auto-refetch while computing
  const isPending = scenario.status === 'draft' || scenario.status === 'computing';
  React.useEffect(() => {
    if (!isPending) return;
    const timer = setInterval(() => refetch(), 3000);
    return () => clearInterval(timer);
  }, [isPending, refetch, scenario]);

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={scenario.name}
          description="Calcul en cours..."
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('/solar-history')}><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button>}
        />
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-sm text-muted-foreground">Calcul du scénario en cours...</p>
            <p className="text-xs text-muted-foreground mt-1">Analyse des données de consommation et dimensionnement PV.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (scenario.status === 'failed') {
    return (
      <div className="space-y-6">
        <PageHeader
          title={scenario.name}
          description="Échec du calcul"
          actions={<Button variant="ghost" size="sm" onClick={() => navigate('/solar-history')}><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button>}
        />
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="w-8 h-8 mx-auto mb-3 text-red-500" />
            <p className="text-sm font-medium text-red-600">Le calcul a échoué</p>
            {scenario.error && <p className="text-xs text-muted-foreground mt-2">{scenario.error}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Ready state — full results ──
  const r = scenario.results as Record<string, any>;
  const f = scenario.financial;
  const method = scenario.method;
  const createdDate = new Date(scenario.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Production profile (average_load and theoretical_production have them)
  const productionProfile: any[] = r.production_profile ?? [];
  const socProfile: any[] = r.soc_profile ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={scenario.name}
        description={`${METHOD_LABELS[method] ?? method} — ${createdDate}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/solar-history')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour à l'historique
          </Button>
        }
      />

      {/* Financial KPIs */}
      {f && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
          <KpiCard label="Production annuelle" value={fmtInt(f.annual_production_kwh)} unit="kWh/an" icon={<Sun className="w-4 h-4" />} />
          <KpiCard label="Économies annuelles" value={fmtInt(f.annual_savings_xof)} unit="XOF/an" icon={<DollarSign className="w-4 h-4" />} />
          <KpiCard
            label="Retour sur invest."
            value={fmt(f.payback_years, 1)}
            unit="ans"
            icon={<TrendingUp className="w-4 h-4" />}
            variant={f.payback_years != null && f.payback_years < 8 ? 'success' : f.payback_years != null && f.payback_years < 15 ? 'warning' : 'critical'}
          />
          <KpiCard label="CO₂ évité" value={fmtInt(f.co2_avoided_kg_year)} unit="kg/an" icon={<Leaf className="w-4 h-4" />} />
        </div>
      )}

      {/* Technical Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Technical KPIs card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Résultats techniques</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {method === 'average_load' && (
                <>
                  <ResultRow label="Énergie journalière" value={fmt(r.e_jour_kwh, 1)} unit="kWh" />
                  <ResultRow label="Puissance PV finale" value={fmt(r.p_pv_final_kwc, 1)} unit="kWc" />
                  <ResultRow label="Nombre de modules" value={r.n_modules} />
                  <ResultRow label="Puissance crête" value={fmt(r.puissance_crete_kwc, 1)} unit="kWc" />
                  <ResultRow label="Batteries" value={r.nb_batteries} unit={`× ${scenario.params.battery_capacity_ah ?? 200} Ah`} />
                  <ResultRow label="Capacité batterie" value={fmtInt(r.battery_capacity_wh)} unit="Wh" />
                  <ResultRow label="Onduleur" value={fmtInt(r.inverter_w)} unit="W" />
                  <ResultRow label="Courant MPPT" value={r.mppt_current_a} unit="A" />
                  <ResultRow label="Production 24h" value={fmt(r.production_total_kwh, 1)} unit="kWh" />
                  <ResultRow label="Taux de couverture" value={fmt(r.coverage_pct, 1)} unit="%" highlight={r.coverage_pct >= 80} />
                  <ResultRow label="Surplus" value={fmt(r.surplus_kwh, 1)} unit="kWh" />
                  <ResultRow label="Déficit" value={fmt(r.deficit_kwh, 1)} unit="kWh" warn={r.deficit_kwh > 0} />
                </>
              )}
              {method === 'peak_demand' && (
                <>
                  <ResultRow label="Énergie journalière" value={fmt(r.e_jour_kwh, 1)} unit="kWh" />
                  <ResultRow label="P max (pointe)" value={fmt(r.p_max_kw, 1)} unit="kW" />
                  <ResultRow label="P moyenne" value={fmt(r.p_moy_kw, 1)} unit="kW" />
                  <ResultRow label="Facteur de charge" value={fmt(r.load_factor, 2)} />
                  <ResultRow label="P onduleur" value={fmt(r.p_ond_kw, 1)} unit="kW" />
                  <ResultRow label="S onduleur" value={fmt(r.s_ond_kva, 1)} unit="kVA" />
                  <ResultRow label="P surge" value={fmt(r.p_surge_kw, 1)} unit="kW" />
                  <ResultRow label="PV pic" value={fmt(r.p_pv_pic_kwc, 1)} unit="kWc" />
                  <ResultRow label="Modules" value={r.n_modules} />
                  <ResultRow label="Puissance crête" value={fmt(r.puissance_crete_kwc, 1)} unit="kWc" />
                  <ResultRow label="Ratio ond/PV" value={fmt(r.ratio_ond_pv, 2)} highlight={r.inverter_clipping_ok} warn={!r.inverter_clipping_ok} />
                  <ResultRow label="cos φ mesuré" value={fmt(r.cos_phi_measured, 3)} />
                </>
              )}
              {method === 'theoretical_production' && (
                <>
                  <ResultRow label="P installée" value={fmt(r.p_inst_kwc, 1)} unit="kWc" />
                  <ResultRow label="E théorique" value={fmt(r.e_th_kwh, 1)} unit="kWh" />
                  <ResultRow label="E réelle (×PR)" value={fmt(r.e_reelle_kwh, 1)} unit="kWh" />
                  <ResultRow label="P prod max" value={fmt(r.p_prod_max_kw, 1)} unit="kW" />
                  <ResultRow label="Heure de pic" value={fmt(r.t_pic_h, 1)} unit="h" />
                  <ResultRow label="HSP calculé" value={fmt(r.hsp_calc, 2)} unit="h" />
                </>
              )}
              {method === 'available_surface' && (
                <>
                  <ResultRow label="Surface utile" value={fmt(r.s_utile_m2, 0)} unit="m²" />
                  <ResultRow label="Modules max" value={r.n_mod_max} />
                  <ResultRow label="P installée max" value={fmt(r.p_inst_max_kwc, 1)} unit="kWc" />
                  <ResultRow label="E production" value={fmt(r.e_prod_kwh, 1)} unit="kWh/j" />
                  <ResultRow label="E demande" value={fmt(r.e_demand_kwh, 1)} unit="kWh/j" />
                  <ResultRow label="Taux couverture" value={fmt(r.coverage_pct, 1)} unit="%" highlight={r.coverage_pct >= 100} />
                  <ResultRow label="Delta E" value={fmt(r.delta_e_kwh, 1)} unit="kWh" highlight={r.delta_e_kwh >= 0} warn={r.delta_e_kwh < 0} />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Financial detail card */}
        {f && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Analyse financière</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ResultRow label="Coût installation" value={fmtInt(f.install_cost_xof)} unit="XOF" />
                <ResultRow label="Production annuelle" value={fmtInt(f.annual_production_kwh)} unit="kWh" />
                <ResultRow label="Économies annuelles" value={fmtInt(f.annual_savings_xof)} unit="XOF" />
                <ResultRow label="Retour sur invest." value={fmt(f.payback_years, 1)} unit="ans" highlight={f.payback_years != null && f.payback_years < 10} />
                <ResultRow label="ROI 25 ans" value={fmt(f.roi_25y_pct, 1)} unit="%" highlight={f.roi_25y_pct != null && f.roi_25y_pct > 100} />
                <ResultRow label="VAN (NPV)" value={fmtInt(f.npv_xof)} unit="XOF" highlight={f.npv_xof != null && f.npv_xof > 0} />
                <ResultRow label="CO₂ évité / an" value={fmtInt(f.co2_avoided_kg_year)} unit="kg" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Production Profile Chart (average_load) */}
      {productionProfile.length > 0 && method === 'average_load' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" />
              Profil production vs consommation (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={productionProfile}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h: number) => `${Math.floor(h)}h`} />
                <YAxis tick={{ fontSize: 10 }} unit=" W" />
                <Tooltip
                  labelFormatter={(h: number) => `${Math.floor(h)}h${(h % 1) * 60 > 0 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : '00'}`}
                  formatter={(v: number, name: string) => {
                    const labels: Record<string, string> = { production_w: 'Production', consumption_w: 'Consommation' };
                    return [`${v.toLocaleString('fr-FR')} W`, labels[name] ?? name];
                  }}
                />
                <Legend />
                <Area dataKey="production_w" name="Production" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={2} />
                <Area dataKey="consumption_w" name="Consommation" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* SOC Profile (average_load) */}
      {socProfile.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Battery className="w-4 h-4 text-green-500" />
              État de charge batterie (SOC)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={socProfile}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h: number) => `${Math.floor(h)}h`} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                <Tooltip
                  labelFormatter={(h: number) => `${Math.floor(h)}h`}
                  formatter={(v: number) => [`${v}%`, 'SOC']}
                />
                <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Min 20%', fontSize: 10, fill: '#ef4444' }} />
                <Line dataKey="soc_pct" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Theoretical production profile */}
      {productionProfile.length > 0 && method === 'theoretical_production' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" />
              Profil de production théorique (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={productionProfile}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h: number) => `${Math.floor(h)}h`} />
                <YAxis yAxisId="kw" tick={{ fontSize: 10 }} unit=" kW" />
                <YAxis yAxisId="irr" orientation="right" tick={{ fontSize: 10 }} unit=" kW/m²" />
                <Tooltip
                  labelFormatter={(h: number) => `${Math.floor(h)}h`}
                  formatter={(v: number, name: string) => {
                    const labels: Record<string, string> = { production_kw: 'Production', irradiance_kw_m2: 'Irradiance' };
                    return [v.toFixed(2), labels[name] ?? name];
                  }}
                />
                <Legend />
                <Line yAxisId="kw" dataKey="production_kw" name="Production (kW)" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line yAxisId="irr" dataKey="irradiance_kw_m2" name="Irradiance (kW/m²)" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Input parameters reference */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Paramètres d'entrée</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(scenario.params).map(([k, v]) => (
              <div key={k} className="text-xs">
                <span className="text-muted-foreground">{k}: </span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Computed at footer */}
      <div className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-1">
        <Clock className="w-3 h-3" />
        {scenario.computed_at ? `Calculé le ${new Date(scenario.computed_at).toLocaleString('fr-FR')}` : ''}
      </div>
    </div>
  );
}

function ResultRow({ label, value, unit, highlight, warn }: {
  label: string;
  value: string | number | undefined | null;
  unit?: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        'font-medium tabular-nums',
        highlight && 'text-green-600',
        warn && 'text-red-600',
      )}>
        {value ?? '—'}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

