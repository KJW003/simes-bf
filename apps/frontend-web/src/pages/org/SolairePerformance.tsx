import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadialGauge } from '@/components/ui/radial-gauge';
import {
  Sun, Zap, Leaf, TrendingUp, Calculator, Battery,
  BarChart3, ArrowRight,
} from 'lucide-react';
import { useTerrainOverview, useReadings, useDashboard } from '@/hooks/useApi';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

// Monthly solar irradiance (kWh/m²/day) — Ouagadougou region
const MONTHLY_IRRADIANCE = [
  { month: 'Jan', ghi: 5.8 }, { month: 'Fév', ghi: 6.2 }, { month: 'Mar', ghi: 6.5 },
  { month: 'Avr', ghi: 6.3 }, { month: 'Mai', ghi: 5.9 }, { month: 'Jun', ghi: 5.5 },
  { month: 'Jul', ghi: 5.0 }, { month: 'Aoû', ghi: 4.8 }, { month: 'Sep', ghi: 5.2 },
  { month: 'Oct', ghi: 5.7 }, { month: 'Nov', ghi: 5.9 }, { month: 'Dec', ghi: 5.6 },
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function PvBattery() {
  return null;
}

export default function SolairePerformance() {
  const { selectedTerrainId, hasSolar } = useAppContext();
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const { data: dashData } = useDashboard(selectedTerrainId);

  // PV simulation parameters
  const [pvCapacity, setPvCapacity] = useState(10); // kWc
  const [systemLosses, setSystemLosses] = useState(14); // %
  const [tilt, setTilt] = useState(12); // degrees
  const electricityRate = prefs.tariffRate;

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const currentPowerKW = dashData?.power_now_kw ?? 0;
  const dailyImportKWh = dashData?.energy_today?.import_kwh ?? 0;

  // Identify PV-type points
  const pvPoints = useMemo(() => points.filter(p => p.measure_category === 'pv'), [points]);
  const hasPvData = pvPoints.length > 0;

  // Monthly production simulation
  const monthlyProduction = useMemo(() => {
    const lossMultiplier = 1 - systemLosses / 100;
    // Tilt correction (simplified: optimal at ~12° for Ouagadougou 12°N)
    const tiltFactor = 1 + 0.01 * Math.max(0, 15 - Math.abs(tilt - 12));

    return MONTHLY_IRRADIANCE.map((m, i) => {
      const dailyProd = pvCapacity * m.ghi * lossMultiplier * tiltFactor / 5.5; // Normalize to peak sun hours
      const monthlyProd = dailyProd * DAYS_IN_MONTH[i];
      return {
        month: m.month,
        production: Math.round(monthlyProd),
        irradiance: m.ghi,
        savings: Math.round(monthlyProd * electricityRate),
        co2Avoided: Math.round(monthlyProd * prefs.co2Factor),
      };
    });
  }, [pvCapacity, systemLosses, tilt, electricityRate]);

  const annualProd = monthlyProduction.reduce((s, m) => s + m.production, 0);
  const annualSavings = monthlyProduction.reduce((s, m) => s + m.savings, 0);
  const annualCO2 = monthlyProduction.reduce((s, m) => s + m.co2Avoided, 0);
  const specificYield = pvCapacity > 0 ? annualProd / pvCapacity : 0;
  const performanceRatio = pvCapacity > 0 ? (annualProd / (pvCapacity * 365 * 5.5)) * 100 : 0;

  // Self-consumption estimation (what % of PV can the site absorb)
  const annualConsumption = dailyImportKWh * 365;
  const selfConsumptionRate = annualConsumption > 0 ? Math.min(100, (annualProd / annualConsumption) * 100) : 0;

  // Payback estimation
  const pvCostPerKWc = 850_000; // ~850k FCFA/kWc installed (market avg West Africa)
  const totalInvestment = pvCapacity * pvCostPerKWc;
  const paybackYears = annualSavings > 0 ? totalInvestment / annualSavings : Infinity;

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Solaire" description="Performance des installations solaires" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Performance solaire"
        description="Simulation de production PV et analyse de rentabilité"
        actions={
          <Link to="/org/predimensionnement">
            <Button variant="outline" size="sm">
              <Calculator className="w-4 h-4 mr-1" />
              Prédimensionnement avancé
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        }
      />

      {/* PV parameters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" />
            Paramètres de l'installation PV
            {hasPvData && <Badge className="ml-auto text-[10px] bg-green-100 text-green-700">{pvPoints.length} point(s) PV détecté(s)</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Capacité installée (kWc)</label>
              <Input type="number" min={1} max={500} value={pvCapacity} onChange={e => setPvCapacity(+e.target.value || 1)} className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Pertes système (%)</label>
              <Input type="number" min={5} max={30} value={systemLosses} onChange={e => setSystemLosses(+e.target.value || 14)} className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Inclinaison (°)</label>
              <Input type="number" min={0} max={45} value={tilt} onChange={e => setTilt(+e.target.value || 12)} className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Lieu</label>
              <div className="text-sm font-medium mt-2">Ouagadougou (12.4°N)</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI gauges + cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Production annuelle" value={annualProd >= 1000 ? `${(annualProd / 1000).toFixed(1)}` : String(annualProd)} unit={annualProd >= 1000 ? 'MWh' : 'kWh'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="Rendement spécifique" value={String(Math.round(specificYield))} unit="kWh/kWc" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Économies annuelles" value={annualSavings >= 1_000_000 ? `${(annualSavings / 1_000_000).toFixed(1)}M` : `${(annualSavings / 1000).toFixed(0)}k`} unit={currSym} icon={<BarChart3 className="w-4 h-4" />} />
        <KpiCard label="CO₂ évité" value={String(Math.round(annualCO2 / 1000))} unit="t/an" icon={<Leaf className="w-4 h-4" />} />
        <KpiCard
          label="Retour sur investissement"
          value={paybackYears < 50 ? paybackYears.toFixed(1) : '—'}
          unit="ans"
          icon={<Battery className="w-4 h-4" />}
          variant={paybackYears < 7 ? 'success' : paybackYears < 12 ? 'warning' : 'critical'}
        />
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Indicateurs de performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-around">
              <RadialGauge
                value={performanceRatio}
                min={0} max={100}
                label="Performance Ratio"
                unit="%"
                size={140}
                thresholds={[
                  { value: 0, color: '#ef4444' },
                  { value: 60, color: '#f59e0b' },
                  { value: 75, color: '#10b981' },
                ]}
              />
              <RadialGauge
                value={selfConsumptionRate}
                min={0} max={100}
                label="Autoconsommation"
                unit="%"
                size={140}
                thresholds={[
                  { value: 0, color: '#10b981' },
                  { value: 70, color: '#f59e0b' },
                  { value: 100, color: '#ef4444' },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {/* Investment summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Résumé financier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Investissement estimé</span>
                <span className="font-medium mono">{(totalInvestment / 1_000_000).toFixed(1)} M {currSym}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Économies annuelles</span>
                <span className="font-medium mono text-green-600">{(annualSavings / 1_000_000).toFixed(2)} M {currSym}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Retour sur investissement</span>
                <span className="font-medium mono">{paybackYears < 50 ? `${paybackYears.toFixed(1)} ans` : 'Non rentable'}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Durée de vie PV</span>
                <span className="font-medium mono">25 ans</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gains totaux sur 25 ans (estimés)</span>
                <span className="font-semibold mono text-green-700">
                  {((annualSavings * 25 - totalInvestment) / 1_000_000).toFixed(1)} M {currSym}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly production chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" />
            Production mensuelle estimée
            <Badge variant="outline" className="text-[10px] ml-auto">{pvCapacity} kWc — {annualProd.toLocaleString()} kWh/an</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyProduction}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit=" kWh" />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => {
                const labels: Record<string, string> = { production: 'Production', savings: `Économies (${currSym})`, co2Avoided: 'CO₂ évité (kg)' };
                return [v.toLocaleString(), labels[name] ?? name];
              }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => {
                const labels: Record<string, string> = { production: 'Production (kWh)', savings: `Économies (${currSym})` };
                return labels[v] ?? v;
              }} />
              <Bar dataKey="production" fill="#f59e0b" radius={[4, 4, 0, 0]} name="production" />
              <ReferenceLine y={annualProd / 12} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Moy', position: 'right', fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Solar irradiance chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" />
            Irradiance solaire — Ouagadougou
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={MONTHLY_IRRADIANCE}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit=" kWh/m²/j" />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(1)} kWh/m²/jour`, 'GHI']} />
              <Area type="monotone" dataKey="ghi" stroke="#f59e0b" fill="#f59e0b20" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}