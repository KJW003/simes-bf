import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAppContext } from '@/contexts/AppContext';
import { useSubmitFacture, useFactureResult, useLatestFacture } from '@/hooks/useApi';
import {
  Receipt, Zap, Clock, TrendingUp, FileText, AlertTriangle,
  Loader2, CheckCircle2, Calculator,
} from 'lucide-react';

type TariffPlan = { label: string; hpRate: number; peakRate: number; monthlyRedevance: number; primePerKw: number };
type TariffGroupPreset = { hours: { hp: string; peak: string }; plans: Record<string, TariffPlan> };

const TARIFF_PRESETS: Record<string, TariffGroupPreset> = {
  D: {
    hours: { hp: '00:00-17:00', peak: '17:00-24:00' },
    plans: {
      D1: { label: 'D1 Non-industriel', hpRate: 88, peakRate: 165, monthlyRedevance: 8538, primePerKw: 2882 },
      D2: { label: 'D2 Industriel', hpRate: 75, peakRate: 140, monthlyRedevance: 7115, primePerKw: 2402 },
      D3: { label: 'D3 Special', hpRate: 160, peakRate: 160, monthlyRedevance: 8538, primePerKw: 2882 },
    },
  },
  E: {
    hours: { hp: '00:00-17:00', peak: '17:00-24:00' },
    plans: {
      E1: { label: 'E1 Non-industriel', hpRate: 64, peakRate: 139, monthlyRedevance: 8538, primePerKw: 5903 },
      E2: { label: 'E2 Industriel', hpRate: 54, peakRate: 118, monthlyRedevance: 7115, primePerKw: 5366 },
      E3: { label: 'E3 Special', hpRate: 160, peakRate: 160, monthlyRedevance: 8538, primePerKw: 5903 },
    },
  },
  G: {
    hours: { hp: '00:00-10:00', peak: '10:00-24:00' },
    plans: {
      G: { label: 'G', hpRate: 70, peakRate: 140, monthlyRedevance: 7115, primePerKw: 5366 },
    },
  },
};

const formatCurrency = (value: number) => value.toLocaleString('fr-FR');

