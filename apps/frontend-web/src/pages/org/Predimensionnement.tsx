import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAppContext } from '@/contexts/AppContext';
import { useCreateSolarScenario, useSolarScenarios } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Sun,
  Battery,
  Calculator,
  TrendingUp,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Zap,
  Loader2,
  History,
  Maximize2,
  Gauge,
  BarChart3,
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';

type SolarMethod = 'average_load' | 'peak_demand' | 'theoretical_production' | 'available_surface';

const METHODS: { id: SolarMethod; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'average_load', label: 'Charge moyenne', icon: Zap, desc: 'Dimensionnement basé sur la consommation moyenne 24h' },
  { id: 'peak_demand', label: 'Puissance de pointe', icon: Gauge, desc: 'Dimensionnement basé sur la demande maximale' },
  { id: 'theoretical_production', label: 'Production théorique', icon: Sun, desc: 'Modèle gaussien d\'irradiance avec dérating thermique' },
  { id: 'available_surface', label: 'Surface disponible', icon: Maximize2, desc: 'Dimensionnement maximal selon la surface de toiture' },
];

// Steps per method
const STEPS_BY_METHOD: Record<SolarMethod, { id: number; label: string; icon: React.ElementType }[]> = {
  average_load: [
    { id: 1, label: 'Méthode', icon: Calculator },
    { id: 2, label: 'Paramètres PV', icon: Sun },
    { id: 3, label: 'Batterie', icon: Battery },
    { id: 4, label: 'Résumé & Lancement', icon: TrendingUp },
  ],
  peak_demand: [
    { id: 1, label: 'Méthode', icon: Calculator },
    { id: 2, label: 'Paramètres PV', icon: Sun },
    { id: 3, label: 'Onduleur', icon: Zap },
    { id: 4, label: 'Résumé & Lancement', icon: TrendingUp },
  ],
  theoretical_production: [
    { id: 1, label: 'Méthode', icon: Calculator },
    { id: 2, label: 'Irradiance', icon: Sun },
    { id: 3, label: 'Module', icon: BarChart3 },
    { id: 4, label: 'Résumé & Lancement', icon: TrendingUp },
  ],
  available_surface: [
    { id: 1, label: 'Méthode', icon: Calculator },
    { id: 2, label: 'Surface & Module', icon: Maximize2 },
    { id: 3, label: 'Production', icon: Sun },
    { id: 4, label: 'Résumé & Lancement', icon: TrendingUp },
  ],
};

// Monthly irradiance factors for Ouagadougou region (ratio of daily avg)
const MONTHLY_IRRADIANCE_FACTORS = [0.88, 0.94, 1.06, 1.10, 1.04, 0.96, 0.88, 0.85, 0.94, 1.02, 0.96, 0.86];
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const fmt = (v: number) => v.toLocaleString('fr-FR');

// Default params per method (mirrors backend METHOD_DEFAULTS)
const DEFAULTS: Record<SolarMethod, Record<string, number>> = {
  average_load: {
    hsp: 5.5, eta_sys: 0.80, k_sec: 1.20, p_module: 400,
    autonomy_days: 2, battery_capacity_ah: 200, system_voltage: 48,
    lever_soleil: 6.0, coucher_soleil: 18.5,
    rendement_onduleur: 0.95, profondeur_decharge: 0.80,
  },
  peak_demand: {
    hsp: 5.5, eta_sys: 0.80, k_sec: 1.20, p_module: 400,
    cos_phi: 0.90, k_ond: 1.30,
  },
  theoretical_production: {
    gj: 5.5, t_lever: 6.0, t_coucher: 18.0, pr: 0.78,
    eta_mod: 0.20, eta_inv: 0.96, gamma_t: -0.004,
    t_amb: 35, t_noct: 45, p_inst: 50,
  },
  available_surface: {
    s_tot: 500, k_occ: 0.70, s_mod: 1.65, p_module: 400, hsp: 5.5, pr: 0.78,
  },
};

