import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Zap, Activity, BatteryCharging, Clock, Radio, AlertTriangle,
  CheckCircle2, ExternalLink, Loader2, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useDashboard, useTerrainOverview } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

function LiveKPIs({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useDashboard(terrainId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Chargement des données temps réel...
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) return null;

  const timeAgo = data.last_update
    ? String(Math.floor((Date.now() - new Date(data.last_update).getTime()) / 60000)) + ' min'
    : '-';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Zap className="w-4 h-4 text-primary" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Puissance instantanée</div>
            <div className="text-lg font-semibold mono">{data.power_now_kw.toFixed(1)} <span className="text-xs font-normal">kW</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-import/10 p-2"><Activity className="w-4 h-4 text-energy-import" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Énergie import (aujourd'hui)</div>
            <div className="text-lg font-semibold mono">{data.energy_today.import_kwh.toFixed(1)} <span className="text-xs font-normal">kWh</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-pv/10 p-2"><BatteryCharging className="w-4 h-4 text-energy-pv" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Points actifs</div>
            <div className="text-lg font-semibold mono">{data.points_count}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2"><Clock className="w-4 h-4 text-muted-foreground" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Dernière MAJ</div>
            <div className="text-sm font-medium">il y a {timeAgo}</div>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] badge-ok">Live</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

/** Per-point live tiles — the real widget system */
function PointWidgets({ terrainId }: { terrainId: string }) {
  const { data, isLoading } = useTerrainOverview(terrainId);
  const [filter, setFilter] = useState<string>('_all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (isLoading) {
    return <Card><CardContent className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  }

  const points = (data?.points ?? []) as Array<Record<string, unknown>>;
  const zones = (data?.zones ?? []) as Array<Record<string, unknown>>;

  if (points.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Aucun point de mesure configuré pour ce terrain.
        </CardContent>
      </Card>
    );
  }

  // Categories for filter
  const categories = [...new Set(points.map(p => String((p as any).measure_category ?? 'autre')))];

  const filteredPoints = filter === '_all' ? points : points.filter(p => String((p as any).measure_category) === filter);

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          Valeurs live par point ({filteredPoints.length} / {points.length})
        </h3>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Filtrer par catégorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Toutes les catégories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredPoints.map(p => {
          const r = (p as any).readings as Record<string, unknown> | null;
          const pointId = String(p.id);
          const isCollapsed = collapsed.has(pointId);
          const hasData = !!r;
          const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
          const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
          const lastSeen = (p as any).lastSeen as string | null;
          const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;
          const stale = minutesAgo != null && minutesAgo > 30;
          const zoneName = zones.find(z => String(z.id) === String((p as any).zone_id))?.name as string | undefined;

          return (
            <Card key={pointId} className={cn(
              'transition-all hover:shadow-md',
              alarm > 0 && 'border-red-300 bg-red-50/30',
              stale && !alarm && 'border-amber-200 bg-amber-50/20',
            )}>
              <CardHeader className="pb-1 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                      alarm > 0 ? 'bg-red-500 animate-pulse' : hasData && !stale ? 'bg-emerald-500' : stale ? 'bg-amber-400' : 'bg-gray-300',
                    )} />
                    <CardTitle className="text-sm font-medium truncate">{String(p.name)}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    {alarm > 0 && <Badge variant="destructive" className="text-[9px] px-1">ALARME</Badge>}
                    <Link to={`/points/${pointId}`}>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggle(pointId)}>
                      {isCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <Badge variant="outline" className="text-[9px] px-1">{String((p as any).measure_category ?? '—')}</Badge>
                  {zoneName && <span>Zone: {String(zoneName)}</span>}
                  {minutesAgo != null && <span className={cn(stale && 'text-amber-600')}>il y a {minutesAgo} min</span>}
                </div>
              </CardHeader>

              {!isCollapsed && (
                <CardContent className="px-4 pb-3 pt-1">
                  {!hasData ? (
                    <div className="text-xs text-muted-foreground py-2">Aucune donnée reçue</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                      <div>
                        <div className="text-muted-foreground">P totale</div>
                        <div className="mono font-semibold text-sm">{fmt(r.active_power_total, 1)} <span className="text-[10px] font-normal">W</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Q totale</div>
                        <div className="mono">{fmt(r.reactive_power_total, 1)} <span className="text-[10px]">var</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">S totale</div>
                        <div className="mono">{fmt(r.apparent_power_total, 1)} <span className="text-[10px]">VA</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Va</div>
                        <div className="mono">{fmt(r.voltage_a, 1)} <span className="text-[10px]">V</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Vb</div>
                        <div className="mono">{fmt(r.voltage_b, 1)} <span className="text-[10px]">V</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Vc</div>
                        <div className="mono">{fmt(r.voltage_c, 1)} <span className="text-[10px]">V</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Ia</div>
                        <div className="mono">{fmt(r.current_a, 2)} <span className="text-[10px]">A</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Ib</div>
                        <div className="mono">{fmt(r.current_b, 2)} <span className="text-[10px]">A</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Ic</div>
                        <div className="mono">{fmt(r.current_c, 2)} <span className="text-[10px]">A</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">PF</div>
                        <div className={cn('mono', pf != null && pf < 0.85 && 'text-amber-600 font-semibold')}>
                          {fmt(r.power_factor_total, 3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Fréq</div>
                        <div className="mono">{fmt(r.frequency, 2)} <span className="text-[10px]">Hz</span></div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">E imp</div>
                        <div className="mono">{fmt(r.energy_import, 1)} <span className="text-[10px]">kWh</span></div>
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { selectedTerrain, selectedSite, selectedTerrainId, aggregatedView } = useAppContext();

  const title = aggregatedView
    ? 'Site: ' + (selectedSite?.name ?? 'Site')
    : selectedTerrain?.name ?? 'Tableau de bord';
  const description = aggregatedView
    ? 'Vue agrégée sur ' + (selectedSite?.terrainsCount ?? 0) + ' terrain(s)'
    : 'Monitoring temps réel — ' + (selectedTerrain?.pointsCount ?? 0) + ' points';

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[
          { label: 'Accueil', href: '/' },
          { label: 'Tableau de bord' },
        ]}
      />

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain dans la barre supérieure pour voir les données.
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && (
        <>
          <LiveKPIs terrainId={selectedTerrainId} />
          <PointWidgets terrainId={selectedTerrainId} />
        </>
      )}
    </div>
  );
}