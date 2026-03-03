import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAppContext } from '@/contexts/AppContext';
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
} from 'recharts';

// Steps
const steps = [
  { id: 1, label: 'Périmètre', icon: Zap },
  { id: 2, label: 'Paramètres PV', icon: Sun },
  { id: 3, label: 'Batterie', icon: Battery },
  { id: 4, label: 'Résultats', icon: TrendingUp },
];

// Mock ROI results
const cashFlowData = Array.from({ length: 20 }, (_, i) => ({
  year: `A${i + 1}`,
  cumulative: -18000000 + i * 2600000 + (i > 5 ? i * 350000 : 0),
  annual: 2500000 + Math.random() * 500000,
}));

const monthlyProductionEstimate = [
  { month: 'Jan', kwh: 5800 },
  { month: 'Fév', kwh: 6200 },
  { month: 'Mar', kwh: 7500 },
  { month: 'Avr', kwh: 7800 },
  { month: 'Mai', kwh: 7200 },
  { month: 'Jun', kwh: 6600 },
  { month: 'Jul', kwh: 5900 },
  { month: 'Aoû', kwh: 5700 },
  { month: 'Sep', kwh: 6400 },
  { month: 'Oct', kwh: 6900 },
  { month: 'Nov', kwh: 6100 },
  { month: 'Déc', kwh: 5500 },
];

export default function Predimensionnement() {
  const { selectedTerrain } = useAppContext();
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState({
    location: 'Ouagadougou, BF',
    latitude: 12.3714,
    longitude: -1.5197,
    roofArea: 500,
    pvCapacity: 50,
    tilt: 15,
    azimuth: 180,
    irradiance: 5.8,
    losses: 14,
    batteryCapacity: 100,
    batteryPower: 25,
    batteryEfficiency: 92,
    investment: 18000000,
    discount: 8,
    tariff: 105,
  });

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, 4));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 1));
  const setField = (key: keyof typeof form, value: number | string) => setForm((f) => ({ ...f, [key]: value }));

  // Estimated results
  const annualProd = form.pvCapacity * form.irradiance * 365 * (1 - form.losses / 100);
  const annualSavings = annualProd * form.tariff;
  const payback = form.investment / annualSavings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prédimensionnement PV + Batterie"
        description={`Simulation rapide — ${selectedTerrain?.name ?? 'Terrain'}`}
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
                <div
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    isCompleted ? 'bg-primary' : 'bg-muted'
                  )}
                />
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
                {isCompleted ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
                {step.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step content */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Périmètre du projet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Localisation</Label>
                <Input value={form.location} onChange={(e) => setField('location', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input type="number" value={form.latitude} onChange={(e) => setField('latitude', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input type="number" value={form.longitude} onChange={(e) => setField('longitude', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Surface disponible (m²)</Label>
                <Input type="number" value={form.roofArea} onChange={(e) => setField('roofArea', +e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Paramètres PV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacité PV (kWc)</Label>
                <Input type="number" value={form.pvCapacity} onChange={(e) => setField('pvCapacity', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Inclinaison (°)</Label>
                <Input type="number" value={form.tilt} onChange={(e) => setField('tilt', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Azimut (°)</Label>
                <Input type="number" value={form.azimuth} onChange={(e) => setField('azimuth', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Irradiance (kWh/m²/j)</Label>
                <Input type="number" step={0.1} value={form.irradiance} onChange={(e) => setField('irradiance', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Pertes système (%)</Label>
                <Input type="number" value={form.losses} onChange={(e) => setField('losses', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Investissement estimé (XOF)</Label>
                <Input type="number" value={form.investment} onChange={(e) => setField('investment', +e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Paramètres Batterie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacité batterie (kWh)</Label>
                <Input type="number" value={form.batteryCapacity} onChange={(e) => setField('batteryCapacity', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Puissance batterie (kW)</Label>
                <Input type="number" value={form.batteryPower} onChange={(e) => setField('batteryPower', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Efficacité aller-retour (%)</Label>
                <Input type="number" value={form.batteryEfficiency} onChange={(e) => setField('batteryEfficiency', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tarif électricité (XOF/kWh)</Label>
                <Input type="number" value={form.tariff} onChange={(e) => setField('tariff', +e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Taux d&apos;actualisation (%)</Label>
                <Input type="number" value={form.discount} onChange={(e) => setField('discount', +e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 4 && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Production annuelle</div>
              <div className="text-xl font-semibold">{Math.round(annualProd).toLocaleString('fr-FR')}</div>
              <div className="text-xs text-muted-foreground">kWh/an</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Économies annuelles</div>
              <div className="text-xl font-semibold">{Math.round(annualSavings).toLocaleString('fr-FR')}</div>
              <div className="text-xs text-muted-foreground">XOF/an</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Retour sur invest.</div>
              <div className="text-xl font-semibold">{payback.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">ans</div>
            </Card>
            <Card className="text-center p-4">
              <div className="text-xs text-muted-foreground mb-1">Autoconsommation</div>
              <div className="text-xl font-semibold">68%</div>
              <div className="text-xs text-muted-foreground">estimé</div>
            </Card>
          </div>

          {/* Monthly production chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Production mensuelle estimée</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyProductionEstimate}>
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

          {/* Cash flow chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Flux de trésorerie cumulé (20 ans)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cashFlowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip formatter={(val: number) => [`${(val / 1e6).toFixed(1)}M XOF`, 'Cumulé']} />
                    <Line dataKey="cumulative" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Badge variant="outline" className="text-[10px]">PV {form.pvCapacity} kWc</Badge>
                <Badge variant="outline" className="text-[10px]">Batterie {form.batteryCapacity} kWh</Badge>
                <Badge variant="outline" className="text-[10px]">Irradiance {form.irradiance} kWh/m²/j</Badge>
                <span className="text-muted-foreground ml-auto text-xs">
                  Simulation indicative – données à confirmer avec étude terrain
                </span>
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
        {currentStep < 4 ? (
          <Button onClick={goNext}>
            Suivant
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <Calculator className="w-4 h-4 mr-2" />
            Exporter le rapport (bientôt)
          </Button>
        )}
      </div>
    </div>
  );
}
