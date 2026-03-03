import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { StatusDot, DataQualityIndicator } from '@/components/ui/severity-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Map,
  Search,
  RefreshCw,
  Clock,
  Signal,
  ExternalLink,
  Zap,
  Sun,
  Battery,
  Fuel,
  PlugZap,
  Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPointsByTerrainId, mockMeasurementPoints, getZonesByTerrainId } from '@/lib/mock-data';
import type { MeasurementPoint } from '@/types';
import type { Zone } from '@/types/widget-engine';
import {
  ENERGY_SOURCE_LABELS,
  ENERGY_SOURCE_COLORS,
} from '@/types/widget-engine';
import { useLatestReadings } from '@/hooks/useApi';

// ── Live readings panel (real API data) ───────────────────
function LiveReadingsPanel({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useLatestReadings(terrainId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Chargement des lectures temps réel…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.count === 0) return null;

  const toMinutesAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          Lectures temps réel ({data.count} points)
        </CardTitle>
        <Badge variant="outline" className="text-[10px] badge-ok">API Live</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="data-table text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th>Point</th>
                <th>Catégorie</th>
                <th className="text-right">P (kW)</th>
                <th className="text-right">Q (kVAR)</th>
                <th className="text-right">PF</th>
                <th className="text-right">Va (V)</th>
                <th className="text-right">Vb (V)</th>
                <th className="text-right">Vc (V)</th>
                <th className="text-right">Ia (A)</th>
                <th className="text-right">Freq (Hz)</th>
                <th className="text-right">E imp (kWh)</th>
                <th className="text-right">Dernière vue</th>
              </tr>
            </thead>
            <tbody>
              {data.readings.map(r => (
                <tr key={r.point_id}>
                  <td className="font-medium">{r.point?.name ?? r.point_id.slice(0, 8)}</td>
                  <td><Badge variant="outline" className="text-[9px]">{r.point?.measure_category ?? '—'}</Badge></td>
                  <td className="text-right mono font-medium">{Number(r.active_power_total).toFixed(2)}</td>
                  <td className="text-right mono">{Number(r.reactive_power_total).toFixed(2)}</td>
                  <td className={cn('text-right mono', Number(r.power_factor_total) < 0.85 && 'text-severity-warning font-medium')}>
                    {Number(r.power_factor_total).toFixed(2)}
                  </td>
                  <td className="text-right mono">{Number(r.voltage_a).toFixed(1)}</td>
                  <td className="text-right mono">{Number(r.voltage_b).toFixed(1)}</td>
                  <td className="text-right mono">{Number(r.voltage_c).toFixed(1)}</td>
                  <td className="text-right mono">{Number(r.current_a).toFixed(2)}</td>
                  <td className="text-right mono">{Number(r.frequency).toFixed(1)}</td>
                  <td className="text-right mono">{Number(r.energy_import).toFixed(1)}</td>
                  <td className="text-right text-muted-foreground">{toMinutesAgo(r.time)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const qualityRank: Record<MeasurementPoint['dataQuality'], number> = {
  excellent: 4,
  good: 3,
  fair: 2,
  poor: 1,
};

type SourceBreakdown = {
  gridKw: number;
  pvKw: number;
  gensetKw: number;
  batteryKw: number; // positive = discharge, negative = charge
  unknownKw: number;
};

type CategoryCounts = Partial<Record<string, number>>;

type ZoneSummary = {
  zone: Zone;
  points: MeasurementPoint[];
  loadKw: number; // SUM of LOAD points only
  sources: SourceBreakdown;
  categoryCounts: CategoryCounts;
  pfMinLoad: number; // min PF among LOAD points
  thdMaxLoad: number; // max THD among LOAD points
  dataQuality: MeasurementPoint['dataQuality'];
  lastSeen: string;
  status: 'ok' | 'warning' | 'critical';
};

const toMinutes = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;

const computeZoneSummary = (zone: Zone, points: MeasurementPoint[]): ZoneSummary => {
  const loadPts = points.filter(p => p.energySourceCategory === 'LOAD');
  const loadKw = loadPts.reduce((sum, p) => sum + Math.abs(p.metrics.totalActivePower), 0);

  // PF min and THD max from LOAD points only (audit-friendly)
  const pfMinLoad = loadPts.length > 0
    ? Math.min(...loadPts.map(p => p.metrics.averagePowerFactor))
    : 0;
  const thdMaxLoad = Math.max(
    0,
    ...loadPts.flatMap(p => [p.metrics.phaseA?.thd ?? 0, p.metrics.phaseB?.thd ?? 0, p.metrics.phaseC?.thd ?? 0])
  );

  // Sources breakdown (separate, never mixed into conso)
  const sumP = (cat: string) =>
    points.filter(p => p.energySourceCategory === cat).reduce((s, p) => s + Math.abs(p.metrics.totalActivePower), 0);
  const sources: SourceBreakdown = {
    gridKw: sumP('GRID'),
    pvKw: sumP('PV'),
    gensetKw: sumP('GENSET'),
    batteryKw: points.filter(p => p.energySourceCategory === 'BATTERY')
      .reduce((s, p) => s + p.metrics.totalActivePower, 0), // signed: positive=discharge, negative=charge
    unknownKw: sumP('UNKNOWN'),
  };

  // Category counts
  const categoryCounts: CategoryCounts = {};
  points.forEach(p => { categoryCounts[p.energySourceCategory] = (categoryCounts[p.energySourceCategory] ?? 0) + 1; });

  const dataQuality = points.reduce(
    (worst, p) => (qualityRank[p.dataQuality] < qualityRank[worst] ? p.dataQuality : worst),
    'excellent' as MeasurementPoint['dataQuality']
  );
  const lastSeen = points.reduce(
    (latest, p) => (new Date(p.lastSeen) > new Date(latest) ? p.lastSeen : latest),
    points[0]?.lastSeen ?? new Date().toISOString()
  );
  const hasStale = toMinutes(lastSeen) > 15;

  let status: ZoneSummary['status'] = 'ok';
  if (hasStale || pfMinLoad < 0.8 || thdMaxLoad > 12 || dataQuality === 'poor' || points.some(p => p.status === 'critical' || p.status === 'offline')) {
    status = 'critical';
  } else if ((loadPts.length > 0 && pfMinLoad < 0.85) || thdMaxLoad > 8 || dataQuality === 'fair' || points.some(p => p.status === 'warning')) {
    status = 'warning';
  }

  return { zone, points, loadKw, sources, categoryCounts, pfMinLoad, thdMaxLoad, dataQuality, lastSeen, status };
};

export default function DataMonitor() {
  const { selectedTerrain } = useAppContext();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const allPoints = selectedTerrain ? getPointsByTerrainId(selectedTerrain.id) : mockMeasurementPoints;
  const terrainZones = selectedTerrain ? getZonesByTerrainId(selectedTerrain.id) : [];

  const zoneSummaries = useMemo(() => {
    if (terrainZones.length > 0) {
      return terrainZones.map(zone => {
        const pts = allPoints.filter(p => zone.pointIds.includes(p.id));
        return computeZoneSummary(zone, pts);
      }).sort((a, b) => a.zone.name.localeCompare(b.zone.name));
    }
    // Fallback: group by point.zone field
    const grouped = allPoints.reduce((acc, p) => {
      if (!acc[p.zone]) acc[p.zone] = [];
      acc[p.zone].push(p);
      return acc;
    }, {} as Record<string, MeasurementPoint[]>);

    return Object.entries(grouped).map(([name, pts]) => {
      const fakeZone: Zone = { id: `zone_fb_${name}`, terrainId: selectedTerrain?.id ?? '', name, pointIds: pts.map(p => p.id) };
      return computeZoneSummary(fakeZone, pts);
    }).sort((a, b) => a.zone.name.localeCompare(b.zone.name));
  }, [allPoints, terrainZones, selectedTerrain]);

  const filtered = zoneSummaries.filter(zs => zs.zone.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const terrainStatus = selectedTerrain?.status ?? 'offline';
  const terrainLastSeen = selectedTerrain?.lastSeen ?? new Date().toISOString();

  const handleZoneClick = (zs: ZoneSummary) => {
    navigate(`/terrain/${zs.zone.terrainId}/zones/${zs.zone.id}`);
  };

  const handlePointClick = (pointId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/points/${pointId}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Terrain – ${selectedTerrain?.name ?? 'Non sélectionné'}`}
        description={`Concentrateur ${selectedTerrain?.gatewayId ?? '-'} | ${zoneSummaries.length} zone(s) | ${allPoints.length} point(s)`}
      />

      {/* ── Live API readings ─────────────────────────── */}
      {selectedTerrain && <LiveReadingsPanel terrainId={selectedTerrain.id} />}

      {/* Terrain status bar (mock) */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3">
            <StatusDot status={terrainStatus} size="lg" />
            <div>
              <div className="text-xs text-muted-foreground">Statut concentrateur</div>
              <div className="text-sm font-medium capitalize">{terrainStatus}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Dernière vue</div>
              <div className="text-sm font-medium">il y a {Math.floor(toMinutes(terrainLastSeen))} min</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Signal className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Complétude 24h</div>
              <div className="text-sm font-medium">{selectedTerrain?.dataCompleteness24h.toFixed(1) ?? '0.0'}%</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Messages / min</div>
              <div className="text-sm font-medium">{selectedTerrain?.messageRate ?? 0}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher une zone…"
            className="pl-9 h-8 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Rafraîchir
        </Button>
      </div>

      {/* Zone grid - clicking navigates to zone page */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Map className="w-4 h-4" />
            Plan du terrain (zones)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">Aucune zone trouvée.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-stagger-children">
              {filtered.map(zs => (
                <button
                  key={zs.zone.id}
                  className={cn(
                    'text-left p-4 rounded-lg border transition-all duration-200 bg-card hover:bg-accent/30 hover:shadow-soft hover:-translate-y-0.5',
                    zs.status === 'warning' && 'border-severity-warning/40',
                    zs.status === 'critical' && 'border-severity-critical/40'
                  )}
                  onClick={() => handleZoneClick(zs)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{zs.zone.name}</div>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        zs.status === 'critical' ? 'badge-critical' : zs.status === 'warning' ? 'badge-warning' : 'badge-ok'
                      )}
                    >
                      {zs.status === 'critical' ? 'Critique' : zs.status === 'warning' ? 'Attention' : 'OK'}
                    </Badge>
                  </div>

                  {/* Category breakdown badges */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(zs.categoryCounts).map(([cat, count]) => (
                      <Badge key={cat} variant="outline" className="text-[9px]" style={{ borderColor: ENERGY_SOURCE_COLORS[cat as keyof typeof ENERGY_SOURCE_COLORS] }}>
                        {ENERGY_SOURCE_LABELS[cat as keyof typeof ENERGY_SOURCE_LABELS]} ({count})
                      </Badge>
                    ))}
                    <span className="text-[10px] text-muted-foreground self-center ml-1">{zs.points.length} pt(s)</span>
                  </div>

                  {/* LOAD-only Conso KPI */}
                  <div className="mt-3 p-2 rounded-md bg-muted/40 border border-dashed">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
                      <Zap className="w-3 h-3" />
                      Charges totales (LOAD)
                    </div>
                    <div className="text-lg font-semibold mono mt-0.5">{zs.loadKw.toFixed(1)} kW</div>
                    <div className="flex gap-3 mt-1 text-[10px]">
                      <span className={cn('font-medium', zs.pfMinLoad > 0 && zs.pfMinLoad < 0.85 && 'text-severity-warning')}>
                        PF min: {zs.pfMinLoad > 0 ? zs.pfMinLoad.toFixed(2) : '–'}
                      </span>
                      <span className={cn('font-medium', zs.thdMaxLoad > 8 && 'text-severity-warning')}>
                        THD max: {zs.thdMaxLoad.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Sources breakdown (never mixed into conso) */}
                  <div className="grid grid-cols-2 gap-1.5 mt-2 text-[10px]">
                    {zs.sources.gridKw > 0 && (
                      <div className="flex items-center gap-1">
                        <PlugZap className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Réseau:</span>
                        <span className="font-semibold mono">{zs.sources.gridKw.toFixed(1)} kW</span>
                      </div>
                    )}
                    {zs.sources.pvKw > 0 && (
                      <div className="flex items-center gap-1">
                        <Sun className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">PV:</span>
                        <span className="font-semibold mono">{zs.sources.pvKw.toFixed(1)} kW</span>
                      </div>
                    )}
                    {zs.sources.gensetKw > 0 && (
                      <div className="flex items-center gap-1">
                        <Fuel className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Groupe:</span>
                        <span className="font-semibold mono">{zs.sources.gensetKw.toFixed(1)} kW</span>
                      </div>
                    )}
                    {zs.sources.batteryKw !== 0 && (
                      <div className="flex items-center gap-1">
                        <Battery className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Batterie:</span>
                        <span className="font-semibold mono">
                          {zs.sources.batteryKw > 0 ? '+' : ''}{zs.sources.batteryKw.toFixed(1)} kW
                        </span>
                        <span className="text-muted-foreground">
                          ({zs.sources.batteryKw > 0 ? 'décharge' : 'charge'})
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Data quality */}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <DataQualityIndicator quality={zs.dataQuality} showLabel={false} />
                  </div>

                  {/* Quick point list with hover */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {zs.points.slice(0, 3).map(p => (
                      <Tooltip key={p.id}>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="text-[9px] cursor-pointer hover:bg-accent"
                            style={{ borderColor: ENERGY_SOURCE_COLORS[p.energySourceCategory] }}
                            onClick={(e) => handlePointClick(p.id, e)}
                          >
                            {p.name}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-1">
                            <div>{p.rawDeviceId} • {ENERGY_SOURCE_LABELS[p.energySourceCategory]}</div>
                            <div>P: {Math.abs(p.metrics.totalActivePower).toFixed(1)} kW | PF: {p.metrics.averagePowerFactor.toFixed(2)}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                    {zs.points.length > 3 && (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        +{zs.points.length - 3}
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
