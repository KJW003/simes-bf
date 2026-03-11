import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTerrainOverview } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Layers, ArrowLeft, Zap, Activity, Gauge, CheckCircle2, AlertTriangle, Loader2, ExternalLink,
} from 'lucide-react';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

// Categorize points by measure_category
const INPUT_CATEGORIES = ['GRID', 'PV', 'GENSET'];
const OUTPUT_CATEGORIES = ['LOAD'];
const categorizePoint = (category: string) => {
  if (INPUT_CATEGORIES.includes(category)) return 'input';
  if (OUTPUT_CATEGORIES.includes(category)) return 'output';
  return 'other';
};

export default function ZonePage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const { selectedTerrainId } = useAppContext();

  const { data: overviewData, isLoading } = useTerrainOverview(selectedTerrainId);

  const allPoints = (overviewData?.points ?? []) as Array<Record<string, unknown>>;
  const zonePoints = useMemo(() =>
    allPoints.filter(p => String((p as any).zone_id) === zoneId),
    [allPoints, zoneId],
  );

  // Derive zone name from first point's zone_name or fallback
  const zoneName = zonePoints.length > 0 ? String((zonePoints[0] as any).zone_name ?? '') : '';

  // Separate points by category type
  const pointsByType = useMemo(() => {
    const input: typeof zonePoints = [];
    const output: typeof zonePoints = [];
    const other: typeof zonePoints = [];

    for (const p of zonePoints) {
      const cat = String((p as any).measure_category ?? '');
      const type = categorizePoint(cat);
      if (type === 'input') input.push(p);
      else if (type === 'output') output.push(p);
      else other.push(p);
    }

    return { input, output, other };
  }, [zonePoints]);

  // ─── Aggregated KPIs by type
  const calculateKpis = (points: typeof zonePoints) => {
    let totalPower = 0;
    let totalEnergy = 0;
    let pfSum = 0;
    let pfCount = 0;
    let onlineCount = 0;

    for (const p of points) {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      if (!r) continue;
      if (r.active_power_total != null) totalPower += Number(r.active_power_total);
      if (r.energy_total != null) totalEnergy += Number(r.energy_total);
      if (r.power_factor_total != null) { pfSum += Number(r.power_factor_total); pfCount++; }
      if (r.time) onlineCount++;
    }

    return {
      totalPower,
      totalEnergy,
      pfAvg: pfCount ? pfSum / pfCount : 0,
      pointsTotal: points.length,
      pointsOnline: onlineCount,
    };
  };

  const allKpis = useMemo(() => calculateKpis(zonePoints), [zonePoints]);
  const inputKpis = useMemo(() => calculateKpis(pointsByType.input), [pointsByType.input]);
  const outputKpis = useMemo(() => calculateKpis(pointsByType.output), [pointsByType.output]);

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Zone" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Zone" description="Chargement…" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={zoneName || `Zone ${zoneId?.slice(0, 8)}`}
        description={`${zonePoints.length} points de mesure`}
        actions={
          <Link to="/data-monitor"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Retour</Button></Link>
        }
      />

      {/* Zone KPIs - Total */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">Vue d'ensemble</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
          <KpiCard label="Puissance totale" value={fmt(allKpis.totalPower) + ' kW'} icon={<Zap className="w-4 h-4" />} />
          <KpiCard label="Énergie cumulée" value={fmt(allKpis.totalEnergy) + ' kWh'} icon={<Activity className="w-4 h-4" />} />
          <KpiCard label="PF moyen" value={fmt(allKpis.pfAvg)} icon={<Gauge className="w-4 h-4" />}
            variant={allKpis.pfAvg < 0.85 ? 'warning' : 'default'} />
          <KpiCard label="Points en ligne" value={`${allKpis.pointsOnline} / ${allKpis.pointsTotal}`} icon={<CheckCircle2 className="w-4 h-4" />}
            variant={allKpis.pointsOnline < allKpis.pointsTotal ? 'warning' : 'success'} />
          <KpiCard label="Zone" value={zoneId?.slice(0, 8) ?? '—'} icon={<Layers className="w-4 h-4" />} />
        </div>
      </div>

      {/* Input points (GRID, PV, GENSET) */}
      {pointsByType.input.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Sources (Grid, PV, Générateur)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Puissance" value={fmt(inputKpis.totalPower) + ' kW'} icon={<Zap className="w-4 h-4" />} />
            <KpiCard label="Énergie" value={fmt(inputKpis.totalEnergy) + ' kWh'} icon={<Activity className="w-4 h-4" />} />
            <KpiCard label="PF" value={fmt(inputKpis.pfAvg)} icon={<Gauge className="w-4 h-4" />} />
            <KpiCard label="Points" value={`${inputKpis.pointsOnline} / ${inputKpis.pointsTotal}`} icon={<CheckCircle2 className="w-4 h-4" />} />
          </div>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pointsByType.input.map(p => {
                  const r = (p as any).readings as Record<string, unknown> | undefined;
                  const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
                  const power = r?.active_power_total != null ? Number(r.active_power_total) : null;
                  const va = r?.voltage_a != null ? Number(r.voltage_a) : null;
                  const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
                  const hasData = !!r?.time;

                  return (
                    <Link key={String(p.id)} to={`/points/${p.id}`} className="block group">
                      <div className={cn(
                        'border rounded-lg p-4 transition-all hover:shadow-md',
                        alarm > 0 ? 'border-red-300 bg-red-50/50' : 'hover:border-primary/30',
                      )}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', hasData ? 'bg-emerald-500' : 'bg-gray-300')} />
                            <span className="font-medium text-sm truncate max-w-[150px]">{String(p.name)}</span>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{String((p as any).measure_category)}</span>
                        <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                          <div><span className="text-muted-foreground">P</span><br/>{fmt(power, 1)} W</div>
                          <div><span className="text-muted-foreground">PF</span><br/>{fmt(pf, 2)}</div>
                          <div><span className="text-muted-foreground">Va</span><br/>{fmt(va, 0)} V</div>
                          <div><span className="text-muted-foreground">E</span><br/>{fmt(r?.energy_total, 0)} Wh</div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Output points (LOAD) */}
      {pointsByType.output.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Charges (Consommateurs)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Puissance" value={fmt(outputKpis.totalPower) + ' kW'} icon={<Zap className="w-4 h-4" />} />
            <KpiCard label="Énergie" value={fmt(outputKpis.totalEnergy) + ' kWh'} icon={<Activity className="w-4 h-4" />} />
            <KpiCard label="PF" value={fmt(outputKpis.pfAvg)} icon={<Gauge className="w-4 h-4" />} />
            <KpiCard label="Points" value={`${outputKpis.pointsOnline} / ${outputKpis.pointsTotal}`} icon={<CheckCircle2 className="w-4 h-4" />} />
          </div>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pointsByType.output.map(p => {
                  const r = (p as any).readings as Record<string, unknown> | undefined;
                  const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
                  const power = r?.active_power_total != null ? Number(r.active_power_total) : null;
                  const va = r?.voltage_a != null ? Number(r.voltage_a) : null;
                  const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
                  const hasData = !!r?.time;

                  return (
                    <Link key={String(p.id)} to={`/points/${p.id}`} className="block group">
                      <div className={cn(
                        'border rounded-lg p-4 transition-all hover:shadow-md',
                        alarm > 0 ? 'border-red-300 bg-red-50/50' : 'hover:border-primary/30',
                      )}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', hasData ? 'bg-emerald-500' : 'bg-gray-300')} />
                            <span className="font-medium text-sm truncate max-w-[150px]">{String(p.name)}</span>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{String((p as any).measure_category)}</span>
                        <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                          <div><span className="text-muted-foreground">P</span><br/>{fmt(power, 1)} W</div>
                          <div><span className="text-muted-foreground">PF</span><br/>{fmt(pf, 2)}</div>
                          <div><span className="text-muted-foreground">Va</span><br/>{fmt(va, 0)} V</div>
                          <div><span className="text-muted-foreground">E</span><br/>{fmt(r?.energy_total, 0)} Wh</div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Other points */}
      {pointsByType.other.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Points non catégorisés</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pointsByType.other.map(p => {
                const r = (p as any).readings as Record<string, unknown> | undefined;
                const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
                const power = r?.active_power_total != null ? Number(r.active_power_total) : null;
                const va = r?.voltage_a != null ? Number(r.voltage_a) : null;
                const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
                const hasData = !!r?.time;

                return (
                  <Link key={String(p.id)} to={`/points/${p.id}`} className="block group">
                    <div className={cn(
                      'border rounded-lg p-4 transition-all hover:shadow-md',
                      alarm > 0 ? 'border-red-300 bg-red-50/50' : 'hover:border-primary/30',
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-2 h-2 rounded-full', hasData ? 'bg-emerald-500' : 'bg-gray-300')} />
                          <span className="font-medium text-sm truncate max-w-[150px]">{String(p.name)}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-muted-foreground">P</span><br/>{fmt(power)} kW</div>
                        <div><span className="text-muted-foreground">PF</span><br/>{fmt(pf)}</div>
                        <div><span className="text-muted-foreground">Va</span><br/>{fmt(va)} V</div>
                        <div><span className="text-muted-foreground">E</span><br/>{fmt(r?.energy_total)} kWh</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {zonePoints.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center space-y-2">
            <Layers className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucun point assigné à cette zone.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}