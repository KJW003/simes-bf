import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import api from '@/lib/api';
import {
  useSubmitFacture, useFactureResult, useLatestFacture,
  useTariffPlans, useTerrainContract, useSaveTerrainContract,
  useFactureMonths, useFactureMonthly,
} from '@/hooks/useApi';
import {
  Receipt, Zap, Clock, TrendingUp, FileText, AlertTriangle,
  Loader2, CheckCircle2, Calculator, CalendarDays,
  Settings2, Save, Check,
} from 'lucide-react';


const formatCurrency = (value: number) => value.toLocaleString('fr-FR');

// Default period: last 30 days
const defaultFrom = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};
const defaultTo = () => new Date().toISOString().slice(0, 10);

export default function Invoice() {
  const { selectedTerrain } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;

  // ── Contract & tariffs ──
  const { data: tariffData } = useTariffPlans();
  const { data: contractData, isLoading: contractLoading } = useTerrainContract(terrainId);
  const saveContract = useSaveTerrainContract();

  const tariffPlans = Array.isArray(tariffData) ? tariffData : ((tariffData as Record<string, unknown>)?.tariffs as Array<Record<string, unknown>>) ?? [];
  const existingContract = (contractData as Record<string, unknown>)?.contract as Record<string, unknown> | undefined;
  const hasContract = !!existingContract;

  // Contract form state
  const [contractForm, setContractForm] = useState({
    tariff_plan_id: '',
    subscribed_power_kw: 100,
    meter_rental: 0,
    post_rental: 0,
    maintenance: 0,
    capacitor_power_kw: 0,
  });
  const [contractSaveStatus, setContractSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastSavedRef = useRef<string>('');

  // Sync form when contract loads
  useEffect(() => {
    if (existingContract) {
      setContractForm({
        tariff_plan_id: String(existingContract.tariff_plan_id ?? ''),
        subscribed_power_kw: Number(existingContract.subscribed_power_kw ?? 100),
        meter_rental: Number(existingContract.meter_rental ?? 0),
        post_rental: Number(existingContract.post_rental ?? 0),
        maintenance: Number(existingContract.maintenance ?? 0),
        capacitor_power_kw: Number(existingContract.capacitor_power_kw ?? 0),
      });
      lastSavedRef.current = JSON.stringify(existingContract);
    } else if (tariffPlans.length > 0 && !contractForm.tariff_plan_id) {
      setContractForm(prev => ({ ...prev, tariff_plan_id: String(tariffPlans[0].id) }));
    }
  }, [existingContract, tariffPlans]);

  // Auto-save on form change with debounce
  const autoSaveContract = useCallback(async (formData: typeof contractForm) => {
    if (!terrainId || !formData.tariff_plan_id) return;

    const formJson = JSON.stringify(formData);
    if (formJson === lastSavedRef.current) return; // No changes

    setContractSaveStatus('saving');
    
    try {
      await saveContract.mutateAsync({ terrainId, data: formData });
      lastSavedRef.current = formJson;
      setContractSaveStatus('saved');
      setTimeout(() => setContractSaveStatus('idle'), 2000);
    } catch (e) {
      console.error('Erreur sauvegarde contrat:', e);
      setContractSaveStatus('idle');
    }
  }, [terrainId, saveContract]);

  // Debounced save trigger
  const handleContractChange = useCallback((newForm: typeof contractForm) => {
    setContractForm(newForm);
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      autoSaveContract(newForm);
    }, 1000); // Save 1 second after last change
  }, [autoSaveContract]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // ── Facture ──
  const [runId, setRunId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [availableMonths, setAvailableMonths] = useState<Array<{ year: number; month: number; display: string }>>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [todayOnly, setTodayOnly] = useState(false);
  const [isMonthlyMode, setIsMonthlyMode] = useState(true);
  const submitFacture = useSubmitFacture();
  const { data: apiFacture, isLoading: pollingFacture } = useFactureResult(runId);
  const { data: monthsData, isLoading: loadingMonths } = useFactureMonths(isMonthlyMode ? selectedTerrain?.id ?? null : null);

  const liveResult = apiFacture as Record<string, unknown> | null;
  const hasLiveResult = !!liveResult;
  const availableMonths = Array.isArray(monthsData?.months) ? monthsData.months : [];

  // Keep old useEffect for backward compatibility if needed
  // const [availableMonths, setAvailableMonths] = useState<Array<{ year: number; month: number; display: string }>>([]);

  const handleCalculate = async () => {
    if (!selectedTerrain || !hasContract) return;
    try {
      if (isMonthlyMode) {
        // Monthly mode: fetch from stored invoice with auth headers
        try {
          let result;
          if (todayOnly) {
            result = await api.getFactureMonthly(selectedTerrain.id, undefined, undefined, 'today');
          } else {
            result = await api.getFactureMonthly(selectedTerrain.id, selectedYear, selectedMonth);
          }
          setRunId('monthly-' + Date.now());
          console.log('Monthly invoice loaded:', result);
        } catch (e) {
          console.error('Error fetching monthly invoice:', e);
        }
      } else {
        // Ad-hoc mode: old behavior with date range
        const run = await submitFacture.mutateAsync({
          terrain_id: selectedTerrain.id,
          from: new Date(dateFrom).toISOString(),
          to: new Date(dateTo).toISOString(),
          subscribed_power_kw: contractForm.subscribed_power_kw,
        });
        setRunId(run.id);
      }
    } catch (e) {
      console.error('Erreur soumission facture:', e);
    }
  };

  const apiBreakdown = hasLiveResult ? (liveResult.breakdown as Array<{ key: string; label: string; kwh: number | null; rate: number | null; amount: number | null; detail?: string; kma?: number; ps_kw?: number; exceed_kw?: number; pmax_kw?: number }>) : null;
  const apiTotal = hasLiveResult ? Number(liveResult.totalAmount ?? 0) : 0;
  const apiTotalKwh = hasLiveResult ? Number(liveResult.totalKwh ?? 0) : 0;
  const apiMaxDemand = hasLiveResult ? Number(liveResult.maxDemandKw ?? 0) : 0;
  const apiPlanName = hasLiveResult ? String(liveResult.tariffVersionName ?? '') : '';
  const apiCosPhi = hasLiveResult ? Number(liveResult.cosPhi ?? 0) : 0;
  const apiKma = hasLiveResult ? Number(liveResult.Kma ?? 1) : 1;
  const apiVersion = hasLiveResult ? String(liveResult.version ?? 'V1') : 'V1';
  const apiPeriod = hasLiveResult ? (liveResult.period as { from?: string; to?: string; hours?: number } | undefined) : undefined;


  const handleExportPDF = useCallback(() => {
    if (!hasLiveResult || !apiBreakdown) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const terrainName = esc(selectedTerrain?.name ?? 'Terrain');
    const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const periodLabel = apiPeriod
      ? `${new Date(apiPeriod.from!).toLocaleDateString('fr-FR')} → ${new Date(apiPeriod.to!).toLocaleDateString('fr-FR')}`
      : `${dateFrom} → ${dateTo}`;

    const rows = apiBreakdown.map(r =>
      `<tr><td>${esc(r.label)}</td><td class="r">${r.kwh != null ? formatCurrency(Math.round(r.kwh)) : '-'}</td><td class="r">${r.rate != null ? formatCurrency(Number(r.rate)) : '-'}</td><td class="r b">${r.amount != null ? formatCurrency(Math.round(r.amount)) : '-'}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Facture SIMES</title>
<style>
  body{font-family:Arial,sans-serif;margin:40px;color:#333}
  h1{color:#1a56db;border-bottom:2px solid #1a56db;padding-bottom:8px}
  .meta{color:#666;margin-bottom:20px;font-size:13px}
  .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}
  .kpi{border:1px solid #ddd;border-radius:8px;padding:12px;text-align:center}
  .kpi .value{font-size:20px;font-weight:bold;color:#1a56db}
  .kpi .label{font-size:11px;color:#888;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}
  th{background:#f5f5f5}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .b{font-weight:bold}
  .total-row{background:#f0f4ff;font-weight:bold}
  .warning{color:#b45309;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;margin:12px 0;font-size:13px}
  .footer{margin-top:40px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px}
  @media print{body{margin:20px}}
</style></head><body>
<h1>Facture SONABEL — Estimation SIMES</h1>
<p class="meta">${terrainName} — ${dateStr}<br>Période de facturation : ${periodLabel}<br>Plan tarifaire : ${esc(apiPlanName)} (${apiVersion})</p>

<div class="kpi-grid">
  <div class="kpi"><div class="value">${formatCurrency(Math.round(apiTotal))}</div><div class="label">Total TTC (XOF)</div></div>
  <div class="kpi"><div class="value">${(apiTotalKwh / 1000).toFixed(1)}</div><div class="label">Consommation (MWh)</div></div>
  <div class="kpi"><div class="value">${apiMaxDemand.toFixed(1)}</div><div class="label">Puissance max (kW)</div></div>
  <div class="kpi"><div class="value">${apiCosPhi.toFixed(3)}</div><div class="label">cos φ</div></div>
  <div class="kpi"><div class="value">${apiKma.toFixed(3)}</div><div class="label">Kma</div></div>
</div>

${apiCosPhi > 0 && apiCosPhi < 0.93 ? `<div class="warning">⚠ cos φ = ${apiCosPhi.toFixed(3)} &lt; 0.93 — Pénalité Kma = ${apiKma.toFixed(3)} appliquée sur la prime de puissance.</div>` : ''}

<h2>Détail de la facturation</h2>
<table>
  <thead><tr><th>Catégorie</th><th class="r">kWh</th><th class="r">Tarif (XOF)</th><th class="r">Montant (XOF)</th></tr></thead>
  <tbody>
    ${rows}
    <tr class="total-row"><td>Total TTC</td><td class="r">${formatCurrency(Math.round(apiTotalKwh))}</td><td></td><td class="r">${formatCurrency(Math.round(apiTotal))}</td></tr>
  </tbody>
</table>

<div class="footer">Document généré automatiquement par SIMES — ${dateStr}</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }, [hasLiveResult, apiBreakdown, apiTotal, apiTotalKwh, apiMaxDemand, apiCosPhi, apiKma, apiPlanName, apiVersion, apiPeriod, selectedTerrain, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description={"Estimation de facture – " + (selectedTerrain?.name ?? 'Site')}
        actions={
          <div className="flex flex-col gap-3">
            {/* Mode toggle */}
            <div className="flex items-center gap-2">
              <input 
                type="radio" 
                id="monthly-mode" 
                checked={isMonthlyMode} 
                onChange={() => setIsMonthlyMode(true)}
                className="cursor-pointer"
              />
              <label htmlFor="monthly-mode" className="cursor-pointer text-sm font-medium">Facturation mensuelle</label>
              <input 
                type="radio" 
                id="adhoc-mode" 
                checked={!isMonthlyMode} 
                onChange={() => setIsMonthlyMode(false)}
                className="cursor-pointer ml-4"
              />
              <label htmlFor="adhoc-mode" className="cursor-pointer text-sm font-medium">Période personnalisée</label>
            </div>
            
            {/* Controls */}
            <div className="flex items-center gap-2">
              {isMonthlyMode ? (
                <>
                  {/* Monthly mode: month selector */}
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <Select value={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`} onValueChange={(val) => {
                      const [y, m] = val.split('-');
                      setSelectedYear(parseInt(y));
                      setSelectedMonth(parseInt(m));
                    }}>
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue placeholder="Sélectionner un mois" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMonths.map(m => (
                          <SelectItem key={`${m.year}-${m.month}`} value={`${m.year}-${String(m.month).padStart(2, '0')}`}>
                            {m.display}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Today only checkbox */}
                  <div className="flex items-center gap-2 ml-4 px-3 py-2 border border-blue-200 rounded-md bg-blue-50">
                    <input 
                      type="checkbox" 
                      id="today-only" 
                      checked={todayOnly} 
                      onChange={(e) => setTodayOnly(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <label htmlFor="today-only" className="cursor-pointer text-xs font-medium text-blue-900">
                      Affichage temps réel (aujourd'hui)
                    </label>
                  </div>
                </>
              ) : (
                <>
                  {/* Ad-hoc mode: date range */}
                  <Input type="date" className="h-8 w-36 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input type="date" className="h-8 w-36 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                </>
              )}
              
              {selectedTerrain && (
                <Button size="sm" onClick={handleCalculate} disabled={submitFacture.isPending || pollingFacture || !hasContract}>
                  {submitFacture.isPending || pollingFacture ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Calculator className="w-4 h-4 mr-2" />
                  )}
                  Calculer
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!hasLiveResult}>
                <FileText className="w-4 h-4 mr-2" />
                Exporter PDF
              </Button>
            </div>
          </div>
        }
      />

      {/* Contract status banner */}
      {!contractLoading && !hasContract && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm flex items-start gap-3 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Aucun contrat configuré</span> — configurez le contrat ci-dessous avant de lancer le calcul de facture.
          </div>
        </div>
      )}

      {/* Contract configuration card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Contrat terrain
            </CardTitle>
            {hasContract && (
              <Badge variant="outline" className="text-xs badge-ok">Contrat actif</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Plan tarifaire</Label>
              <Select
                value={contractForm.tariff_plan_id}
                onValueChange={v => handleContractChange({ ...contractForm, tariff_plan_id: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {tariffPlans.map((p: Record<string, unknown>) => (
                    <SelectItem key={String(p.id)} value={String(p.id)}>
                      {String(p.name ?? p.plan_code ?? p.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Puissance souscrite (kW)</Label>
              <Input type="number" className="h-8 text-xs" value={contractForm.subscribed_power_kw}
                onChange={e => handleContractChange({ ...contractForm, subscribed_power_kw: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Batterie condensateur (kW)</Label>
              <Input type="number" className="h-8 text-xs" value={contractForm.capacitor_power_kw}
                onChange={e => handleContractChange({ ...contractForm, capacitor_power_kw: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location compteur</Label>
              <Input type="number" className="h-8 text-xs" value={contractForm.meter_rental}
                onChange={e => handleContractChange({ ...contractForm, meter_rental: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location poste</Label>
              <Input type="number" className="h-8 text-xs" value={contractForm.post_rental}
                onChange={e => handleContractChange({ ...contractForm, post_rental: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entretien</Label>
              <Input type="number" className="h-8 text-xs" value={contractForm.maintenance}
                onChange={e => handleContractChange({ ...contractForm, maintenance: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            {contractSaveStatus === 'saving' && (
              <div className="text-xs text-amber-600 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Enregistrement…
              </div>
            )}
            {contractSaveStatus === 'saved' && (
              <div className="text-xs text-green-600 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Enregistré automatiquement
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
          <KpiCard label="Total TTC" value={(apiTotal / 1000000).toFixed(1) + 'M'} unit="XOF" icon={<Receipt className="w-4 h-4" />} />
          <KpiCard label="Consommation" value={(apiTotalKwh / 1000).toFixed(1)} unit="MWh" icon={<Zap className="w-4 h-4" />} />
          <KpiCard label="Puissance max" value={apiMaxDemand.toFixed(1)} unit="kW" icon={<TrendingUp className="w-4 h-4" />} />
          <KpiCard label="cos φ" value={apiCosPhi.toFixed(3)} icon={<Clock className="w-4 h-4" />} variant={apiCosPhi > 0 && apiCosPhi < 0.93 ? 'warning' : 'default'} />
          <KpiCard label="Kma" value={apiKma.toFixed(3)} icon={<AlertTriangle className="w-4 h-4" />} variant={apiKma > 1 ? 'warning' : 'success'} />
        </div>
      )}

      {hasLiveResult && apiCosPhi > 0 && apiCosPhi < 0.93 && (
        <div className="rounded-lg border border-severity-warning/30 bg-severity-warning-bg/40 px-4 py-3 text-sm text-severity-warning-foreground flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>cos φ = {apiCosPhi.toFixed(3)} &lt; 0.93 — Penalite Kma = {apiKma.toFixed(3)} appliquee sur la prime de puissance.</div>
        </div>
      )}

      {apiBreakdown && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-medium">Facture SONABEL (donnees reelles)</CardTitle>
              <Badge variant="outline" className="text-xs badge-ok">{apiPlanName} — {apiVersion}</Badge>
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
                    <td className="font-medium">{row.label}{row.detail ? <span className="text-xs text-muted-foreground ml-1">({row.detail})</span> : null}</td>
                    <td className="text-right mono">{row.kwh != null ? formatCurrency(Math.round(row.kwh)) : '-'}</td>
                    <td className="text-right mono">{row.rate != null ? formatCurrency(Number(row.rate)) : '-'}</td>
                    <td className="text-right mono font-medium">{row.amount != null ? formatCurrency(Math.round(row.amount)) : '-'}</td>
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