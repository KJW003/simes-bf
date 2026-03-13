// ==================================================
// IMPROVED Invoice Page – Better UX
// ==================================================
// This is a reference implementation showing:
// 1. Simplified contract section (optional fields hidden)
// 2. Better table grouping with visual sections
// 3. Clear KPI display with warnings
// 4. Toast feedback instead of tiny status text
// ==================================================

import React, { useCallback, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/select';
import { useAppContext } from '@/contexts/AppContext';
import { useSubmitFacture, useFactureResult, useTariffPlans, useTerrainContract, useSaveTerrainContract } from '@/hooks/useApi';
import { Receipt, Zap, TrendingUp, AlertTriangle, Loader2, FileText, Calculator, Settings2, Check, ChevronDown } from 'lucide-react';

const formatCurrency = (value: number) => value.toLocaleString('fr-FR');

export default function InvoiceImproved() {
  const { selectedTerrain } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;

  // Contract
  const { data: contractData } = useTerrainContract(terrainId);
  const { data: tariffData } = useTariffPlans();
  const saveContract = useSaveTerrainContract();

  const hasContract = !!contractData;
  const [contractForm, setContractForm] = useState({
    tariff_plan_id: String(contractData?.tariff_plan_id ?? ''),
    subscribed_power_kw: Number(contractData?.subscribed_power_kw ?? 100),
  });
  const [showOptional, setShowOptional] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleSaveContract = async () => {
    try {
      await saveContract.mutateAsync({ terrainId: terrainId!, data: contractForm as any });
      setToastMessage('✅ Contrat mis à jour');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (e) {
      setToastMessage('❌ Erreur de sauvegarde');
    }
  };

  // Facture
  const [selectedMonth, setSelectedMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
  const [runId, setRunId] = useState<string | null>(null);
  const submitFacture = useSubmitFacture();
  const { data: apiFacture, isLoading: pollingFacture } = useFactureResult(runId);

  const liveResult = apiFacture as Record<string, unknown> | null;
  const hasLiveResult = !!liveResult;

  const apiTotal = hasLiveResult ? Number(liveResult.totalAmount ?? 0) : 0;
  const apiTotalKwh = hasLiveResult ? Number(liveResult.totalKwh ?? 0) : 0;
  const apiMaxPower = hasLiveResult ? Number(liveResult.maxDemandKw ?? 0) : 0;
  const apiCosPhi = hasLiveResult ? Number(liveResult.cosPhi ?? 0) : 0;
  const apiKma = hasLiveResult ? Number(liveResult.Kma ?? 1) : 1;
  const apiBreakdown = hasLiveResult ? (liveResult.breakdown as Array<any>) : null;

  const hasPfWarning = apiCosPhi > 0 && apiCosPhi < 0.93;

  const handleCalculate = async () => {
    if (!selectedTerrain || !hasContract) return;
    try {
      const run = await submitFacture.mutateAsync({
        terrain_id: selectedTerrain.id,
      });
      setRunId(run.id);
    } catch (e) {
      setToastMessage('❌ Erreur calcul facture');
    }
  };

  const handleExportPDF = useCallback(() => {
    if (!apiBreakdown) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Facture</title>
<style>
  body { font-family: Arial; margin: 40px; color: #333; }
  h1 { color: #1a56db; border-bottom: 2px solid #1a56db; padding-bottom: 8px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .kpi { border: 1px solid #ddd; padding: 12px; text-align: center; border-radius: 6px; }
  .kpi-value { font-size: 20px; font-weight: bold; color: #1a56db; }
  .kpi-label { font-size: 12px; color: #888; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f5f5f5; font-weight: bold; }
  .r { text-align: right; }
  .total { background: #f0f4ff; font-weight: bold; }
  .warning { background: #fef3c7; color: #b45309; padding: 10px; margin: 12px 0; border-radius: 6px; }
</style></head><body>
<h1>Facture Estimation — ${selectedTerrain?.name ?? 'Terrain'}</h1>
<div class="kpis">
  <div class="kpi"><div class="kpi-value">${formatCurrency(Math.round(apiTotal))}</div><div class="kpi-label">Total TTC (XOF)</div></div>
  <div class="kpi"><div class="kpi-value">${(apiTotalKwh / 1000).toFixed(1)}</div><div class="kpi-label">Consommation (MWh)</div></div>
  <div class="kpi"><div class="kpi-value">${apiMaxPower.toFixed(1)}</div><div class="kpi-label">Puissance max (kW)</div></div>
  <div class="kpi"><div class="kpi-value">${apiCosPhi.toFixed(3)}</div><div class="kpi-label">cos φ</div></div>
</div>
${hasPfWarning ? `<div class="warning">⚠ cos φ = ${apiCosPhi.toFixed(3)} &lt; 0.93 — Pénalité Kma = ${apiKma.toFixed(3)} appliquée</div>` : ''}
<table>
  <thead><tr><th>Catégorie</th><th class="r">kWh</th><th class="r">Tarif (XOF)</th><th class="r">Montant (XOF)</th></tr></thead>
  <tbody>
    ${apiBreakdown?.map((r: any) => `<tr><td>${r.label}</td><td class="r">${r.kwh != null ? formatCurrency(Math.round(r.kwh)) : '-'}</td><td class="r">${r.rate != null ? formatCurrency(Number(r.rate)) : '-'}</td><td class="r">${r.amount != null ? formatCurrency(Math.round(r.amount)) : '-'}</td></tr>`).join('')}
    <tr class="total"><td>TOTAL TTC</td><td class="r">${formatCurrency(Math.round(apiTotalKwh))}</td><td></td><td class="r">${formatCurrency(Math.round(apiTotal))}</td></tr>
  </tbody>
</table>
<p style="margin-top: 40px; font-size: 12px; color: #aaa;">Facture générée par SIMES — ${new Date().toLocaleDateString('fr-FR')}</p>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }, [apiBreakdown, apiTotal, apiTotalKwh, apiMaxPower, apiCosPhi, apiKma, hasPfWarning]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description={`${selectedTerrain?.name ?? 'Terrain'} — Estimation mensuelle`}
      />

      {/* Toast feedback */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm">
          {toastMessage}
        </div>
      )}

      {/* Contract banner */}
      {!hasContract && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
          <div className="text-sm"><span className="font-medium text-amber-800">Configurez d'abord un contrat</span> avant de calculer la facture</div>
        </div>
      )}

      {/* Contract section – SIMPLIFIED */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Contrat terrain
            </CardTitle>
            {hasContract && <Badge className="badge-ok">Actif</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main fields visible */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Plan tarifaire (SONABEL)</Label>
              <Select value={contractForm.tariff_plan_id} onValueChange={v => setContractForm({ ...contractForm, tariff_plan_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.isArray(tariffData) && tariffData.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name ?? p.plan_code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Puissance souscrite (PS, kW)</Label>
              <Input 
                type="number" 
                value={contractForm.subscribed_power_kw}
                onChange={e => setContractForm({ ...contractForm, subscribed_power_kw: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Optional fields (hidden by default) */}
          {showOptional && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <Label className="text-xs">Location compteur</Label>
                <Input type="number" defaultValue="0" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Location poste</Label>
                <Input type="number" defaultValue="0" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Entretien</Label>
                <Input type="number" defaultValue="0" />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowOptional(!showOptional)} className="text-xs">
              <ChevronDown className={`w-4 h-4 mr-1 transition-transform ${showOptional ? 'rotate-180' : ''}`} />
              Frais optionnels
            </Button>
            <Button size="sm" onClick={handleSaveContract}>Enregistrer</Button>
          </div>
        </CardContent>
      </Card>

      {/* Calculate section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Calculer la facture</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex-1">
            <Label className="text-sm text-muted-foreground mb-2 block">Mois</Label>
            <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
          <Button onClick={handleCalculate} disabled={!hasContract || pollingFacture} className="mt-6">
            {pollingFacture ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calculator className="w-4 h-4 mr-2" />}
            Calculer
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {hasLiveResult && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="TOTAL TTC" value={(apiTotal / 1000000).toFixed(1)} unit="M XOF" icon={<Receipt className="w-4 h-4" />} />
            <KpiCard label="Consommation" value={(apiTotalKwh / 1000).toFixed(1)} unit="MWh" icon={<Zap className="w-4 h-4" />} />
            <KpiCard label="Puissance max" value={apiMaxPower.toFixed(1)} unit="kW" icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="cos φ" value={apiCosPhi.toFixed(3)} variant={hasPfWarning ? 'warning' : 'default'} />
          </div>

          {/* PF Warning */}
          {hasPfWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
              <div className="text-sm text-amber-800">
                <span className="font-medium">cos φ = {apiCosPhi.toFixed(3)}</span> — Pénalité Kma = <span className="font-mono font-medium">{apiKma.toFixed(3)}</span> appliquée sur la prime de puissance
              </div>
            </div>
          )}

          {/* Invoice breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Détail de facturation</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="font-semibold py-2">Catégorie</th>
                    <th className="text-right font-semibold py-2">kWh</th>
                    <th className="text-right font-semibold py-2">Tarif (XOF)</th>
                    <th className="text-right font-semibold py-2">Montant (XOF)</th>
                  </tr>
                </thead>
                <tbody>
                  {apiBreakdown?.map((row: any) => (
                    <tr key={row.key} className="border-b hover:bg-muted/30">
                      <td className="py-2 font-medium">{row.label}</td>
                      <td className="text-right py-2 font-mono">{row.kwh != null ? formatCurrency(Math.round(row.kwh)) : '—'}</td>
                      <td className="text-right py-2 font-mono">{row.rate != null ? formatCurrency(Number(row.rate)) : '—'}</td>
                      <td className="text-right py-2 font-mono font-semibold">{row.amount != null ? formatCurrency(Math.round(row.amount)) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-primary/5 font-semibold border-t-2">
                    <td className="py-3">TOTAL TTC</td>
                    <td className="text-right py-3 font-mono">{formatCurrency(Math.round(apiTotalKwh))}</td>
                    <td className="text-right py-3"></td>
                    <td className="text-right py-3 font-mono text-lg text-primary">{formatCurrency(Math.round(apiTotal))}</td>
                  </tr>
                </tbody>
              </table>
              <Button onClick={handleExportPDF} variant="outline" className="mt-4 w-full">
                <FileText className="w-4 h-4 mr-2" />
                Exporter PDF
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {!hasLiveResult && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucune facture calculée. Cliquez sur "Calculer" pour générer une estimation.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
