import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useOrgs, useAllSites, useAllTerrains } from '@/hooks/useApi';
import api from '@/lib/api';
import type { ApiOrg, ApiSite, ApiTerrain, ApiMeasurementPoint } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Trash2, AlertTriangle, Loader2, CheckCircle2, Database, Filter,
  Building2, MapPin, Layers, Activity, Search, Calendar, Zap,
} from 'lucide-react';

export default function PurgeReadings() {
  const { currentUser } = useAppContext();
  
  // ─── Auth check — super admin only ─────────────────────────
  if (currentUser.role !== 'platform_super_admin') {
    return <Navigate to="/platform" replace />;
  }

  // ─── Search & filter state ────────────────────────────────
  const [searchText, setSearchText] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [terrainFilter, setTerrainFilter] = useState('');

  // ─── Selected points
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());

  // ─── Date range
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ─── Purge state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<{
    points_purged: number;
    details: Array<{ point_id: string; point_name: string; deleted: { readings: number; agg_15m: number; agg_daily: number } }>;
    totals: { readings: number; agg_15m: number; agg_daily: number };
    range: { from: string | null; to: string | null };
  } | null>(null);

  // ─── Load all data ───────────────────────────────────────
  const { data: orgs = [] } = useOrgs() as { data: ApiOrg[] | undefined };
  const { data: allSitesRaw = [] } = useAllSites() as { data: (ApiSite & { org_name?: string })[] | undefined };
  const { data: allTerrainsRaw = [] } = useAllTerrains() as { data: (ApiTerrain & { site_name?: string; org_name?: string; org_id?: string })[] | undefined };
  const [allPoints, setAllPoints] = useState<ApiMeasurementPoint[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);

  // Load all points from all terrains
  useEffect(() => {
    const loadAllPoints = async () => {
      setLoadingPoints(true);
      try {
        const allPts: ApiMeasurementPoint[] = [];
        for (const terrain of allTerrainsRaw) {
          try {
            const pts = await api.getPoints(terrain.id);
            if (Array.isArray(pts)) {
              allPts.push(...pts);
            }
          } catch {
            // Silently skip terrains that fail
          }
        }
        setAllPoints(allPts);
      } finally {
        setLoadingPoints(false);
      }
    };

    if (allTerrainsRaw.length > 0) {
      loadAllPoints();
    } else {
      setAllPoints([]);
    }
  }, [allTerrainsRaw]);

  // ─── Build terrain and point maps ─────────────────────────
  const terrainMap = useMemo(() => Object.fromEntries(allTerrainsRaw.map(t => [t.id, t])), [allTerrainsRaw]);
  const pointTerrainMap = useMemo(() => {
    const m = new Map<string, string>();
    allTerrainsRaw.forEach(t => {
      // Each terrain has points, we'll populate this as we filter
    });
    return m;
  }, [allTerrainsRaw]);

  // ─── Filter points by search + org/site/terrain ──────────
  const filteredPoints = useMemo(() => {
    let filtered = allPoints;

    if (searchText) {
      const lower = searchText.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(lower));
    }

    if (terrainFilter) {
      filtered = filtered.filter(p => p.terrain_id === terrainFilter);
    }

    if (siteFilter && !terrainFilter) {
      const siteTerrainsIds = allTerrainsRaw
        .filter(t => t.site_id === siteFilter)
        .map(t => t.id);
      filtered = filtered.filter(p => siteTerrainsIds.includes(p.terrain_id));
    }

    if (orgFilter && !siteFilter) {
      const orgSiteIds = allSitesRaw
        .filter(s => s.organization_id === orgFilter)
        .map(s => s.id);
      const orgTerrainIds = allTerrainsRaw
        .filter(t => orgSiteIds.includes(t.site_id))
        .map(t => t.id);
      filtered = filtered.filter(p => orgTerrainIds.includes(p.terrain_id));
    }

    return filtered;
  }, [allPoints, searchText, orgFilter, siteFilter, terrainFilter, allTerrainsRaw, allSitesRaw]);

  // ─── Toggle point selection ──────────────────────────────
  const togglePoint = (pointId: string) => {
    const newSet = new Set(selectedPointIds);
    if (newSet.has(pointId)) {
      newSet.delete(pointId);
    } else {
      newSet.add(pointId);
    }
    setSelectedPointIds(newSet);
  };

  const toggleAll = () => {
    if (selectedPointIds.size === filteredPoints.length) {
      setSelectedPointIds(new Set());
    } else {
      setSelectedPointIds(new Set(filteredPoints.map(p => p.id)));
    }
  };

  // ─── Purge handler ────────────────────────────────────────
  const handlePurge = async () => {
    if (selectedPointIds.size === 0) return;

    setPurging(true);
    setResult(null);
    try {
      const res = await api.batchPurgeReadings({
        pointIds: Array.from(selectedPointIds),
        from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        to: dateTo ? new Date(dateTo).toISOString() : undefined,
      });
      setResult(res);
      setSelectedPointIds(new Set());
    } catch (e: any) {
      alert('Erreur: ' + (e.message || 'Échec de la suppression'));
    } finally {
      setPurging(false);
      setConfirmOpen(false);
    }
  };

  const rangeLabel = dateFrom || dateTo
    ? `${dateFrom ? new Date(dateFrom).toLocaleDateString('fr-FR') : '∞'} → ${dateTo ? new Date(dateTo).toLocaleDateString('fr-FR') : '∞'}`
    : 'TOUTES les mesures';

  const canPurge = selectedPointIds.size > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purge en masse des mesures"
        description="Sélectionner plusieurs points de mesure et supprimer leurs données télémétrie (fonction super admin)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ────────── LEFT: Filters + Selection ────────────– */}
        <div className="lg:col-span-1 space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="w-4 h-4" /> Filtres
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Organisation */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Organisation
                </label>
                <select
                  value={orgFilter}
                  onChange={e => { setOrgFilter(e.target.value); setSiteFilter(''); setTerrainFilter(''); }}
                  className={cn(
                    'w-full px-2 py-1.5 rounded border text-sm',
                    'border-input bg-background',
                    'hover:border-primary/50 focus:border-primary focus:outline-none'
                  )}
                >
                  <option value="">Toutes les orgs</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>

              {/* Site */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Site
                </label>
                <select
                  value={siteFilter}
                  onChange={e => { setSiteFilter(e.target.value); setTerrainFilter(''); }}
                  disabled={!orgFilter}
                  className={cn(
                    'w-full px-2 py-1.5 rounded border text-sm',
                    'border-input bg-background disabled:opacity-50 disabled:cursor-not-allowed',
                    'hover:border-primary/50 focus:border-primary focus:outline-none'
                  )}
                >
                  <option value="">Tous les sites</option>
                  {allSitesRaw
                    .filter(s => !orgFilter || s.organization_id === orgFilter)
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Terrain */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Terrain
                </label>
                <select
                  value={terrainFilter}
                  onChange={e => setTerrainFilter(e.target.value)}
                  disabled={!siteFilter && !orgFilter}
                  className={cn(
                    'w-full px-2 py-1.5 rounded border text-sm',
                    'border-input bg-background disabled:opacity-50 disabled:cursor-not-allowed',
                    'hover:border-primary/50 focus:border-primary focus:outline-none'
                  )}
                >
                  <option value="">Tous les terrains</option>
                  {allTerrainsRaw
                    .filter(t => !siteFilter || t.site_id === siteFilter)
                    .filter(t => !orgFilter || t.org_id === orgFilter)
                    .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* Search */}
              <div className="space-y-1.5 pt-2 border-t">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Search className="w-3 h-3" /> Recherche
                </label>
                <Input
                  placeholder="Nom du point…"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="h-8"
                />
              </div>

              {/* Selection controls */}
              <div className="pt-2 border-t space-y-2">
                <label className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm">
                  <Checkbox
                    checked={selectedPointIds.size > 0 && selectedPointIds.size === filteredPoints.length}
                    indeterminate={selectedPointIds.size > 0 && selectedPointIds.size < filteredPoints.length}
                    onChange={toggleAll}
                  />
                  <span className="text-muted-foreground">
                    {selectedPointIds.size > 0 ? `${selectedPointIds.size} sélectionné(e)s` : 'Tout sélectionner'}
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ────────── RIGHT: Points List ────────────────────– */}
        <div className="lg:col-span-2 space-y-4">
          {/* Points selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" /> Points ({filteredPoints.length})
              </CardTitle>
              <CardDescription>
                Sélectionner les points à purger ({selectedPointIds.size} sélectionné{selectedPointIds.size !== 1 ? 's' : ''})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPoints ? (
                <div className="py-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : filteredPoints.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {searchText || orgFilter || siteFilter || terrainFilter
                    ? 'Aucun point ne correspond aux filtres'
                    : 'Aucun point trouvé'}
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-2">
                    {filteredPoints.map(point => {
                      const terrain = terrainMap[point.terrain_id];
                      const isSelected = selectedPointIds.has(point.id);
                      return (
                        <div
                          key={point.id}
                          onClick={() => togglePoint(point.id)}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                            'hover:border-primary hover:bg-primary/5',
                            isSelected && 'border-primary bg-primary/10 shadow-sm'
                          )}
                        >
                          <Checkbox checked={isSelected} onChange={() => {}} className="mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{point.name}</span>
                              {point.status === 'active' && (
                                <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-300">
                                  Active
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              {point.measure_category && <div>Catégorie: {point.measure_category}</div>}
                              {terrain && <div>Terrain: {terrain.name} {terrain.site_name && `(${terrain.site_name})`}</div>}
                              {point.modbus_addr && <div>Modbus: {point.modbus_addr}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Date range + Purge button */}
          {canPurge && (
            <Card className="border-red-200/60 bg-red-50/20 animate-fade-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Plage de dates (optionnel)
                </CardTitle>
                <CardDescription>Vide = supprimer TOUTES les mesures</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Date début</label>
                    <Input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Date fin</label>
                    <Input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                  </div>
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={!canPurge || purging}
                  onClick={() => { setResult(null); setConfirmOpen(true); }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Purger {selectedPointIds.size} point{selectedPointIds.size !== 1 ? 's' : ''}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Result summary */}
      {result && (
        <Card className="border-emerald-200 bg-emerald-50/50 animate-fade-in">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-emerald-800">
                    Purge effectuée — {result.points_purged} point{result.points_purged !== 1 ? 's' : ''}
                  </div>
                  <div className="text-xs text-emerald-700/70 mt-0.5">
                    {result.range.from ? new Date(result.range.from).toLocaleString('fr-FR') : '∞'} → {result.range.to ? new Date(result.range.to).toLocaleString('fr-FR') : '∞'}
                  </div>
                </div>
              </div>

              {/* Totals */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-2 rounded bg-white border text-center">
                  <div className="text-[10px] text-muted-foreground">Readings</div>
                  <div className="text-lg font-bold text-emerald-700">{result.totals.readings.toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-white border text-center">
                  <div className="text-[10px] text-muted-foreground">Agg 15min</div>
                  <div className="text-lg font-bold text-emerald-700">{result.totals.agg_15m.toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-white border text-center">
                  <div className="text-[10px] text-muted-foreground">Agg Daily</div>
                  <div className="text-lg font-bold text-emerald-700">{result.totals.agg_daily.toLocaleString()}</div>
                </div>
              </div>

              {/* Details */}
              {result.details.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">Détail par point:</div>
                  <div className="space-y-1 text-xs">
                    {result.details.map((detail, idx) => (
                      <div key={idx} className="flex justify-between text-muted-foreground">
                        <span>{detail.point_name}</span>
                        <span>
                          {detail.deleted.readings.toLocaleString()} + {detail.deleted.agg_15m} + {detail.deleted.agg_daily}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Confirmer la suppression en masse
            </DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Les données supprimées ne pourront pas être récupérées.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Points à nettoyer</span>
                <span className="font-semibold">{selectedPointIds.size}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plage</span>
                <span className="font-semibold text-xs">{rangeLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tables</span>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-[9px]">readings</Badge>
                  <Badge variant="outline" className="text-[9px]">agg_15m</Badge>
                  <Badge variant="outline" className="text-[9px]">agg_daily</Badge>
                </div>
              </div>
            </div>

            {!dateFrom && !dateTo && (
              <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span><strong>Attention:</strong> Aucune plage définie — <strong>TOUTES</strong> les mesures de ces points seront supprimées.</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purging}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handlePurge} disabled={purging}>
              {purging ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Confirmer la suppression
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