const PARAM_LABELS: Record<string, { label: string; unit?: string; step?: number }> = {
  hsp: { label: 'Heures solaires de pointe (HSP)', unit: 'h/j', step: 0.1 },
  eta_sys: { label: 'Rendement système', step: 0.01 },
  k_sec: { label: 'Coeff. sécurité', step: 0.05 },
  p_module: { label: 'Puissance module', unit: 'Wc' },
  autonomy_days: { label: 'Jours d\'autonomie', unit: 'j' },
  battery_capacity_ah: { label: 'Capacité batterie unitaire', unit: 'Ah' },
  system_voltage: { label: 'Tension système', unit: 'V' },
  lever_soleil: { label: 'Lever du soleil', unit: 'h', step: 0.5 },
  coucher_soleil: { label: 'Coucher du soleil', unit: 'h', step: 0.5 },
  rendement_onduleur: { label: 'Rendement onduleur', step: 0.01 },
  profondeur_decharge: { label: 'Profondeur de décharge', step: 0.05 },
  cos_phi: { label: 'Facteur de puissance (cos φ)', step: 0.01 },
  k_ond: { label: 'Coeff. surdimensionnement onduleur', step: 0.05 },
  gj: { label: 'Irradiance journalière (Gj)', unit: 'kWh/m²/j', step: 0.1 },
  t_lever: { label: 'Heure lever', unit: 'h', step: 0.5 },
  t_coucher: { label: 'Heure coucher', unit: 'h', step: 0.5 },
  pr: { label: 'Performance ratio (PR)', step: 0.01 },
  eta_mod: { label: 'Rendement module', step: 0.01 },
  eta_inv: { label: 'Rendement onduleur', step: 0.01 },
  gamma_t: { label: 'Coeff. température (γ)', unit: '/°C', step: 0.001 },
  t_amb: { label: 'Température ambiante', unit: '°C' },
  t_noct: { label: 'Température NOCT', unit: '°C' },
  p_inst: { label: 'Puissance installée', unit: 'kWc' },
  s_tot: { label: 'Surface totale', unit: 'm²' },
  k_occ: { label: 'Coeff. occupation', step: 0.05 },
  s_mod: { label: 'Surface module', unit: 'm²', step: 0.01 },
  install_cost_per_kwc: { label: 'Coût installation', unit: 'XOF/kWc' },
  electricity_rate: { label: 'Tarif électricité', unit: 'XOF/kWh' },
};

// Which params go in which step for each method
const STEP_PARAMS: Record<SolarMethod, Record<number, string[]>> = {
  average_load: {
    2: ['hsp', 'eta_sys', 'k_sec', 'p_module', 'lever_soleil', 'coucher_soleil'],
    3: ['autonomy_days', 'battery_capacity_ah', 'system_voltage', 'rendement_onduleur', 'profondeur_decharge'],
  },
  peak_demand: {
    2: ['hsp', 'eta_sys', 'k_sec', 'p_module'],
    3: ['cos_phi', 'k_ond'],
  },
  theoretical_production: {
    2: ['gj', 't_lever', 't_coucher', 'pr'],
    3: ['p_inst', 'eta_mod', 'eta_inv', 'gamma_t', 't_amb', 't_noct'],
  },
  available_surface: {
    2: ['s_tot', 'k_occ', 's_mod', 'p_module'],
    3: ['hsp', 'pr'],
  },
};