export default function Invoice() {
  const { selectedTerrain, currentUser } = useAppContext();
  const isAdmin = currentUser.role === 'org_admin';

  const [tariffGroup, setTariffGroup] = useState('D');
  const [tariffPlan, setTariffPlan] = useState('D1');
  const [peakHours, setPeakHours] = useState(TARIFF_PRESETS.D.hours.peak);
  const [offPeakHours, setOffPeakHours] = useState(TARIFF_PRESETS.D.hours.hp);
  const [hpRate, setHpRate] = useState(String(TARIFF_PRESETS.D.plans.D1.hpRate));
  const [peakRate, setPeakRate] = useState(String(TARIFF_PRESETS.D.plans.D1.peakRate));
  const [monthlyRedevance, setMonthlyRedevance] = useState(String(TARIFF_PRESETS.D.plans.D1.monthlyRedevance));
  const [primePerKw, setPrimePerKw] = useState(String(TARIFF_PRESETS.D.plans.D1.primePerKw));
  const [subscribedPower, setSubscribedPower] = useState('100');

  const [runId, setRunId] = useState<string | null>(null);
  const submitFacture = useSubmitFacture();
  const { data: apiFacture, isLoading: pollingFacture } = useFactureResult(runId);
  const { data: latestFacture } = useLatestFacture();

  const liveResult = (apiFacture ?? latestFacture) as Record<string, unknown> | null;
  const hasLiveResult = !!liveResult;

  const handleCalculate = async () => {
    if (!selectedTerrain) return;
    try {
      const run = await submitFacture.mutateAsync({
        terrain_id: selectedTerrain.id,
        subscribed_power_kw: Number(subscribedPower) || 100,
      });
      setRunId(run.id);
    } catch (e) {
      console.error('Erreur soumission facture:', e);
    }
  };

  const applyPreset = (group: string, planKey: string) => {
    const preset = TARIFF_PRESETS[group];
    const plan = preset.plans[planKey];
    if (!plan) return;
    setPeakHours(preset.hours.peak);
    setOffPeakHours(preset.hours.hp);
    setHpRate(String(plan.hpRate));
    setPeakRate(String(plan.peakRate));
    setMonthlyRedevance(String(plan.monthlyRedevance));
    setPrimePerKw(String(plan.primePerKw));
  };

  const handleGroupChange = (value: string) => {
    setTariffGroup(value);
    const firstPlan = Object.keys(TARIFF_PRESETS[value].plans)[0];
    setTariffPlan(firstPlan);
    applyPreset(value, firstPlan);
  };

  const handlePlanChange = (value: string) => {
    setTariffPlan(value);
    applyPreset(tariffGroup, value);
  };

  const apiBreakdown = hasLiveResult ? (liveResult.breakdown as Array<{ key: string; label: string; kwh: number | null; rate: number | null; amount: number }>) : null;
  const apiTotal = hasLiveResult ? Number(liveResult.totalAmount ?? 0) : 0;
  const apiTotalKwh = hasLiveResult ? Number(liveResult.totalKwh ?? 0) : 0;
  const apiMaxDemand = hasLiveResult ? Number(liveResult.maxDemandKw ?? 0) : 0;
  const apiPlanName = hasLiveResult ? String(liveResult.tariffVersionName ?? '') : '';

  const planLabel = TARIFF_PRESETS[tariffGroup].plans[tariffPlan]?.label ?? tariffPlan;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description={"Estimation de facture - " + (selectedTerrain?.name ?? 'Site')}
        actions={
          <div className="flex gap-2">
            {selectedTerrain && (
              <Button size="sm" onClick={handleCalculate} disabled={submitFacture.isPending || pollingFacture}>
                {submitFacture.isPending || pollingFacture ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4 mr-2" />
                )}
                Calculer (API)
              </Button>
            )}
            <Button variant="outline" size="sm">
              <FileText className="w-4 h-4 mr-2" />
              Exporter PDF
            </Button>
          </div>
        }
      />

      {hasLiveResult && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          <div>
            Facture calculee via l API a partir des donnees reelles.
            {apiPlanName && <> Plan: <span className="font-medium">{apiPlanName}</span></>}
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] badge-ok">API</Badge>
        </div>
      )}

      {hasLiveResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
          <KpiCard label="Total" value={(apiTotal / 1000000).toFixed(1) + 'M'} unit="XOF" icon={<Receipt className="w-4 h-4" />} />
          <KpiCard label="Consommation" value={(apiTotalKwh / 1000).toFixed(1)} unit="MWh" icon={<Zap className="w-4 h-4" />} />
          <KpiCard label="Puissance max" value={apiMaxDemand.toFixed(1)} unit="kW" icon={<TrendingUp className="w-4 h-4" />} />
          <KpiCard label="Heures de pointe" value={peakHours} icon={<Clock className="w-4 h-4" />} />
        </div>
      )}

      <div className="rounded-lg border border-severity-warning/30 bg-severity-warning-bg/40 px-4 py-3 text-sm text-severity-warning-foreground flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <div>PF (cos phi) &lt; 0.93 peut declencher des penalites (non calculees en V1).</div>
      </div>

      {apiBreakdown && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-medium">Facture SONABEL (donnees reelles)</CardTitle>
              <Badge variant="outline" className="text-xs badge-ok">{apiPlanName}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <table className="data-table">
              <thead>
                <tr className="bg-muted/50">
                  <th>Categorie</th>
                  <th className="text-right">kWh</th>
                  <th className="text-right">Tarif (XOF)</th>
                  <th className="text-right">Montant (XOF)</th>
                </tr>
              </thead>
              <tbody>
                {apiBreakdown.map((row) => (
                  <tr key={row.key}>
                    <td className="font-medium">{row.label}</td>
                    <td className="text-right mono">{row.kwh != null ? formatCurrency(Math.round(row.kwh)) : '-'}</td>
                    <td className="text-right mono">{row.rate != null ? formatCurrency(Number(row.rate)) : '-'}</td>
                    <td className="text-right mono font-medium">{formatCurrency(Math.round(row.amount))}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold">
                  <td>Total TTC</td>
                  <td className="text-right mono">{formatCurrency(Math.round(apiTotalKwh))}</td>
                  <td></td>
                  <td className="text-right mono">{formatCurrency(Math.round(apiTotal))}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!hasLiveResult && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucune facture calculee. Cliquez sur "Calculer (API)" pour lancer le calcul.
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Configuration tarifaire (SONABEL Oct-2023)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Groupe tarifaire</Label>
                <Select value={tariffGroup} onValueChange={handleGroupChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="D">D</SelectItem>
                    <SelectItem value="E">E</SelectItem>
                    <SelectItem value="G">G</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Plan tarifaire</Label>
                <Select value={tariffPlan} onValueChange={handlePlanChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TARIFF_PRESETS[tariffGroup].plans).map(([key, plan]) => (
                      <SelectItem key={key} value={key}>{key} - {plan.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Puissance souscrite (PS, kW)</Label>
                <Input value={subscribedPower} onChange={(e) => setSubscribedPower(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Tarif kWh HP (XOF)</Label>
                <Input value={hpRate} onChange={(e) => setHpRate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tarif kWh HPointe (XOF)</Label>
                <Input value={peakRate} onChange={(e) => setPeakRate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Redevance mensuelle (XOF)</Label>
                <Input value={monthlyRedevance} onChange={(e) => setMonthlyRedevance(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Prime par kW (XOF)</Label>
                <Input value={primePerKw} onChange={(e) => setPrimePerKw(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}