import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Map, Zap, Activity, Gauge, ChevronRight, Loader2, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerrainOverview, useZones } from '@/hooks/useApi';

const fmt = (v: any, decimals = 2) => v != null && v !== '' ? Number(v).toFixed(decimals) : '—';

export default function DataMonitor() {
  const { selectedTerrain } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(terrainId);
  const { data: zonesData, isLoading: loadZ } = useZones(terrainId);

  const points = useMemo(() => (overviewData?.points ?? []) as Array<Record<string, any>>, [overviewData]);
  const zones = useMemo(() => (zonesData ?? []) as Array<Record<string, any>>, [zonesData]);
  const isLoading = loadOv || loadZ;

  // Group points by zone
  const zoneMap = useMemo(() => {
    const map = new Map<string, { zone: Record<string, any>; points: Array<Record<string, any>> }>();
    for (const z of zones) {
      map.set(String(z.id), { zone: z, points: [] });
    }
    const unassigned: Array<Record<string, any>> = [];
    for (const p of points) {
      const zid = String(p.zone_id ?? '');
      if (map.has(zid)) map.get(zid)!.points.push(p);
      else unassigned.push(p);
    }
    return { grouped: Array.from(map.values()), unassigned };
  }, [points, zones]);

  // KPIs
  const totalPower = useMemo(() => {
    return points.reduce((s, p) => {
      const r = p.readings as Record<string, any> | undefined;
      return s + (r?.active_power_total != null ? Number(r.active_power_total) : 0);
    }, 0);
  }, [points]);

  if (!terrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Supervision terrain" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Supervision terrain" description="Chargement…" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={"Terrain — " + (selectedTerrain?.name ?? '')}
        description={"Concentrateur " + (selectedTerrain?.gatewayId ?? '—')}
        actions={
          <Link to="/points"><Button variant="outline" size="sm"><Activity className="w-4 h-4 mr-1" />Tous les points</Button></Link>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Points de mesure" value={points.length} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Zones" value={zones.length} icon={<Map className="w-4 h-4" />} />
        <KpiCard label="Puissance totale" value={fmt(totalPower, 1) + ' kW'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="PF moyen" value={(() => {
          const pfs = points.map(p => (p.readings as any)?.power_factor_total).filter((v: any) => v != null).map(Number);
          return pfs.length ? fmt(pfs.reduce((s: number, v: number) => s + v, 0) / pfs.length, 3) : '—';
        })()} icon={<Gauge className="w-4 h-4" />} />
      </div>

      {/* Zones */}
      {zoneMap.grouped.map(({ zone, points: zonePoints }) => (
        <Card key={String(zone.id)}>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Map className="w-4 h-4 text-primary" />
              {String(zone.name)}
              <Badge variant="outline" className="text-[10px] ml-1">{zonePoints.length} points</Badge>
            </CardTitle>
            <Link to={`/terrain/${terrainId}/zones/${zone.id}`}>
              <Button variant="ghost" size="sm">Voir zone <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            {zonePoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun point assigné à cette zone</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table text-xs w-full">
                  <thead>
                    <tr>
                      <th className="py-2 px-2">Point</th>
                      <th className="py-2 px-2">Catégorie</th>
                      <th className="py-2 px-2 text-right">P (kW)</th>
                      <th className="py-2 px-2 text-right">PF</th>
                      <th className="py-2 px-2 text-right">Va (V)</th>
                      <th className="py-2 px-2 text-right">Ia (A)</th>
                      <th className="py-2 px-2 text-right">E imp (kWh)</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonePoints.map(p => {
                      const r = p.readings as Record<string, any> | undefined;
                      return (
                        <tr key={String(p.id)} className="hover:bg-muted/30 transition-colors">
                          <td className="py-1.5 px-2 font-medium">{String(p.name)}</td>
                          <td className="py-1.5 px-2"><Badge variant="outline" className="text-[9px]">{String(p.measure_category ?? '—')}</Badge></td>
                          <td className="py-1.5 px-2 text-right mono">{fmt(r?.active_power_total)}</td>
                          <td className={cn('py-1.5 px-2 text-right mono', r?.power_factor_total != null && Number(r.power_factor_total) < 0.85 && 'text-amber-600 font-medium')}>{fmt(r?.power_factor_total, 3)}</td>
                          <td className="py-1.5 px-2 text-right mono">{fmt(r?.voltage_a, 1)}</td>
                          <td className="py-1.5 px-2 text-right mono">{fmt(r?.current_a, 2)}</td>
                          <td className="py-1.5 px-2 text-right mono">{fmt(r?.energy_import, 1)}</td>
                          <td className="py-1.5 px-2">
                            <Link to={`/points/${p.id}`}><Button variant="ghost" size="sm" className="h-6 text-xs">Détail</Button></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Unassigned points */}
      {zoneMap.unassigned.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-muted-foreground">
              <Activity className="w-4 h-4" />
              Points hors zone
              <Badge variant="outline" className="text-[10px] ml-1">{zoneMap.unassigned.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="data-table text-xs w-full">
                <thead>
                  <tr>
                    <th className="py-2 px-2">Point</th>
                    <th className="py-2 px-2">Catégorie</th>
                    <th className="py-2 px-2 text-right">P (kW)</th>
                    <th className="py-2 px-2 text-right">PF</th>
                    <th className="py-2 px-2 text-right">Va (V)</th>
                    <th className="py-2 px-2 text-right">Ia (A)</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {zoneMap.unassigned.map(p => {
                    const r = p.readings as Record<string, any> | undefined;
                    return (
                      <tr key={String(p.id)} className="hover:bg-muted/30 transition-colors">
                        <td className="py-1.5 px-2 font-medium">{String(p.name)}</td>
                        <td className="py-1.5 px-2"><Badge variant="outline" className="text-[9px]">{String(p.measure_category ?? '—')}</Badge></td>
                        <td className="py-1.5 px-2 text-right mono">{fmt(r?.active_power_total)}</td>
                        <td className={cn('py-1.5 px-2 text-right mono', r?.power_factor_total != null && Number(r.power_factor_total) < 0.85 && 'text-amber-600 font-medium')}>{fmt(r?.power_factor_total, 3)}</td>
                        <td className="py-1.5 px-2 text-right mono">{fmt(r?.voltage_a, 1)}</td>
                        <td className="py-1.5 px-2 text-right mono">{fmt(r?.current_a, 2)}</td>
                        <td className="py-1.5 px-2">
                          <Link to={`/points/${p.id}`}><Button variant="ghost" size="sm" className="h-6 text-xs">Détail</Button></Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state when no zones */}
      {zones.length === 0 && points.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
            <Map className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucune zone ni point configuré pour ce terrain.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}