export default function Predimensionnement() {
  const { selectedTerrain, selectedTerrainId } = useAppContext();
  const navigate = useNavigate();
  const createScenario = useCreateSolarScenario();
  const { data: scenariosData } = useSolarScenarios(selectedTerrainId, { limit: 5 });
  const scenariosCount = scenariosData?.total ?? 0;

  const [method, setMethod] = useState<SolarMethod>('average_load');
  const [currentStep, setCurrentStep] = useState(1);
  const [params, setParams] = useState<Record<string, number>>({ ...DEFAULTS.average_load });
  const [scenarioName, setScenarioName] = useState('');

  const steps = STEPS_BY_METHOD[method];
  const maxStep = steps.length;

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, maxStep));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 1));

  const handleMethodChange = (m: SolarMethod) => {
    setMethod(m);
    setParams({ ...DEFAULTS[m] });
    setCurrentStep(2);
  };

  const setParam = (key: string, value: number) => setParams((p) => ({ ...p, [key]: value }));

  // Quick client-side preview (step 4)
  const pvKwc = params.p_inst || (params.p_module && params.k_sec ? ((params.hsp ? 10 / params.eta_sys / params.hsp : 10) * params.k_sec) : 50);
  const irr = params.hsp || params.gj || 5.5;
  const annualProdEst = pvKwc * irr * 365 * (params.pr || params.eta_sys || 0.80);
  const rate = params.electricity_rate || 110;
  const costPerKwc = params.install_cost_per_kwc || 750000;
  const installCost = pvKwc * costPerKwc;
  const annualSavings = annualProdEst * rate;
  const payback = annualSavings > 0 ? installCost / annualSavings : Infinity;

  const monthlyEst = useMemo(() =>
    MONTHS.map((month, i) => ({
      month,
      kwh: Math.round(pvKwc * irr * MONTHLY_IRRADIANCE_FACTORS[i] * DAYS_IN_MONTH[i] * (params.pr || params.eta_sys || 0.80)),
    })),
    [pvKwc, irr, params.pr, params.eta_sys],
  );

  const handleSubmit = async () => {
    if (!selectedTerrainId) return;
    try {
      const res = await createScenario.mutateAsync({
        terrain_id: selectedTerrainId,
        name: scenarioName || `Scénario ${METHODS.find(m => m.id === method)?.label}`,
        method,
        params,
      });
      navigate(`/solar-history/${res.scenario_id}`);
    } catch { /* handled by mutation */ }
  };

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Prédimensionnement solaire" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prédimensionnement solaire"
        description={`Simulation PV + Batterie — ${selectedTerrain?.name ?? 'Terrain'}`}
        actions={
          <div className="flex items-center gap-2">
            {scenariosCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/solar-history')}>
                <History className="w-4 h-4 mr-2" />
                Historique ({scenariosCount})
              </Button>
            )}
          </div>
        }
      />

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isCompleted = currentStep > step.id;
          const isCurrent = currentStep === step.id;
          return (
            <React.Fragment key={step.id}>
              {i > 0 && (
                <div className={cn('h-0.5 flex-1 rounded-full', isCompleted ? 'bg-primary' : 'bg-muted')} />
              )}
              <button
                onClick={() => setCurrentStep(step.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  isCurrent && 'bg-primary text-primary-foreground',
                  isCompleted && 'bg-primary/10 text-primary',
                  !isCurrent && !isCompleted && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? <CheckCircle className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                {step.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1: Method selection */}
      {currentStep === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {METHODS.map((m) => {
            const Icon = m.icon;
            const isSelected = method === m.id;
            return (
              <Card
                key={m.id}
                className={cn(
                  'cursor-pointer transition-all hover:shadow-md',
                  isSelected && 'ring-2 ring-primary shadow-md'
                )}
                onClick={() => handleMethodChange(m.id)}
              >
                <CardContent className="py-5">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'p-2 rounded-lg',
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{m.desc}</div>
                    </div>
                    {isSelected && <CheckCircle className="w-4 h-4 text-primary mt-0.5" />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Steps 2 & 3: Parameter forms */}
      {(currentStep === 2 || currentStep === 3) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{steps[currentStep - 1].label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(STEP_PARAMS[method][currentStep] ?? []).map((key) => {
                const info = PARAM_LABELS[key] ?? { label: key };
                return (
                  <div key={key} className="space-y-2">
                    <Label>{info.label}{info.unit ? ` (${info.unit})` : ''}</Label>
                    <Input
                      type="number"
                      step={info.step ?? 1}
                      value={params[key] ?? 0}
                      onChange={(e) => setParam(key, +e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Summary + Launch */}
      {currentStep === maxStep && (
        <div className="space-y-4">
          {/* Name input */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <Label>Nom du scénario</Label>
                  <Input
                    placeholder={`Scénario ${METHODS.find(m => m.id === method)?.label}`}
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                  />
                </div>
                <Badge variant="outline" className="text-[10px]">{METHODS.find(m => m.id === method)?.label}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Quick preview KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">PV estimé</div>
              <div className="text-xl font-semibold">{pvKwc.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">kWc</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Production annuelle</div>
              <div className="text-xl font-semibold">{fmt(Math.round(annualProdEst))}</div>
              <div className="text-xs text-muted-foreground">kWh/an (est.)</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Investissement</div>
              <div className="text-xl font-semibold">{fmt(Math.round(installCost / 1e6))}M</div>
              <div className="text-xs text-muted-foreground">XOF</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Retour sur invest.</div>
              <div className="text-xl font-semibold">{payback < 100 ? payback.toFixed(1) : '—'}</div>
              <div className="text-xs text-muted-foreground">ans (est.)</div>
            </Card>
          </div>

          {/* Monthly estimate chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Production mensuelle estimée (aperçu)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyEst}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(val: number) => [`${val.toLocaleString('fr-FR')} kWh`, 'Production']} />
                    <Bar dataKey="kwh" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Parameters summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Paramètres envoyés au calcul</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(params).map(([k, v]) => {
                  const info = PARAM_LABELS[k];
                  return (
                    <div key={k} className="text-xs">
                      <span className="text-muted-foreground">{info?.label ?? k}: </span>
                      <span className="font-medium">{v}{info?.unit ? ` ${info.unit}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={currentStep === 1} onClick={goPrev}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Précédent
        </Button>
        {currentStep < maxStep ? (
          <Button onClick={goNext}>
            Suivant
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={createScenario.isPending}>
            {createScenario.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4 mr-2" />
            )}
            Lancer le calcul serveur
          </Button>
        )}
      </div>
    </div>
  );
}
