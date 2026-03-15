import React, { useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
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
import { computeTimeWindow } from '@/lib/time-window';
import { usePreferences, getCurrencySymbol } from '@/hooks/usePreferences';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ _-]/g, '').replace(/\s+/g, '_').slice(0, 60);

export default function Exports() {
  const { selectedTerrainId, selectedTerrain } = useAppContext();
  const terrainLabel = selectedTerrain?.name ? sanitize(selectedTerrain.name) : `terrain-${selectedTerrainId}`;
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
  const { data: readingsData } = useReadings(selectedTerrainId, { from, to });
  const readings = (readingsData?.readings ?? []) as Array<Record<string, unknown>>;

  // Summary stats
  const summary = useMemo(() => {
    if (!readings.length) return null;
    const eis = readings.map(r => r.energy_total != null ? Number(r.energy_total) : (r.energy_import != null ? Number(r.energy_import) : NaN)).filter(v => !isNaN(v));
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
      const url = `/reports/point/${pointId}/excel?days=${days}&limit=50000`;

      const response = await fetch(api.baseURL + url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        toast.error(`Échec de l'export: ${(error as any).error || 'Erreur inconnue'}`);
        return;
      }

      const ct = response.headers.get('content-type') ?? '';
      if (!ct.includes('spreadsheet')) {
        const body = await response.json().catch(() => null);
        toast.error((body as any)?.message ?? 'Aucune donnée à exporter pour ce point.');
        return;
      }

      const point = points.find(p => String(p.id) === pointId);
      const pointName = point ? sanitize(String(point.name)) : `point-${pointId}`;
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${terrainLabel}_${pointName}_${days}j_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch {
      toast.error('Échec de l\'export. Veuillez réessayer.');
    } finally {
      setExportingId(null);
    }
  };

  // Build point name map for readable exports
  const pointNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of points) m.set(String(p.id), String(p.name));
    return m;
  }, [points]);

  const CSV_METRIC_COLS = [
    'active_power_total', 'active_power_a', 'active_power_b', 'active_power_c',
    'reactive_power_total', 'apparent_power_total',
    'voltage_a', 'voltage_b', 'voltage_c', 'voltage_ab', 'voltage_bc', 'voltage_ca',
    'current_a', 'current_b', 'current_c', 'current_sum',
    'power_factor_total', 'power_factor_a', 'power_factor_b', 'power_factor_c',
    'energy_import', 'energy_export', 'energy_total',
    'frequency',
    'thdi_a', 'thdi_b', 'thdi_c', 'thdu_a', 'thdu_b', 'thdu_c',
    'voltage_unbalance', 'current_unbalance',
    'temp_a', 'temp_b', 'temp_c', 'temp_n',
  ];

  // Helper: download blob
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Terrain-level CSV export (all readings)
  const exportTerrainCSV = useCallback(() => {
    if (!readings.length) return;
    const columns = ['time', 'point_name', ...CSV_METRIC_COLS];
    const header = columns.join(',') + '\n';
    const rows = [...readings]
      .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())
      .map(r => {
        const vals: (string | number | unknown)[] = [
          r.time ?? '',
          `"${pointNameMap.get(String(r.point_id)) ?? r.point_id}"`,
          ...CSV_METRIC_COLS.map(c => r[c] ?? ''),
        ];
        return vals.join(',');
      })
      .join('\n');
    downloadBlob(
      new Blob([header + rows], { type: 'text/csv' }),
      `${terrainLabel}_${days}j_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }, [readings, terrainLabel, days, pointNameMap]);

  // JSON export (structured data, good for integrations)
  const exportTerrainJSON = useCallback(() => {
    if (!readings.length) return;
    const sorted = [...readings].sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime());
    const payload = {
      terrain: selectedTerrain?.name ?? selectedTerrainId,
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
      points: points.map(p => ({ name: p.name, category: p.measure_category, zone: p.zone_name })),
      readings: sorted.map(r => {
        const { point_id, ...rest } = r as Record<string, unknown>;
        return { ...rest, point_name: pointNameMap.get(String(point_id)) ?? point_id };
      }),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `${terrainLabel}_${days}j_${new Date().toISOString().slice(0, 10)}.json`,
    );
  }, [readings, selectedTerrain, selectedTerrainId, terrainLabel, days, summary, points, pointNameMap]);

  // PDF report via browser print dialog
  const exportPDFReport = useCallback(() => {
    if (!summary) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
<p>${esc(selectedTerrain?.name ?? 'Terrain')} — ${dateStr} — Période: ${days} jours</p>

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
  <tbody>${points.map(p => `<tr><td>${esc(String(p.name))}</td><td>${esc(p.measure_category || '—')}</td><td>${esc(p.zone_name || '—')}</td></tr>`).join('')}</tbody>
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
  }, [readings, summary, selectedTerrain, selectedTerrainId, days, points, currSym]);

  // ── Image export: chart type + point chooser + own time period ──
  const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

  const IMG_PERIODS = [
    { key: '1', label: '24h' },
    { key: '7', label: '7j' },
    { key: '30', label: '30j' },
    { key: '90', label: '90j' },
  ] as const;

  type ChartType = 'power' | 'voltage' | 'current' | 'energy' | 'pf' | 'daily-power' | 'daily-cost' | 'daily-co2';
  const CHART_OPTIONS: { value: ChartType; label: string; perPoint: boolean }[] = [
    { value: 'power', label: 'Puissance active (kW)', perPoint: true },
    { value: 'voltage', label: 'Tension (V)', perPoint: true },
    { value: 'current', label: 'Courant (A)', perPoint: true },
    { value: 'energy', label: 'Énergie totale (kWh)', perPoint: true },
    { value: 'pf', label: 'Facteur de puissance', perPoint: true },
    { value: 'daily-power', label: 'Puissance moy. journalière', perPoint: false },
    { value: 'daily-cost', label: 'Coût journalier', perPoint: false },
    { value: 'daily-co2', label: 'CO₂ journalier', perPoint: false },
  ];
  const [imgChartType, setImgChartType] = useState<ChartType>('power');
  const [imgPoints, setImgPoints] = useState<Set<string>>(new Set());
  const [imgDays, setImgDays] = useState(7);
  const [imgExactDate, setImgExactDate] = useState('');
  const currentChartOpt = CHART_OPTIONS.find(o => o.value === imgChartType)!;

  // Separate readings fetch for image export with its own time range
  const imgWindow = useMemo(() => {
    if (imgExactDate) return computeTimeWindow('custom', imgExactDate);
    return {
      from: stableFrom(imgDays * 86400_000),
      to: stableNow(),
      durationMs: imgDays * 86400_000,
    };
  }, [imgDays, imgExactDate]);
  const imgFrom = imgWindow.from;
  const imgTo = imgWindow.to;
  const imgLimit = imgWindow.durationMs <= 2 * 86400_000 ? 120000 : imgWindow.durationMs <= 7 * 86400_000 ? 260000 : 450000;
  const { data: imgReadingsData, isLoading: imgLoading } = useReadings(selectedTerrainId, { from: imgFrom, to: imgTo, limit: imgLimit });
  const imgReadings = (imgReadingsData?.readings ?? []) as Array<Record<string, unknown>>;

  // Toggle point for image
  const toggleImgPoint = (id: string) => {
    setImgPoints(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // Build per-point time-series chart data
  const imgChartData = useMemo(() => {
    const ct = imgChartType;
    const selPts = imgPoints.size > 0 ? imgPoints : new Set(points.map(p => String(p.id)));

    // Aggregate daily charts — no point filter needed
    if (ct === 'daily-power' || ct === 'daily-cost' || ct === 'daily-co2') {
      const dailyMap = new Map<string, { sum: number; count: number; max: number; eiMin: number; eiMax: number; ts: number }>();
      for (const r of imgReadings) {
        const t = new Date(String(r.time));
        const day = t.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const pw = r.active_power_total != null ? Number(r.active_power_total) : NaN;
        const ei = r.energy_total != null ? Number(r.energy_total) : (r.energy_import != null ? Number(r.energy_import) : NaN);
        const e = dailyMap.get(day) ?? { sum: 0, count: 0, max: 0, eiMin: Infinity, eiMax: -Infinity, ts: t.getTime() };
        if (!isNaN(pw)) { e.sum += pw; e.count++; e.max = Math.max(e.max, pw); }
        if (!isNaN(ei)) { e.eiMin = Math.min(e.eiMin, ei); e.eiMax = Math.max(e.eiMax, ei); }
        dailyMap.set(day, e);
      }
      const sorted = Array.from(dailyMap.entries()).sort((a, b) => a[1].ts - b[1].ts);
      if (ct === 'daily-power') {
        return sorted.map(([day, v]) => ({ day, avg: +(v.sum / (v.count || 1)).toFixed(2), max: +v.max.toFixed(2) }));
      }
      if (ct === 'daily-cost') {
        let prev = 0;
        return sorted.map(([day, v]) => {
          const kwh = (isFinite(v.eiMax) && isFinite(v.eiMin)) ? Math.max(0, v.eiMax - v.eiMin) : 0;
          const cost = +(kwh * prefs.tariffRate).toFixed(2);
          prev += cost;
          return { day, cost, cumul: +prev.toFixed(2) };
        });
      }
      // daily-co2
      let cumCo2 = 0;
      return sorted.map(([day, v]) => {
        const kwh = (isFinite(v.eiMax) && isFinite(v.eiMin)) ? Math.max(0, v.eiMax - v.eiMin) : 0;
        const co2 = +(kwh * prefs.co2Factor).toFixed(2);
        cumCo2 += co2;
        return { day, co2, cumul: +cumCo2.toFixed(2) };
      });
    }

    // Per-point time-series
    const metricMap: Record<string, string[]> = {
      power: ['active_power_total'],
      voltage: ['voltage_a', 'voltage_b', 'voltage_c'],
      current: ['current_a', 'current_b', 'current_c'],
      energy: ['energy_total'],
      pf: ['power_factor_total'],
    };
    const metrics = metricMap[ct] ?? ['active_power_total'];

    // Group readings by time bucket per point
    const timeMap = new Map<string, Record<string, number | null>>();
    for (const r of imgReadings) {
      const pid = String(r.point_id);
      if (!selPts.has(pid)) continue;
      const pName = pointNameMap.get(pid) ?? pid;
      const t = String(r.time);
      if (!timeMap.has(t)) timeMap.set(t, { _ts: new Date(t).getTime() } as any);
      const entry = timeMap.get(t)!;
      for (const m of metrics) {
        const key = metrics.length > 1 ? `${pName} (${m.split('_').pop()})` : pName;
        const v = r[m] != null ? Number(r[m]) : null;
        if (v != null) entry[key] = v;
      }
    }
    return Array.from(timeMap.values())
      .sort((a: any, b: any) => (a._ts ?? 0) - (b._ts ?? 0))
      .map((e: any) => {
        const label = new Date(e._ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const { _ts, ...rest } = e;
        return { label, ...rest };
      });
  }, [imgChartType, imgPoints, imgReadings, points, pointNameMap, prefs.tariffRate, prefs.co2Factor]);

  // Determine series names for per-point charts
  const imgSeriesNames = useMemo(() => {
    if (!imgChartData.length) return [];
    const keys = new Set<string>();
    for (const d of imgChartData) {
      for (const k of Object.keys(d)) if (k !== 'label' && k !== 'day') keys.add(k);
    }
    return Array.from(keys);
  }, [imgChartData]);

  const buildPaddedDomain = useCallback((keys: string[]) => {
    if (!imgChartData.length || !keys.length) return ['auto', 'auto'] as const;
    const values: number[] = [];
    for (const row of imgChartData) {
      for (const key of keys) {
        const value = (row as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
      }
    }
    if (!values.length) return ['auto', 'auto'] as const;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.08, 1);
      return [min - pad, max + pad] as const;
    }
    const span = Math.max(1e-9, max - min);
    const pad = span * 0.12;
    return [min - pad, max + pad] as const;
  }, [imgChartData]);

  const dailyPowerDomain = useMemo(() => buildPaddedDomain(['avg', 'max']), [buildPaddedDomain]);
  const dailyCostDomain = useMemo(() => buildPaddedDomain(['cost']), [buildPaddedDomain]);
  const dailyCostCumDomain = useMemo(() => buildPaddedDomain(['cumul']), [buildPaddedDomain]);
  const dailyCo2Domain = useMemo(() => buildPaddedDomain(['co2']), [buildPaddedDomain]);
  const dailyCo2CumDomain = useMemo(() => buildPaddedDomain(['cumul']), [buildPaddedDomain]);
  const perPointDomain = useMemo(() => buildPaddedDomain(imgSeriesNames), [buildPaddedDomain, imgSeriesNames]);

  const exportLegendNames = useMemo(() => {
    if (imgSeriesNames.length) return imgSeriesNames;
    if (imgChartType === 'daily-power') return ['Puissance moyenne', 'Puissance max'];
    if (imgChartType === 'daily-cost') return [`Coût (${currSym})`, 'Cumulé'];
    if (imgChartType === 'daily-co2') return ['CO2 journalier', 'CO2 cumule'];
    return [] as string[];
  }, [imgSeriesNames, imgChartType, currSym]);

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
    const headerHeight = 72;
    const legendRows = Math.max(1, Math.ceil(Math.min(exportLegendNames.length, 12) / 3));
    const legendHeight = exportLegendNames.length ? (legendRows * 22 + 24) : 0;
    canvas.width = Math.max(1, rect.width) * 2;
    canvas.height = Math.max(1, rect.height + headerHeight + legendHeight) * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height + headerHeight + legendHeight);

    const periodLabel = imgExactDate
      ? new Date(`${imgExactDate}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : `${imgDays}j`;
    const pointsLabel = currentChartOpt.perPoint
      ? (imgPoints.size > 0
        ? Array.from(imgPoints).map(id => pointNameMap.get(id) ?? id).slice(0, 4).join(', ') + (imgPoints.size > 4 ? ` +${imgPoints.size - 4}` : '')
        : `Tous (${points.length})`)
      : 'Tous points';

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Segoe UI, Arial, sans-serif';
    ctx.fillText(`SIMES - ${selectedTerrain?.name ?? terrainLabel}`, 14, 22);
    ctx.font = '12px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`Metrique: ${currentChartOpt.label}`, 14, 42);
    ctx.fillText(`Periode: ${periodLabel}`, 14, 58);
    ctx.fillText(`Points: ${pointsLabel}`, Math.max(280, rect.width * 0.42), 42);
    ctx.fillText(`Genere le ${new Date().toLocaleString('fr-FR')}`, Math.max(280, rect.width * 0.42), 58);

    const img = new window.Image();
    img.onload = () => {
      ctx.drawImage(img, 0, headerHeight, rect.width, rect.height);

      if (exportLegendNames.length) {
        const startY = headerHeight + rect.height + 18;
        const colWidth = rect.width / 3;
        exportLegendNames.slice(0, 12).forEach((name, idx) => {
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const x = 14 + col * colWidth;
          const y = startY + row * 22;
          ctx.fillStyle = CHART_COLORS[idx % CHART_COLORS.length];
          ctx.fillRect(x, y - 8, 12, 12);
          ctx.fillStyle = '#334155';
          ctx.font = '11px Segoe UI, Arial, sans-serif';
          const shortName = name.length > 34 ? `${name.slice(0, 34)}...` : name;
          ctx.fillText(shortName, x + 18, y + 2);
        });
      }

      const pngUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      const ptLabel = imgPoints.size === 1
        ? sanitize(pointNameMap.get(Array.from(imgPoints)[0]) ?? '')
        : imgPoints.size > 1 ? `${imgPoints.size}_points` : 'tous';
      const periodToken = imgExactDate ? sanitize(imgExactDate) : `${imgDays}j`;
      a.download = `${terrainLabel}_${imgChartType}_${ptLabel}_${periodToken}.png`;
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, [terrainLabel, imgDays, imgExactDate, imgChartType, imgPoints, pointNameMap, exportLegendNames, currentChartOpt, points.length, selectedTerrain?.name]);

  // ── Per-point CSV export ──
  const handleExportPointCSV = useCallback((pointId: string) => {
    const ptReadings = readings.filter(r => String(r.point_id) === pointId);
    if (!ptReadings.length) return;
    const point = points.find(p => String(p.id) === pointId);
    const pointName = point ? sanitize(String(point.name)) : `point-${pointId}`;
    const columns = ['time', ...CSV_METRIC_COLS];
    const header = columns.join(',') + '\n';
    const rows = [...ptReadings]
      .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())
      .map(r => columns.map(c => r[c] ?? '').join(','))
      .join('\n');
    downloadBlob(
      new Blob([header + rows], { type: 'text/csv' }),
      `${terrainLabel}_${pointName}_${days}j_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }, [readings, points, terrainLabel, days]);

  // ── Per-point JSON export ──
  const handleExportPointJSON = useCallback((pointId: string) => {
    const ptReadings = readings.filter(r => String(r.point_id) === pointId);
    if (!ptReadings.length) return;
    const point = points.find(p => String(p.id) === pointId);
    const pointName = point ? sanitize(String(point.name)) : `point-${pointId}`;
    const sorted = [...ptReadings].sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime());
    const payload = {
      terrain: selectedTerrain?.name ?? selectedTerrainId,
      point: point?.name ?? pointId,
      category: point?.measure_category ?? null,
      zone: point?.zone_name ?? null,
      export_date: new Date().toISOString(),
      period_days: days,
      readings: sorted.map(r => {
        const { point_id, ...rest } = r as Record<string, unknown>;
        return rest;
      }),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `${terrainLabel}_${pointName}_${days}j_${new Date().toISOString().slice(0, 10)}.json`,
    );
  }, [readings, points, selectedTerrain, selectedTerrainId, terrainLabel, days]);

  // Batch export selected points
  const [batchFormat, setBatchFormat] = useState<'excel' | 'csv' | 'json'>('excel');
  const handleBatchExport = async () => {
    setBatchExporting(true);
    for (const pointId of selectedPoints) {
      if (batchFormat === 'csv') handleExportPointCSV(pointId);
      else if (batchFormat === 'json') handleExportPointJSON(pointId);
      else await handleExportExcel(pointId);
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
            <Button variant="outline" size="sm" onClick={exportChartImage} disabled={!imgChartData.length}>
              <FileImage className="w-4 h-4 mr-1" />
              Image graphique
            </Button>
            {selectedPoints.size > 0 && (
              <div className="flex items-center gap-1 border rounded-md pl-1">
                <Select value={batchFormat} onValueChange={v => setBatchFormat(v as typeof batchFormat)}>
                  <SelectTrigger className="w-24 h-8 border-0 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excel">Excel</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleBatchExport} disabled={batchExporting} className="h-8">
                  {batchExporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
                  {selectedPoints.size} point{selectedPoints.size > 1 ? 's' : ''}
                </Button>
              </div>
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

      {/* Configurable chart image export */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <FileImage className="w-4 h-4 text-primary" />
              Export image — Graphique
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportChartImage} disabled={!imgChartData.length}>
              <Download className="w-3 h-3" /> Exporter PNG
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls row */}
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Période</label>
              <div className="flex gap-1">
                {IMG_PERIODS.map(p => (
                  <Button
                    key={p.key}
                    variant={!imgExactDate && imgDays === Number(p.key) ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => {
                      setImgDays(Number(p.key));
                      setImgExactDate('');
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Date précise (optionnel)</label>
              <input
                type="date"
                value={imgExactDate}
                onChange={e => setImgExactDate(e.target.value)}
                className="h-9 rounded border px-2 text-sm bg-background"
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Type de graphique</label>
              <Select value={imgChartType} onValueChange={v => setImgChartType(v as ChartType)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHART_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {currentChartOpt.perPoint && points.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Points ({imgPoints.size || 'tous'})</label>
                <div className="flex flex-wrap gap-1">
                  {points.map((p, i) => {
                    const pid = String(p.id);
                    const active = imgPoints.has(pid) || imgPoints.size === 0;
                    return (
                      <button
                        key={pid}
                        onClick={() => toggleImgPoint(pid)}
                        className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          active
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-muted-foreground/20 text-muted-foreground'
                        }`}
                        style={active ? { borderColor: CHART_COLORS[i % CHART_COLORS.length] + '88' } : undefined}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Chart preview */}
          {imgLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Chargement des données…
            </div>
          ) : imgChartData.length > 0 ? (
            <div ref={chartRef}>
              <ResponsiveContainer width="100%" height={300}>
                {imgChartType === 'daily-power' ? (
                  <AreaChart data={imgChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit=" kW" domain={dailyPowerDomain as any} />
                    <Tooltip wrapperClassName="!bg-card !border-border" contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="avg" stroke="#3b82f6" fill="#3b82f620" strokeWidth={2} name="Puissance moyenne" />
                    <Area type="monotone" dataKey="max" stroke="#ef4444" fill="#ef444420" strokeWidth={1} strokeDasharray="3 3" name="Puissance max" />
                  </AreaChart>
                ) : imgChartType === 'daily-cost' ? (
                  <BarChart data={imgChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="bar" tick={{ fontSize: 10 }} unit={` ${currSym}`} domain={dailyCostDomain as any} />
                    <YAxis yAxisId="line" orientation="right" tick={{ fontSize: 10 }} unit={` ${currSym}`} hide domain={dailyCostCumDomain as any} />
                    <Tooltip wrapperClassName="!bg-card !border-border" contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="bar" dataKey="cost" fill="#f59e0b" radius={[3, 3, 0, 0]} name={`Coût (${currSym})`} />
                    <Line yAxisId="line" type="monotone" dataKey="cumul" stroke="#d97706" strokeWidth={2} dot={false} name="Cumulé" />
                  </BarChart>
                ) : imgChartType === 'daily-co2' ? (
                  <BarChart data={imgChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="bar" tick={{ fontSize: 10 }} unit=" kg" domain={dailyCo2Domain as any} />
                    <YAxis yAxisId="line" orientation="right" tick={{ fontSize: 10 }} hide domain={dailyCo2CumDomain as any} />
                    <Tooltip wrapperClassName="!bg-card !border-border" contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="bar" dataKey="co2" fill="#86efac" radius={[3, 3, 0, 0]} name="CO₂ journalier" />
                    <Line yAxisId="line" type="monotone" dataKey="cumul" stroke="#16a34a" strokeWidth={2} dot={false} name="CO₂ cumulé" />
                  </BarChart>
                ) : (
                  <LineChart data={imgChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit={imgChartType === 'power' ? ' kW' : imgChartType === 'voltage' ? ' V' : imgChartType === 'current' ? ' A' : imgChartType === 'energy' ? ' kWh' : ''} domain={perPointDomain as any} />
                    <Tooltip wrapperClassName="!bg-card !border-border" contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {imgSeriesNames.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} dot={false} strokeWidth={1.5} connectNulls name={name} />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <BarChart3 className="w-5 h-5 opacity-60" />
              <span className="text-sm">Aucune donnée pour ce graphique</span>
            </div>
          )}
        </CardContent>
      </Card>

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
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button
                        onClick={() => handleExportPointCSV(String(point.id))}
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        title="Exporter CSV"
                      >
                        <Download className="w-3 h-3" />CSV
                      </Button>
                      <Button
                        onClick={() => handleExportPointJSON(String(point.id))}
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        title="Exporter JSON"
                      >
                        <FileJson className="w-3 h-3" />JSON
                      </Button>
                      <Button
                        onClick={() => handleExportExcel(String(point.id))}
                        disabled={exportingId === String(point.id)}
                        size="sm" variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        title="Exporter Excel"
                      >
                        {exportingId === String(point.id) ? (
                          <><Loader2 className="w-3 h-3 animate-spin" />…</>
                        ) : (
                          <><FileSpreadsheet className="w-3 h-3" />Excel</>
                        )}
                      </Button>
                    </div>
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