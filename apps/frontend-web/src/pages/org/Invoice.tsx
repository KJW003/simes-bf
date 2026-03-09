import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/contexts/AppContext';
import { useSubmitFacture, useFactureResult, useLatestFacture } from '@/hooks/useApi';
import {
  Receipt, Zap, Clock, TrendingUp, FileText, AlertTriangle,
  Loader2, CheckCircle2, Calculator, Info,
} from 'lucide-react';
import { usePreferences, TARIFF_PRESETS } from '@/hooks/usePreferences';

const formatCurrency = (value: number) => value.toLocaleString('fr-FR');

export default function Invoice() {
  const { selectedTerrain } = useAppContext();
  const prefs = usePreferences();

  const peakHours = TARIFF_PRESETS[prefs.tariffGroup]?.hours.peak ?? '17:00-24:00';

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
        subscribed_power_kw: prefs.subscribedPowerKw,
      });
      setRunId(run.id);
    } catch (e) {
      console.error('Erreur soumission facture:', e);
    }
  };

  const apiBreakdown = hasLiveResult ? (liveResult.breakdown as Array<{ key: string; label: string; kwh: number | null; rate: number | null; amount: number }>) : null;
  const apiTotal = hasLiveResult ? Number(liveResult.totalAmount ?? 0) : 0;
  const apiTotalKwh = hasLiveResult ? Number(liveResult.totalKwh ?? 0) : 0;
  const apiMaxDemand = hasLiveResult ? Number(liveResult.maxDemandKw ?? 0) : 0;
  const apiPlanName = hasLiveResult ? String(liveResult.tariffVersionName ?? '') : '';

  const planLabel = TARIFF_PRESETS[prefs.tariffGroup]?.plans[prefs.tariffPlan]?.label ?? prefs.tariffPlan;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description={"Estimation de facture – " + (selectedTerrain?.name ?? 'Site')}
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

      {/* Preview banner */}
      <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm flex items-start gap-3 text-amber-800 dark:text-amber-200">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">Module en préversion</span> — les calculs sont indicatifs et basés sur le plan <span className="font-medium">{planLabel}</span> (PS {prefs.subscribedPowerKw} kW).
          Modifiez les paramètres tarifaires dans <span className="font-medium">Paramètres → Configuration tarifaire</span>.
        </div>
      </div>

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
            <div className="table-responsive">
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
            </div>
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
    </div>
  );
}