import React, { useState, useMemo, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FileText, Download, Loader2, CheckCircle, FileSpreadsheet, BarChart3, Zap, Image, FileJson, FileImage, Printer } from 'lucide-react';
import { useAppContext } from '@/contexts/AppContext';
import { useTerrainOverview, useReadings, stableFrom, stableNow } from '@/hooks/useApi';
import api from '@/lib/api';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

export default function Exports() {
  const { selectedTerrainId } = useAppContext();
  const prefs = usePreferences();
  const currSym = getCurrencySymbol(prefs.currency);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedPoints, setSelectedPoints] = useState<Set<string>>(new Set());
  const [batchExporting, setBatchExporting] = useState(false);

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(selectedTerrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;

  // Fetch readings for CSV terrain summary
  const from = useMemo(() => stableFrom(days * 86400_000), [days]);
  const to = useMemo(() => stableNow(), []);
  const { data: readingsData } = useReadings(selectedTerrainId, { from, to, limit: 10000 });
  const readings = (readingsData?.readings ?? []) as Array<Record<string, unknown>>;

  // Summary stats
  const summary = useMemo(() => {
    if (!readings.length) return null;
    const eis = readings.map(r => r.energy_import != null ? Number(r.energy_import) : NaN).filter(v => !isNaN(v));
    const powers = readings.map(r => r.active_power_total != null ? Number(r.active_power_total) : NaN).filter(v => !isNaN(v));
    const energy = eis.length >= 2 ? Math.max(...eis) - Math.min(...eis) : 0;
    return {
      readingCount: readings.length,
      energy,
      cost: energy * prefs.tariffRate,
      co2: energy * prefs.co2Factor,
      peakPower: powers.length ? Math.max(...powers) : 0,
      avgPower: powers.length ? powers.reduce((s, v) => s + v, 0) / powers.length : 0,
    };
  }, [readings, prefs.tariffRate, prefs.co2Factor]);

  const handleExportExcel = async (pointId: string) => {
    try {
      setExportingId(pointId);
      const url = `/reports/point/${pointId}/excel?days=${days}`;

      const response = await fetch(api.baseURL + url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Export failed: ${error.error || 'Unknown error'}`);
        return;
      }

      const point = points.find(p => String(p.id) === pointId);
      const pointName = point ? String(point.name).replace(/[^a-zA-Z0-9_-]/g, '_') : pointId;
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `simes-${pointName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch {
      alert('Export échoué. Veuillez réessayer.');
    } finally {
      setExportingId(null);
    }
  };

  // Terrain-level CSV export (all readings)
  const exportTerrainCSV = useCallback(() => {
    if (!readings.length) return;
    const columns = ['time', 'point_id',
      'active_power_total', 'active_power_a', 'active_power_b', 'active_power_c',
      'reactive_power_total', 'apparent_power_total',
      'voltage_a', 'voltage_b', 'voltage_c', 'voltage_ab', 'voltage_bc', 'voltage_ca',
      'current_a', 'current_b', 'current_c', 'current_sum',
      'power_factor_total', 'power_factor_a', 'power_factor_b', 'power_factor_c',
      'energy_import', 'energy_export', 'energy_total',
      'frequency',
      'thdi_a', 'thdi_b', 'thdi_c', 'thdu_a', 'thdu_b', 'thdu_c',
      'voltage_unbalance', 'current_unbalance',
      'temp_a', 'temp_b', 'temp_c', 'temp_n'];
    const header = columns.join(',') + '\n';
    const rows = [...readings]
      .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())
      .map(r => columns.map(c => r[c] ?? '').join(','))
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simes-terrain-${selectedTerrainId}-${days}j-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [readings, selectedTerrainId, days]);

  // JSON export (structured data, good for integrations)
  const exportTerrainJSON = useCallback(() => {
    if (!readings.length) return;
    const sorted = [...readings].sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime());
    const payload = {
      terrain_id: selectedTerrainId,
      export_date: new Date().toISOString(),
      period_days: days,
      summary: summary ? {
        reading_count: summary.readingCount,
        energy_kwh: summary.energy,
        peak_power_kw: summary.peakPower,
        avg_power_kw: summary.avgPower,
        cost: summary.cost,
        co2_kg: summary.co2,
      } : null,
      points: points.map(p => ({ id: p.id, name: p.name, category: p.measure_category, zone: p.zone_name })),
      readings: sorted,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simes-terrain-${selectedTerrainId}-${days}j-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [readings, selectedTerrainId, days, summary, points]);

  // PDF report via browser print dialog
  const exportPDFReport = useCallback(() => {
    if (!summary) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

    // Daily power profile for chart
    const dailyProfile = new Map<string, { sum: number; count: number }>();
    for (const r of readings) {
      const day = new Date(String(r.time)).toLocaleDateString('fr-FR');
      const pw = r.active_power_total != null ? Number(r.active_power_total) : NaN;
      if (isNaN(pw)) continue;
      const e = dailyProfile.get(day) ?? { sum: 0, count: 0 };
      e.sum += pw; e.count++;
      dailyProfile.set(day, e);
    }
    const dailyRows = Array.from(dailyProfile.entries())
      .map(([d, v]) => `<tr><td>${d}</td><td>${(v.sum / v.count).toFixed(2)}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport SIMES</title>
<style>
  body{font-family:Arial,sans-serif;margin:40px;color:#333}
  h1{color:#1a56db;border-bottom:2px solid #1a56db;padding-bottom:8px}
  h2{color:#555;margin-top:24px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:16px 0}
  .kpi{border:1px solid #ddd;border-radius:8px;padding:16px;text-align:center}
  .kpi .value{font-size:24px;font-weight:bold;color:#1a56db}
  .kpi .label{font-size:12px;color:#888;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}
  th{background:#f5f5f5}
  .footer{margin-top:40px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px}
  @media print{body{margin:20px}.no-print{display:none}}
</style></head><body>
<h1>Rapport Énergétique SIMES</h1>
<p>Terrain #${selectedTerrainId} — ${dateStr} — Période: ${days} jours</p>

<div class="kpi-grid">
  <div class="kpi"><div class="value">${summary.readingCount.toLocaleString()}</div><div class="label">Mesures</div></div>
  <div class="kpi"><div class="value">${summary.energy >= 1000 ? (summary.energy / 1000).toFixed(1) + ' MWh' : summary.energy.toFixed(0) + ' kWh'}</div><div class="label">Énergie totale</div></div>
  <div class="kpi"><div class="value">${summary.peakPower.toFixed(1)} kW</div><div class="label">Pic de puissance</div></div>
  <div class="kpi"><div class="value">${summary.avgPower.toFixed(1)} kW</div><div class="label">Puissance moyenne</div></div>
  <div class="kpi"><div class="value">${summary.cost >= 1_000_000 ? (summary.cost / 1_000_000).toFixed(1) + 'M' : (summary.cost / 1000).toFixed(0) + 'k'} ${currSym}</div><div class="label">Coût estimé</div></div>
  <div class="kpi"><div class="value">${summary.co2.toFixed(0)} kg</div><div class="label">CO₂</div></div>
</div>

<h2>Points de mesure (${points.length})</h2>
<table>
  <thead><tr><th>Nom</th><th>Catégorie</th><th>Zone</th></tr></thead>
  <tbody>${points.map(p => `<tr><td>${String(p.name)}</td><td>${p.measure_category || '—'}</td><td>${p.zone_name || '—'}</td></tr>`).join('')}</tbody>
</table>

${dailyRows ? `<h2>Puissance moyenne journalière</h2>
<table><thead><tr><th>Jour</th><th>Puissance moy. (kW)</th></tr></thead><tbody>${dailyRows}</tbody></table>` : ''}

<div class="footer">Généré par SIMES — ${now.toLocaleString('fr-FR')}</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  }, [readings, summary, selectedTerrainId, days, points, currSym]);

  // Chart image export via SVG-to-canvas conversion  
  const chartRef = useRef<HTMLDivElement>(null);
  const exportChartImage = useCallback(() => {
    const container = chartRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const rect = svg.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    const img = new window.Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      const pngUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `simes-chart-${selectedTerrainId}-${days}j.png`;
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, [selectedTerrainId, days]);

  // Daily power profile for chart
  const dailyChartData = useMemo(() => {
    const dailyMap = new Map<string, { sum: number; count: number; max: number; ts: number }>();
    for (const r of readings) {
      const t = new Date(String(r.time));
      const day = t.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const pw = r.active_power_total != null ? Number(r.active_power_total) : NaN;
      if (isNaN(pw)) continue;
      const e = dailyMap.get(day) ?? { sum: 0, count: 0, max: 0, ts: t.getTime() };
      e.sum += pw; e.count++; e.max = Math.max(e.max, pw);
      dailyMap.set(day, e);
    }
    return Array.from(dailyMap.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([day, v]) => ({
        day,
        avg: Math.round((v.sum / v.count) * 100) / 100,
        max: Math.round(v.max * 100) / 100,
      }));
  }, [readings]);

  // Batch export selected points
  const handleBatchExport = async () => {
    setBatchExporting(true);
    for (const pointId of selectedPoints) {
      await handleExportExcel(pointId);
    }
    setBatchExporting(false);
  };

  const togglePointSelection = (id: string) => {
    setSelectedPoints(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedPoints.size === points.length) {
      setSelectedPoints(new Set());
    } else {
      setSelectedPoints(new Set(points.map(p => String(p.id))));
    }
  };

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exports" description="Exportez vos données énergétiques" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Veuillez sélectionner un terrain pour accéder aux exports.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Exports"
        description="Exportez les données énergétiques de vos points de mesure"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={exportTerrainCSV} disabled={!readings.length}>
              <Download className="w-4 h-4 mr-1" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportTerrainJSON} disabled={!readings.length}>
              <FileJson className="w-4 h-4 mr-1" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDFReport} disabled={!summary}>
              <Printer className="w-4 h-4 mr-1" />
              Rapport PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportChartImage} disabled={!dailyChartData.length}>
              <FileImage className="w-4 h-4 mr-1" />
              Image graphique
            </Button>
            {selectedPoints.size > 0 && (
              <Button size="sm" onClick={handleBatchExport} disabled={batchExporting}>
                {batchExporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}
                Excel ({selectedPoints.size} point{selectedPoints.size > 1 ? 's' : ''})
              </Button>
            )}
          </div>
        }
      />

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
          <KpiCard label="Mesures" value={summary.readingCount.toLocaleString()} icon={<BarChart3 className="w-4 h-4" />} />
          <KpiCard label={`Énergie (${days}j)`} value={summary.energy >= 1000 ? `${(summary.energy / 1000).toFixed(1)}` : summary.energy.toFixed(0)} unit={summary.energy >= 1000 ? 'MWh' : 'kWh'} icon={<Zap className="w-4 h-4" />} />
          <KpiCard label="Pic puissance" value={summary.peakPower.toFixed(1)} unit="kW" icon={<Zap className="w-4 h-4" />} />
          <KpiCard label="Coût estimé" value={summary.cost >= 1_000_000 ? `${(summary.cost / 1_000_000).toFixed(1)}M` : `${(summary.cost / 1000).toFixed(0)}k`} unit={currSym} icon={<FileText className="w-4 h-4" />} />
          <KpiCard label="CO₂" value={summary.co2.toFixed(0)} unit="kg" icon={<FileText className="w-4 h-4" />} />
        </div>
      )}

      {/* Export Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Paramètres d'export</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Plage temporelle</label>
              <Select value={String(days)} onValueChange={v => setDays(+v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">24 heures</SelectItem>
                  <SelectItem value="7">7 jours</SelectItem>
                  <SelectItem value="30">30 jours</SelectItem>
                  <SelectItem value="90">90 jours</SelectItem>
                  <SelectItem value="365">1 an</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Power chart (exportable as image) */}
      {dailyChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Aperçu — Puissance moyenne journalière
              </CardTitle>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportChartImage}>
                <FileImage className="w-3 h-3" /> Exporter PNG
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={chartRef}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" kW" />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v.toFixed(2), name === 'avg' ? 'Moyenne' : 'Maximum']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => v === 'avg' ? 'Puissance moyenne' : 'Puissance max'} />
                  <Area type="monotone" dataKey="avg" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="avg" />
                  <Area type="monotone" dataKey="max" stroke="#ef4444" fill="#ef444420" strokeWidth={1} strokeDasharray="3 3" name="max" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Points List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            Points de mesure
            {points.length > 0 && <Badge variant="outline" className="text-[10px] ml-auto">{points.length} point(s)</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadOv ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : points.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>Aucun point de mesure trouvé</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Select all toggle */}
              <div className="flex items-center gap-2 pb-2 border-b">
                <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                  {selectedPoints.size === points.length ? <CheckCircle className="w-3 h-3 mr-1 text-primary" /> : null}
                  {selectedPoints.size === points.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </Button>
              </div>

              {points.map((point) => {
                const isSelected = selectedPoints.has(String(point.id));
                return (
                  <div
                    key={point.id}
                    className={`flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer ${isSelected ? 'border-primary/50 bg-primary/5' : ''}`}
                    onClick={() => togglePointSelection(String(point.id))}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                        {isSelected && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <div>
                        <h4 className="font-medium text-sm">{point.name}</h4>
                        <p className="text-xs text-muted-foreground">
                          {point.measure_category || 'Non catégorisé'}
                          {point.zone_name && <> • Zone: {point.zone_name}</>}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={(e) => { e.stopPropagation(); handleExportExcel(String(point.id)); }}
                      disabled={exportingId === String(point.id)}
                      size="sm"
                      variant="outline"
                      className="gap-1"
                    >
                      {exportingId === String(point.id) ? (
                        <><Loader2 className="w-3 h-3 animate-spin" />Export…</>
                      ) : (
                        <><Download className="w-3 h-3" />Excel</>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}