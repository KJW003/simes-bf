import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Map as MapIcon, Zap, Activity, Gauge, Radio, Plus, Pencil, Trash2,
  Loader2, Search, ChevronDown, ChevronRight, Eye, ExternalLink,
  FolderTree, AlertTriangle, Check, X, LayoutGrid, Table,
} from 'lucide-react';
import {
  useTerrainOverview, useZones, useCreateZone, useUpdateZone, useDeleteZone,
  useReadings, useUpdatePoint, stableFrom,
} from '@/hooks/useApi';
import api from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { MiniSparkline } from '@/components/ui/mini-sparkline';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function ZonesPoints() {
  const { selectedTerrain, selectedTerrainId } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(terrainId);
  const { data: zonesData, isLoading: loadZ } = useZones(terrainId);
  const queryClient = useQueryClient();
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const updatePoint = useUpdatePoint();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('_all');
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Record<string, any> | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [assigningPointId, setAssigningPointId] = useState<string | null>(null);
  const [assignTargetZone, setAssignTargetZone] = useState<string>('');
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set(['__unassigned']));
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'tree'>('tree');

  // Sparkline data — stableFrom keeps the query key stable within 15-min windows
  const sparklineFrom = stableFrom(24 * 3600_000);
  const { data: allReadingsData } = useReadings(terrainId, { from: sparklineFrom, limit: 5000 });
  const sparklineMap = useMemo(() => {
    const map = new Map<string, number[]>();
    const readings = (allReadingsData as any)?.readings ?? [];
    if (!readings.length) return map;
    const grouped = new Map<string, Array<{ t: number; v: number }>>();
    for (const r of readings) {
      const pid = String(r.point_id);
      if (r.active_power_total == null) continue;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push({ t: new Date(r.time).getTime(), v: Number(r.active_power_total) });
    }
    for (const [pid, vals] of grouped) {
      vals.sort((a, b) => a.t - b.t);
      const step = Math.max(1, Math.floor(vals.length / 20));
      map.set(pid, vals.filter((_, i) => i % step === 0 || i === vals.length - 1).map(v => v.v));
    }
    return map;
  }, [allReadingsData]);

  // Point detail readings
  const readingsFrom = stableFrom(24 * 3600_000);
  const { data: pointReadings } = useReadings(
    selectedPointId ? selectedTerrainId : null,
    selectedPointId ? { point_id: selectedPointId, from: readingsFrom, limit: 50 } : undefined,
  );

  const points = useMemo(() => (overviewData?.points ?? []) as Array<Record<string, any>>, [overviewData]);
  const zones = useMemo(() => (zonesData ?? []) as Array<Record<string, any>>, [zonesData]);
  const isLoading = loadOv || loadZ;
  const categories = useMemo(() => [...new Set(points.map(p => String(p.measure_category ?? 'UNKNOWN')))], [points]);

  // Group points by zone, apply filters
  const { grouped, unassigned, filteredCount } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filterPt = (p: Record<string, any>) => {
      if (categoryFilter !== '_all' && String(p.measure_category) !== categoryFilter) return false;
      if (q && !String(p.name).toLowerCase().includes(q) && !String(p.device ?? '').toLowerCase().includes(q)) return false;
      return true;
    };

    const map = new Map<string, { zone: Record<string, any>; points: Array<Record<string, any>> }>();
    for (const z of zones) map.set(String(z.id), { zone: z, points: [] });

    const unassignedPts: Array<Record<string, any>> = [];
    let count = 0;

    for (const p of points) {
      if (!filterPt(p)) continue;
      count++;
      const zid = String(p.zone_id ?? '');
      if (map.has(zid)) map.get(zid)!.points.push(p);
      else unassignedPts.push(p);
    }

    // Also filter zones by search (match zone name)
    const groupedArr = Array.from(map.values()).filter(({ zone, points: zp }) => {
      if (zp.length > 0) return true;
      if (q && String(zone.name).toLowerCase().includes(q)) return true;
      return !q; // show empty zones when no search
    });

    return { grouped: groupedArr, unassigned: unassignedPts, filteredCount: count };
  }, [points, zones, searchQuery, categoryFilter]);

  // Flat list of all filtered points (for grid/table views)
  const allFilteredPoints = useMemo(() => {
    const all = grouped.flatMap(g => g.points).concat(unassigned);
    return all;
  }, [grouped, unassigned]);

  // KPIs
  const totalPower = useMemo(
    () => points.reduce((s, p) => s + (p.readings?.active_power_total != null ? Number(p.readings.active_power_total) : 0), 0),
    [points],
  );
  const avgPF = useMemo(() => {
    const pfs = points.map(p => p.readings?.power_factor_total).filter((v: any) => v != null).map(Number);
    return pfs.length ? pfs.reduce((s, v) => s + v, 0) / pfs.length : null;
  }, [points]);

  const toggleZone = (id: string) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set(zones.map(z => String(z.id)));
    all.add('__unassigned');
    setExpandedZones(all);
  };

  const collapseAll = () => setExpandedZones(new Set());

  const handleRename = async (pointId: string) => {
    if (!renameValue.trim()) return;
    await updatePoint.mutateAsync({ pointId, name: renameValue.trim() });
    setRenamingId(null);
  };

  const getPointStatus = (p: Record<string, any>) => {
    const lastSeen = p.lastSeen as string | null;
    const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;
    const stale = minutesAgo != null && minutesAgo > 30;
    const alarm = p.readings?.alarm_state != null ? Number(p.readings.alarm_state) : 0;
    return { minutesAgo, stale, alarm, isOnline: p.readings && !stale };
  };

  if (!terrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Zones et Points de mesures" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Zones et Points de mesures" description="Chargement…" />
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    );
  }

  // Render inline point row
  const renderPointRow = (p: Record<string, any>) => {
    const status = getPointStatus(p);
    const pid = String(p.id);
    const sparkData = sparklineMap.get(pid);
    const r = p.readings as Record<string, any> | null;

    return (
      <div
        key={pid}
        className="flex items-center gap-3 py-2 px-3 rounded hover:bg-muted/40 transition-colors cursor-pointer group"
        onClick={() => setSelectedPointId(pid)}
      >
        {/* Status dot */}
        <span className={cn('w-2 h-2 rounded-full shrink-0',
          status.alarm > 0 ? 'bg-red-500 animate-pulse' :
          status.isOnline ? 'bg-green-500' :
          status.stale ? 'bg-amber-400' : 'bg-gray-300'
        )} />

        {/* Name (inline rename) */}
        <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
          {renamingId === pid ? (
            <div className="flex items-center gap-1">
              <Input className="h-6 text-xs w-36" value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(pid); if (e.key === 'Escape') setRenamingId(null); }}
                autoFocus />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRename(pid)}><Check className="w-3 h-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setRenamingId(null)}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{String(p.name)}</span>
              <button className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setRenamingId(pid); setRenameValue(String(p.name)); }}>
                <Pencil className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>

        {/* Category badge */}
        <Badge variant="outline" className="text-[9px] shrink-0">{String(p.measure_category ?? '—')}</Badge>

        {/* Live values */}
        <div className="hidden md:flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
          {r?.active_power_total != null && <span>{fmt(r.active_power_total, 1)} kW</span>}
          {r?.power_factor_total != null && <span>PF {fmt(r.power_factor_total, 3)}</span>}
        </div>

        {/* Sparkline */}
        {sparkData && sparkData.length > 2 && (
          <div className="hidden lg:block shrink-0 w-16 h-6">
            <MiniSparkline data={sparkData} />
          </div>
        )}

        {/* Alarm badge */}
        {status.alarm > 0 && (
          <Badge className="bg-red-100 text-red-700 text-[9px] shrink-0">
            <AlertTriangle className="w-3 h-3 mr-0.5" /> Alarme
          </Badge>
        )}

        {/* Last seen */}
        <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
          {status.minutesAgo != null ? (status.minutesAgo < 1 ? 'à l\'instant' : `${status.minutesAgo}m`) : '—'}
        </span>

        {/* Eye icon */}
        <Eye className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Zones et Points de mesures"
        description={selectedTerrain?.name ?? ''}
        actions={
          <Button variant="outline" size="sm" onClick={() => { setEditingZone(null); setZoneName(''); setZoneDesc(''); setZoneDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Créer une zone
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Points de mesure" value={points.length} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Zones" value={zones.length} icon={<MapIcon className="w-4 h-4" />} />
        <KpiCard label="Puissance totale" value={fmt(totalPower, 1) + ' kW'} icon={<Zap className="w-4 h-4" />} />
        <KpiCard label="PF moyen" value={avgPF != null ? fmt(avgPF, 3) : '—'} icon={<Gauge className="w-4 h-4" />} />
      </div>

      {/* Search + filter + expand/collapse */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher zone ou point…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Catégorie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Toutes catégories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>Tout ouvrir</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapseAll}>Tout fermer</Button>
        </div>
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
        <Badge variant="outline" className="text-xs">{filteredCount} point{filteredCount !== 1 ? 's' : ''}</Badge>
      </div>

      {/* ════ GRID VIEW ════ */}
      {viewMode === 'grid' && (
        allFilteredPoints.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Aucun point de mesure trouvé.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {allFilteredPoints.map(p => {
              const status = getPointStatus(p);
              const r = p.readings as Record<string, any> | null;
              const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
              const zoneName = zones.find(z => String(z.id) === String(p.zone_id))?.name as string | undefined;
              const sparkData = sparklineMap.get(String(p.id));

              return (
                <Card
                  key={String(p.id)}
                  className={cn(
                    'transition-all hover:shadow-md cursor-pointer',
                    status.alarm > 0 && 'border-red-300 bg-red-50/30',
                    status.stale && !status.alarm && 'border-amber-200 bg-amber-50/20',
                  )}
                  onClick={() => setSelectedPointId(String(p.id))}
                >
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          'w-2 h-2 rounded-full flex-shrink-0',
                          status.alarm > 0 ? 'bg-red-500 animate-pulse' : status.isOnline ? 'bg-emerald-500' : status.stale ? 'bg-amber-400' : 'bg-gray-300'
                        )} />
                        <CardTitle className="text-sm font-medium truncate">{String(p.name)}</CardTitle>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setSelectedPointId(String(p.id)); }}>
                        <Eye className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1">{String(p.measure_category ?? '—')}</Badge>
                      <Badge variant={status.isOnline ? 'default' : 'secondary'} className={cn('text-[9px] px-1', status.isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                        {status.isOnline ? 'En ligne' : 'Hors ligne'}
                      </Badge>
                      {zoneName && <span className="text-[10px] text-muted-foreground">Zone: {String(zoneName)}</span>}
                      {status.minutesAgo != null && <span className={cn('text-[10px]', status.stale && 'text-amber-600 font-medium')}>il y a {status.minutesAgo} min</span>}
                    </div>
                  </CardHeader>
                  {r && (
                    <CardContent className="px-4 pb-3 pt-1">
                      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                        <div className="rounded-md bg-muted/40 p-1.5 text-center">
                          <div className="text-[10px] text-muted-foreground">P Active</div>
                          <div className="mono font-semibold">{fmt(r.active_power_total)} <span className="text-[9px] font-normal">kW</span></div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-1.5 text-center">
                          <div className="text-[10px] text-muted-foreground">Q Réactive</div>
                          <div className="mono font-semibold">{fmt(r.reactive_power_total)} <span className="text-[9px] font-normal">kvar</span></div>
                        </div>
                        <div className="rounded-md bg-muted/40 p-1.5 text-center">
                          <div className="text-[10px] text-muted-foreground">S Apparente</div>
                          <div className="mono font-semibold">{fmt(r.apparent_power_total)} <span className="text-[9px] font-normal">kVA</span></div>
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Va / Vb / Vc</span>
                          <span className="mono font-medium">{fmt(r.voltage_a)} / {fmt(r.voltage_b)} / {fmt(r.voltage_c)} V</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">PF</span>
                          <span className={cn('mono font-medium', pf != null && pf < 0.85 && 'text-amber-600')}>{fmt(r.power_factor_total)}</span>
                        </div>
                      </div>
                      {sparkData && sparkData.length > 2 && (
                        <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">24h</span>
                          <MiniSparkline data={sparkData} width={100} height={24} color={status.isOnline ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'} />
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ════ TABLE VIEW ════ */}
      {viewMode === 'table' && (
        allFilteredPoints.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Aucun point de mesure trouvé.</CardContent></Card>
        ) : (
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
                    {allFilteredPoints.map(p => {
                      const status = getPointStatus(p);
                      const r = p.readings as Record<string, any> | null;
                      const zoneName = zones.find(z => String(z.id) === String(p.zone_id))?.name as string | undefined;
                      return (
                        <tr key={String(p.id)} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2">
                            <Badge variant={status.isOnline ? 'default' : 'secondary'} className={cn('text-[9px]', status.isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500')}>
                              {status.isOnline ? 'En ligne' : 'Hors ligne'}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 font-medium">{String(p.name)}</td>
                          <td className="px-4 py-2"><Badge variant="outline" className="text-[9px]">{String(p.measure_category ?? '—')}</Badge></td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">{zoneName ? String(zoneName) : '—'}</td>
                          <td className="px-4 py-2 text-right mono">{r ? fmt(r.active_power_total) : '—'}</td>
                          <td className="px-4 py-2 text-right mono">{r ? fmt(r.power_factor_total, 3) : '—'}</td>
                          <td className="px-4 py-2 text-right mono">{r ? fmt(r.energy_import, 1) : '—'}</td>
                          <td className="px-4 py-2 text-right text-xs text-muted-foreground">{status.minutesAgo != null ? `il y a ${status.minutesAgo} min` : '—'}</td>
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
        )
      )}

      {/* ════ TREE VIEW (Zone sections) ════ */}
      {viewMode === 'tree' && (
        <>
      {/* Zone sections */}
      {grouped.map(({ zone, points: zonePoints }) => {
        const zid = String(zone.id);
        const isOpen = expandedZones.has(zid);
        return (
          <Card key={zid}>
            <Collapsible open={isOpen} onOpenChange={() => toggleZone(zid)}>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer select-none hover:bg-muted/20 transition-colors">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <FolderTree className="w-4 h-4 text-primary" />
                    {String(zone.name)}
                    <Badge variant="outline" className="text-[10px] ml-1">{zonePoints.length} point{zonePoints.length !== 1 ? 's' : ''}</Badge>
                    {zone.description && <span className="text-xs font-normal text-muted-foreground ml-2 hidden sm:inline">{String(zone.description)}</span>}
                    <span className="flex-1" />
                    <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        setEditingZone(zone); setZoneName(String(zone.name)); setZoneDesc(String(zone.description ?? '')); setZoneDialogOpen(true);
                      }}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirmId(zid)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </span>
                  </CardTitle>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 pb-3">
                  {zonePoints.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">Aucun point dans cette zone</p>
                  ) : (
                    <div className="divide-y">{zonePoints.map(renderPointRow)}</div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}

      {/* Unassigned points */}
      {unassigned.length > 0 && (
        <Card className="border-dashed">
          <Collapsible open={expandedZones.has('__unassigned')} onOpenChange={() => toggleZone('__unassigned')}>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-2 cursor-pointer select-none hover:bg-muted/20 transition-colors">
                <CardTitle className="text-base font-medium flex items-center gap-2 text-muted-foreground">
                  {expandedZones.has('__unassigned') ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Activity className="w-4 h-4" />
                  Points hors zone
                  <Badge variant="outline" className="text-[10px] ml-1">{unassigned.length}</Badge>
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-3">
                <div className="divide-y">
                  {unassigned.map(p => renderPointRow(p))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Empty state */}
      {zones.length === 0 && points.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
            <MapIcon className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucune zone ni point configuré pour ce terrain.</p>
            <Button variant="outline" size="sm" onClick={() => { setEditingZone(null); setZoneName(''); setZoneDesc(''); setZoneDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Créer une zone
            </Button>
          </CardContent>
        </Card>
      )}
        </>
      )}

      {/* Point detail modal */}
      <Dialog open={!!selectedPointId} onOpenChange={() => setSelectedPointId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Détail du point</DialogTitle>
            <DialogDescription className="sr-only">Informations détaillées du point de mesure</DialogDescription>
          </DialogHeader>
          {selectedPointId && (() => {
            const p = points.find(pt => String(pt.id) === selectedPointId);
            if (!p) return <p className="text-sm text-muted-foreground">Point introuvable</p>;
            const r = p.readings as Record<string, any> | null;
            const zoneName2 = zones.find(z => String(z.id) === String(p.zone_id))?.name;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Nom</span><div className="font-medium">{String(p.name)}</div></div>
                  <div><span className="text-muted-foreground text-xs">Catégorie</span><div><Badge variant="outline">{String(p.measure_category)}</Badge></div></div>
                  <div><span className="text-muted-foreground text-xs">Zone</span><div>{zoneName2 ? String(zoneName2) : <span className="text-muted-foreground">Non assigné</span>}</div></div>
                  <div><span className="text-muted-foreground text-xs">Appareil</span><div>{String(p.device ?? '—')}</div></div>
                </div>

                {/* Assign / re-assign zone */}
                <div className="flex items-center gap-2">
                  <Select value={assignTargetZone || String(p.zone_id ?? '')} onValueChange={setAssignTargetZone}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Assigner à une zone…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Aucune zone</SelectItem>
                      {zones.map(z => <SelectItem key={String(z.id)} value={String(z.id)}>{String(z.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8 text-xs" disabled={!assignTargetZone} onClick={async () => {
                    await api.assignZone(selectedPointId!, assignTargetZone === '__none' ? null : assignTargetZone);
                    setAssignTargetZone('');
                    queryClient.invalidateQueries({ queryKey: ['terrain-overview'] });
                    queryClient.invalidateQueries({ queryKey: ['zones'] });
                  }}>Assigner</Button>
                </div>

                {/* Live readings */}
                {r && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      ['P active tot.', r.active_power_total, 'kW'],
                      ['Pa', r.active_power_a, 'kW'],
                      ['Pb', r.active_power_b, 'kW'],
                      ['Pc', r.active_power_c, 'kW'],
                      ['Q réactive tot.', r.reactive_power_total, 'kVAR'],
                      ['S apparente tot.', r.apparent_power_total, 'kVA'],
                      ['PF total', r.power_factor_total, ''],
                      ['PFa', r.power_factor_a, ''],
                      ['PFb', r.power_factor_b, ''],
                      ['PFc', r.power_factor_c, ''],
                      ['V(a)', r.voltage_a, 'V'],
                      ['V(b)', r.voltage_b, 'V'],
                      ['V(c)', r.voltage_c, 'V'],
                      ['Vab', r.voltage_ab, 'V'],
                      ['Vbc', r.voltage_bc, 'V'],
                      ['Vca', r.voltage_ca, 'V'],
                      ['I(a)', r.current_a, 'A'],
                      ['I(b)', r.current_b, 'A'],
                      ['I(c)', r.current_c, 'A'],
                      ['I somme', r.current_sum, 'A'],
                      ['Énergie import', r.energy_import, 'kWh'],
                      ['Énergie export', r.energy_export, 'kWh'],
                      ['Énergie totale', r.energy_total, 'kWh'],
                      ['Fréquence', r.frequency, 'Hz'],
                      ['THDi A', r.thdi_a, '%'],
                      ['THDi B', r.thdi_b, '%'],
                      ['THDi C', r.thdi_c, '%'],
                      ['THDu A', r.thdu_a, '%'],
                      ['THDu B', r.thdu_b, '%'],
                      ['THDu C', r.thdu_c, '%'],
                      ['Déséq. tension', r.voltage_unbalance, '%'],
                      ['Déséq. courant', r.current_unbalance, '%'],
                      ['Temp A', r.temp_a, '°C'],
                      ['Temp B', r.temp_b, '°C'],
                      ['Temp C', r.temp_c, '°C'],
                      ['Temp N', r.temp_n, '°C'],
                    ].filter(([, val]) => val != null && val !== 0).map(([label, val, unit]) => (
                      <div key={String(label)} className="p-2 rounded bg-muted/40">
                        <div className="text-muted-foreground">{String(label)}</div>
                        <div className="font-mono font-medium">{fmt(val)} {String(unit)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sparkline */}
                {sparklineMap.get(selectedPointId!) && (
                  <div className="h-16">
                    <MiniSparkline data={sparklineMap.get(selectedPointId!)!} height={60} />
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Create / Edit zone dialog */}
      <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingZone ? 'Modifier la zone' : 'Créer une zone'}</DialogTitle>
            <DialogDescription className="sr-only">Formulaire de gestion de zone</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Nom de la zone" value={zoneName} onChange={e => setZoneName(e.target.value)} />
            <Input placeholder="Description (optionnel)" value={zoneDesc} onChange={e => setZoneDesc(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneDialogOpen(false)}>Annuler</Button>
            <Button disabled={!zoneName.trim() || createZone.isPending || updateZone.isPending} onClick={async () => {
              if (editingZone) {
                await updateZone.mutateAsync({ zoneId: String(editingZone.id), name: zoneName.trim(), description: zoneDesc.trim() || undefined });
              } else {
                await createZone.mutateAsync({ terrainId: terrainId!, name: zoneName.trim(), description: zoneDesc.trim() || undefined });
              }
              setZoneDialogOpen(false);
            }}>
              {editingZone ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete zone confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer la zone ?</DialogTitle>
            <DialogDescription className="sr-only">Confirmation de suppression</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Les points assignés seront désassignés mais pas supprimés.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Annuler</Button>
            <Button variant="destructive" disabled={deleteZone.isPending} onClick={async () => {
              await deleteZone.mutateAsync(deleteConfirmId!);
              setDeleteConfirmId(null);
            }}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
