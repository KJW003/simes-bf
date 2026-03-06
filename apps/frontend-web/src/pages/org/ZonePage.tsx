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

  // ─── Aggregated KPIs
  const kpis = useMemo(() => {
    let totalPower = 0;
    let totalEnergy = 0;
    let pfSum = 0;
    let pfCount = 0;
    let onlineCount = 0;

    for (const p of zonePoints) {
      const r = (p as any).readings as Record<string, unknown> | undefined;
      if (!r) continue;
      if (r.active_power_total != null) totalPower += Number(r.active_power_total);
      if (r.energy_import != null) totalEnergy += Number(r.energy_import);
      if (r.power_factor_total != null) { pfSum += Number(r.power_factor_total); pfCount++; }
      // Consider point "online" if it has a recent reading
      if (r.time) onlineCount++;
    }

    return {
      totalPower,
      totalEnergy,
      pfAvg: pfCount ? pfSum / pfCount : 0,
      pointsTotal: zonePoints.length,
      pointsOnline: onlineCount,
    };
  }, [zonePoints]);

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

      {/* Zone KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Puissance totale" value={fmt(kpis.totalPower, 0) + ' W'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="Énergie cumulée" value={fmt(kpis.totalEnergy, 0) + ' Wh'} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="PF moyen" value={fmt(kpis.pfAvg, 3)} icon={<Gauge className="w-4 h-4" />}
          variant={kpis.pfAvg < 0.85 ? 'warning' : 'default'} />
        <KpiCard label="Points en ligne" value={`${kpis.pointsOnline} / ${kpis.pointsTotal}`} icon={<CheckCircle2 className="w-4 h-4" />}
          variant={kpis.pointsOnline < kpis.pointsTotal ? 'warning' : 'success'} />
        <KpiCard label="Zone" value={zoneId?.slice(0, 8) ?? '—'} icon={<Layers className="w-4 h-4" />} />
      </div>

      {/* Points grid */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Points de mesure de la zone</CardTitle></CardHeader>
        <CardContent>
          {zonePoints.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Aucun point dans cette zone</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {zonePoints.map(p => {
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
                        <div>
                          <span className="text-muted-foreground">Puissance</span>
                          <div className="mono font-medium">{power != null ? fmt(power, 0) + ' W' : '—'}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tension A</span>
                          <div className="mono font-medium">{va != null ? fmt(va, 1) + ' V' : '—'}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">PF</span>
                          <div className={cn('mono font-medium', pf != null && pf < 0.85 && 'text-amber-600')}>
                            {pf != null ? pf.toFixed(3) : '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">État</span>
                          <div>
                            {alarm > 0
                              ? <Badge variant="destructive" className="text-[9px] px-1.5">ALARME</Badge>
                              : hasData
                                ? <Badge variant="outline" className="text-[9px] px-1.5 badge-ok">OK</Badge>
                                : <Badge variant="outline" className="text-[9px] px-1.5">HORS LIGNE</Badge>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}