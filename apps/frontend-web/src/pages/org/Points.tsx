import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Activity, ExternalLink, Loader2, Eye, AlertTriangle,
  Search, LayoutGrid, Table, FolderTree, Pencil, Check, X,
} from 'lucide-react';
import { useTerrainOverview, useReadings, useUpdatePoint } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { MiniSparkline } from '@/components/ui/mini-sparkline';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtDT = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Points() {
  const { selectedTerrainId, selectedTerrain } = useAppContext();
  const { data, isLoading, isError } = useTerrainOverview(selectedTerrainId);
  const [filter, setFilter] = useState<string>('_all');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'tree'>('grid');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const updatePoint = useUpdatePoint();

  // Fetch recent readings for the selected point
  const readingsFrom = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const { data: pointReadings } = useReadings(
    selectedPointId ? selectedTerrainId : null,
    selectedPointId ? { point_id: selectedPointId, from: readingsFrom, limit: 50 } : undefined,
  );

  // Fetch 24h readings for sparklines (all points)
  const sparklineFrom = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const { data: allReadingsData } = useReadings(
    selectedTerrainId,
    { from: sparklineFrom, limit: 5000 },
  );

  // Compute sparkline data per point
  const sparklineMap = useMemo(() => {
    const map = new Map<string, number[]>();
    const readings = (allReadingsData as any)?.readings ?? [];
    if (!readings.length) return map;

    // Group by point, sort by time, extract power values
    const grouped = new Map<string, Array<{ t: number; v: number }>>();
    for (const r of readings) {
      const pid = String(r.point_id);
      if (r.active_power_total == null) continue;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push({ t: new Date(r.time).getTime(), v: Number(r.active_power_total) });
    }

    for (const [pid, vals] of grouped) {
      vals.sort((a, b) => a.t - b.t);
      // Downsample to ~20 points for sparkline
      const step = Math.max(1, Math.floor(vals.length / 20));
      const downsampled = vals.filter((_, i) => i % step === 0 || i === vals.length - 1).map(v => v.v);
      map.set(pid, downsampled);
    }

    return map;
  }, [allReadingsData]);

  const handleRename = async (pointId: string) => {
    if (!renameValue.trim()) return;
    await updatePoint.mutateAsync({ pointId, name: renameValue.trim() });
    setRenamingId(null);
  };

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description="Sélectionnez un terrain"
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain dans la barre supérieure pour voir les points.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description={selectedTerrain?.name ?? 'Terrain'}
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card>
          <CardContent className="py-6 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description={selectedTerrain?.name ?? 'Terrain'}
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card className="border-red-200 bg-red-50/30">
          <CardContent className="py-6 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <span className="text-sm text-red-700">Erreur lors du chargement des points</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const points = (data?.points ?? []) as Array<Record<string, unknown>>;
  const zones = (data?.zones ?? []) as Array<Record<string, unknown>>;
  const categories = [...new Set(points.map(p => String((p as any).measure_category ?? 'autre')))];

  // Filter → search → sort (solar/PV to bottom)
  const filteredPoints = useMemo(() => {
    let pts = filter === '_all' ? points : points.filter(p => String((p as any).measure_category) === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      pts = pts.filter(p =>
        String(p.name).toLowerCase().includes(q) ||
        String((p as any).measure_category ?? '').toLowerCase().includes(q) ||
        String((p as any).device ?? '').toLowerCase().includes(q)
      );
    }
    // Sort: solar/PV points to bottom
    return [...pts].sort((a, b) => {
      const aIsPV = String((a as any).measure_category ?? '').toLowerCase() === 'pv' ? 1 : 0;
      const bIsPV = String((b as any).measure_category ?? '').toLowerCase() === 'pv' ? 1 : 0;
      return aIsPV - bIsPV;
    });
  }, [points, filter, searchQuery]);

  // Helper: get point status info
  const getPointStatus = (p: Record<string, unknown>) => {
    const r = (p as any).readings as Record<string, unknown> | null;
    const lastSeen = (p as any).lastSeen as string | null;
    const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;
    const stale = minutesAgo != null && minutesAgo > 30;
    const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
    const isOnline = r && !stale;
    return { r, lastSeen, minutesAgo, stale, alarm, isOnline };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Points de mesure"
        description={selectedTerrain?.name ?? 'Terrain'}
        breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
      />

      {/* Filter + Search bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un point…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Filtrer par catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Toutes les catégories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-1 ml-auto">
          <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0" onClick={() => setViewMode('grid')} title="Vue grille">
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button variant={viewMode === 'table' ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0" onClick={() => setViewMode('table')} title="Vue tableau">
            <Table className="w-4 h-4" />
          </Button>
          <Button variant={viewMode === 'tree' ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0" onClick={() => setViewMode('tree')} title="Vue par zone">
            <FolderTree className="w-4 h-4" />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredPoints.length} / {points.length} points
        </span>
      </div>

      {/* Content based on view mode */}
      {filteredPoints.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun point de mesure trouvé.
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        /* ── GRID VIEW ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredPoints.map(p => {
            const { r, minutesAgo, stale, alarm, isOnline } = getPointStatus(p);
            const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
            const zoneName = zones.find(z => String(z.id) === String((p as any).zone_id))?.name as string | undefined;

            return (
              <Card
                key={String(p.id)}
                className={cn(
                  'transition-all hover:shadow-md cursor-pointer',
                  alarm > 0 && 'border-red-300 bg-red-50/30',
                  stale && !alarm && 'border-amber-200 bg-amber-50/20',
                )}
              >
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        alarm > 0 ? 'bg-red-500 animate-pulse' : isOnline ? 'bg-emerald-500' : stale ? 'bg-amber-400' : 'bg-gray-300'
                      )} />
                      {renamingId === String(p.id) ? (
                        <div className="flex items-center gap-1">
                          <Input className="h-6 text-sm w-28" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleRename(String(p.id))} />
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRename(String(p.id))}><Check className="w-3 h-3 text-green-600" /></Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setRenamingId(null)}><X className="w-3 h-3" /></Button>
                        </div>
                      ) : (
                        <CardTitle className="text-sm font-medium truncate">{String(p.name)}</CardTitle>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setRenamingId(String(p.id)); setRenameValue(String(p.name)); }}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setSelectedPointId(String(p.id)); }}>
                        <Eye className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1">{String((p as any).measure_category ?? '—')}</Badge>
                    <Badge variant={isOnline ? 'default' : 'secondary'} className={cn('text-[9px] px-1', isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                      {isOnline ? 'En ligne' : 'Hors ligne'}
                    </Badge>
                    {zoneName && <span className="text-[10px] text-muted-foreground">Zone: {zoneName}</span>}
                    {minutesAgo != null && <span className={cn('text-[10px]', stale && 'text-amber-600 font-medium')}>il y a {minutesAgo} min</span>}
                  </div>
                </CardHeader>

                {r && (
                  <CardContent className="px-4 pb-3 pt-1">
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">P</span>
                        <span className="mono font-medium">{fmt(r.active_power_total)} kW</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Va / Vb / Vc</span>
                        <span className="mono font-medium">{fmt(r.voltage_a)} / {fmt(r.voltage_b)} / {fmt(r.voltage_c)} V</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ia / Ib / Ic</span>
                        <span className="mono font-medium">{fmt(r.current_a)} / {fmt(r.current_b)} / {fmt(r.current_c)} A</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PF</span>
                        <span className={cn('mono font-medium', pf != null && pf < 0.85 && 'text-amber-600')}>{fmt(r.power_factor_total)}</span>
                      </div>
                    </div>
                    {/* 24h trend sparkline */}
                    {sparklineMap.has(String(p.id)) && (
                      <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">24h</span>
                        <MiniSparkline
                          data={sparklineMap.get(String(p.id))!}
                          width={100}
                          height={24}
                          color={isOnline ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                        />
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ) : viewMode === 'table' ? (
        /* ── TABLE VIEW ── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Statut</th>
                    <th className="px-4 py-2 font-medium">Nom</th>
                    <th className="px-4 py-2 font-medium">Catégorie</th>
                    <th className="px-4 py-2 font-medium">Zone</th>
                    <th className="px-4 py-2 font-medium text-right">P (kW)</th>
                    <th className="px-4 py-2 font-medium text-right">PF</th>
                    <th className="px-4 py-2 font-medium text-right">E imp (kWh)</th>
                    <th className="px-4 py-2 font-medium text-right">Dernière donnée</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPoints.map(p => {
                    const { r, minutesAgo, isOnline } = getPointStatus(p);
                    const zoneName = zones.find(z => String(z.id) === String((p as any).zone_id))?.name as string | undefined;
                    return (
                      <tr key={String(p.id)} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2">
                          <Badge variant={isOnline ? 'default' : 'secondary'} className={cn('text-[9px]', isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                            {isOnline ? 'En ligne' : 'Hors ligne'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-medium">
                          {renamingId === String(p.id) ? (
                            <div className="flex items-center gap-1">
                              <Input className="h-6 text-sm w-32" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && handleRename(String(p.id))} />
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRename(String(p.id))}><Check className="w-3 h-3 text-green-600" /></Button>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setRenamingId(null)}><X className="w-3 h-3" /></Button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1">
                              {String(p.name)}
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100" onClick={() => { setRenamingId(String(p.id)); setRenameValue(String(p.name)); }}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2"><Badge variant="outline" className="text-[9px]">{String((p as any).measure_category ?? '—')}</Badge></td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{zoneName ?? '—'}</td>
                        <td className="px-4 py-2 text-right mono">{r ? fmt(r.active_power_total) : '—'}</td>
                        <td className="px-4 py-2 text-right mono">{r ? fmt(r.power_factor_total, 3) : '—'}</td>
                        <td className="px-4 py-2 text-right mono">{r ? fmt(r.energy_import, 1) : '—'}</td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground">{minutesAgo != null ? `il y a ${minutesAgo} min` : '—'}</td>
                        <td className="px-4 py-2">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedPointId(String(p.id))}>
                            <Eye className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ── TREE VIEW (grouped by zone) ── */
        <div className="space-y-4">
          {(() => {
            const grouped = new Map<string, { zoneName: string; pts: typeof filteredPoints }>();
            const unassigned: typeof filteredPoints = [];
            for (const p of filteredPoints) {
              const zid = String((p as any).zone_id ?? '');
              const zone = zones.find(z => String(z.id) === zid);
              if (zone) {
                if (!grouped.has(zid)) grouped.set(zid, { zoneName: String(zone.name), pts: [] });
                grouped.get(zid)!.pts.push(p);
              } else {
                unassigned.push(p);
              }
            }
            return (
              <>
                {Array.from(grouped.entries()).map(([zid, { zoneName, pts }]) => (
                  <Card key={zid}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FolderTree className="w-4 h-4 text-primary" />
                        {zoneName}
                        <Badge variant="outline" className="text-[10px]">{pts.length} points</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-1">
                        {pts.map(p => {
                          const { r, minutesAgo, isOnline } = getPointStatus(p);
                          return (
                            <div key={String(p.id)} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 transition-colors text-sm">
                              <div className="flex items-center gap-2">
                                <div className={cn('w-2 h-2 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-gray-300')} />
                                <span className="font-medium">{String(p.name)}</span>
                                <Badge variant="outline" className="text-[9px]">{String((p as any).measure_category ?? '—')}</Badge>
                                <Badge variant={isOnline ? 'default' : 'secondary'} className={cn('text-[9px]', isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                                  {isOnline ? 'En ligne' : 'Hors ligne'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {r && <span className="mono">{fmt(r.active_power_total)} kW</span>}
                                {minutesAgo != null && <span>il y a {minutesAgo} min</span>}
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedPointId(String(p.id))}>
                                  <Eye className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {unassigned.length > 0 && (
                  <Card className="border-dashed">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                        <Activity className="w-4 h-4" />
                        Hors zone
                        <Badge variant="outline" className="text-[10px]">{unassigned.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-1">
                        {unassigned.map(p => {
                          const { r, minutesAgo, isOnline } = getPointStatus(p);
                          return (
                            <div key={String(p.id)} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 transition-colors text-sm">
                              <div className="flex items-center gap-2">
                                <div className={cn('w-2 h-2 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-gray-300')} />
                                <span className="font-medium">{String(p.name)}</span>
                                <Badge variant="outline" className="text-[9px]">{String((p as any).measure_category ?? '—')}</Badge>
                                <Badge variant={isOnline ? 'default' : 'secondary'} className={cn('text-[9px]', isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                                  {isOnline ? 'En ligne' : 'Hors ligne'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {r && <span className="mono">{fmt(r.active_power_total)} kW</span>}
                                {minutesAgo != null && <span>il y a {minutesAgo} min</span>}
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedPointId(String(p.id))}>
                                  <Eye className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Detail Modal */}
      <PointDetailModal
        point={selectedPointId ? filteredPoints.find(p => String(p.id) === selectedPointId) ?? null : null}
        readings={(pointReadings as any)?.readings ?? []}
        zones={zones}
        onClose={() => setSelectedPointId(null)}
      />
    </div>
  );
}

function PointDetailModal({
  point,
  readings,
  zones,
  onClose,
}: {
  point: Record<string, unknown> | null;
  readings: Array<Record<string, unknown>>;
  zones: Array<Record<string, unknown>>;
  onClose: () => void;
}) {
  if (!point) return null;

  const r = (point as any).readings as Record<string, unknown> | null;
  const zoneName = zones.find(z => String(z.id) === String((point as any).zone_id))?.name as string | undefined;
  const lastSeen = (point as any).lastSeen as string | null;
  const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;

  const fields: Array<{ label: string; value: string; unit?: string; warn?: boolean }> = r ? [
    { label: 'P totale', value: fmt(r.active_power_total), unit: 'kW' },
    { label: 'Q totale', value: fmt(r.reactive_power_total), unit: 'kvar' },
    { label: 'S totale', value: fmt(r.apparent_power_total), unit: 'kVA' },
    { label: 'P phase A', value: fmt(r.active_power_a), unit: 'kW' },
    { label: 'P phase B', value: fmt(r.active_power_b), unit: 'kW' },
    { label: 'P phase C', value: fmt(r.active_power_c), unit: 'kW' },
    { label: 'Tension A', value: fmt(r.voltage_a), unit: 'V' },
    { label: 'Tension B', value: fmt(r.voltage_b), unit: 'V' },
    { label: 'Tension C', value: fmt(r.voltage_c), unit: 'V' },
    { label: 'Courant A', value: fmt(r.current_a), unit: 'A' },
    { label: 'Courant B', value: fmt(r.current_b), unit: 'A' },
    { label: 'Courant C', value: fmt(r.current_c), unit: 'A' },
    { label: 'Facteur de puissance', value: fmt(r.power_factor_total), warn: r.power_factor_total != null && Number(r.power_factor_total) < 0.85 },
    { label: 'THD courant A', value: fmt(r.thdi_a), unit: '%' },
    { label: 'THD courant B', value: fmt(r.thdi_b), unit: '%' },
    { label: 'THD courant C', value: fmt(r.thdi_c), unit: '%' },
    { label: 'Énergie import', value: fmt(r.energy_import), unit: 'kWh' },
    { label: 'Énergie export', value: fmt(r.energy_export), unit: 'kWh' },
  ] : [];

  const histCols = ['time', 'active_power_total', 'voltage_a', 'voltage_b', 'voltage_c', 'current_a', 'current_b', 'current_c', 'power_factor_total', 'energy_import'] as const;
  const histLabels: Record<string, string> = {
    time: 'Heure', active_power_total: 'P (kW)', voltage_a: 'Va', voltage_b: 'Vb', voltage_c: 'Vc',
    current_a: 'Ia', current_b: 'Ib', current_c: 'Ic', power_factor_total: 'PF', energy_import: 'E imp (kWh)',
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            {String(point.name)}
            <Badge variant="outline" className="text-[10px] ml-2">{String((point as any).measure_category ?? '—')}</Badge>
            {zoneName && <span className="text-sm text-muted-foreground font-normal">— Zone: {zoneName}</span>}
          </DialogTitle>
          <DialogDescription className="sr-only">Détail du point de mesure</DialogDescription>
        </DialogHeader>

        {/* Metadata */}
        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
          {minutesAgo != null && <span>Dernière donnée: il y a {minutesAgo} min</span>}
          {(point as any).device && <span>Appareil: {String((point as any).device)}</span>}
          {(point as any).modbus_addr != null && <span>Modbus: {String((point as any).modbus_addr)}</span>}
        </div>

        {/* Current values grid */}
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-2">
          {fields.filter(f => f.value !== '—').map(f => (
            <div key={f.label} className="rounded-lg border p-2">
              <div className="text-[10px] text-muted-foreground">{f.label}</div>
              <div className={cn('text-sm font-semibold mono', f.warn && 'text-amber-600')}>
                {f.value} {f.unit && <span className="text-[10px] text-muted-foreground font-normal">{f.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Previous packets table */}
        <div className="mt-4">
          <h4 className="text-sm font-semibold mb-2">Paquets récents ({readings.length})</h4>
          {readings.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">Aucun paquet disponible</div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto border rounded-md">
              <table className="text-xs w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    {histCols.map(c => <th key={c} className="px-2 py-1.5 text-left font-medium">{histLabels[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {readings.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/20">
                      {histCols.map(c => (
                        <td key={c} className="px-2 py-1 mono">
                          {c === 'time' ? fmtDT(String(row[c])) : fmt(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Link to point detail page */}
        <div className="flex justify-end mt-2">
          <Link to={`/points/${String(point.id)}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="w-3 h-3 mr-1" /> Voir page complète
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
