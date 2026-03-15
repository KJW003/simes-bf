import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
import { toast } from 'sonner';
import {
  Trash2, AlertTriangle, Loader2, CheckCircle2,
  Building2, MapPin, Layers, Activity, Search, Calendar, ChevronRight,
  ArrowLeft, RotateCcw, History, X,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   Step badge helper
   ═══════════════════════════════════════════════════════════════ */
function StepNumber({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 transition-colors',
      done  && 'bg-emerald-100 text-emerald-700 border border-emerald-300',
      active && !done && 'bg-primary text-primary-foreground shadow',
      !active && !done && 'bg-muted text-muted-foreground border',
    )}>
      {done ? '✓' : n}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════ */
export default function PurgeReadings() {
  const { currentUser } = useAppContext();
  const isSuperAdmin = currentUser.role === 'platform_super_admin';

  // ── Step 1: cascading hierarchy ───────────────────────────
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedTerrainId, setSelectedTerrainId] = useState('');

  // ── Step 2: points for chosen terrain ─────────────────────
  const [points, setPoints] = useState<ApiMeasurementPoint[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [pointSearch, setPointSearch] = useState('');

  // ── Step 3: date range ────────────────────────────────────
  const [useRange, setUseRange] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ── Purge state ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [purgeActionError, setPurgeActionError] = useState<string | null>(null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [previewTotals, setPreviewTotals] = useState<{ readings: number; agg_15m: number; agg_daily: number } | null>(null);
  const [previewPointsFound, setPreviewPointsFound] = useState<number | null>(null);
  const [previewPointsMissing, setPreviewPointsMissing] = useState<number | null>(null);
  const [result, setResult] = useState<{
    points_purged: number;
    details?: Array<{ point_id: string; point_name: string; deleted: { readings: number; agg_15m: number; agg_daily: number } }>;
    totals: { readings: number; agg_15m: number; agg_daily: number };
    range: { from: string | null; to: string | null };
  } | null>(null);
  const [globalFrom, setGlobalFrom] = useState('');
  const [globalTo, setGlobalTo] = useState('');
  const [globalIncludeReadings, setGlobalIncludeReadings] = useState(true);
  const [globalPreviewLoading, setGlobalPreviewLoading] = useState(false);
  const [globalPreviewError, setGlobalPreviewError] = useState<string | null>(null);
  const [globalPreviewRequested, setGlobalPreviewRequested] = useState(false);
  const [globalPreviewTotals, setGlobalPreviewTotals] = useState<{ readings: number; agg_15m: number; agg_daily: number } | null>(null);
  const [globalConfirmOpen, setGlobalConfirmOpen] = useState(false);
  const [globalConfirmText, setGlobalConfirmText] = useState('');
  const [globalActionError, setGlobalActionError] = useState<string | null>(null);
  const [globalPurging, setGlobalPurging] = useState(false);
  const [globalResult, setGlobalResult] = useState<{
    range: { from: string; to: string };
    deleted: { readings: number; agg_15m: number; agg_daily: number };
  } | null>(null);

  // ── Referential data ─────────────────────────────────────
  const { data: orgs = [] } = useOrgs() as { data: ApiOrg[] | undefined };
  const { data: allSites = [] } = useAllSites() as { data: (ApiSite & { org_name?: string })[] | undefined };
  const { data: allTerrains = [] } = useAllTerrains() as { data: (ApiTerrain & { site_name?: string; org_name?: string; org_id?: string })[] | undefined };

  // ── Purge history / restore ───────────────────────────────
  type PurgeBatch = { id: string; deleted_at: string; deleted_by: string | null; point_ids: string[]; date_from: string | null; date_to: string | null; counts: { readings: number; agg_15m: number; agg_daily: number }; restored_at: string | null };
  const [batches, setBatches] = useState<PurgeBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [restoringBatchId, setRestoringBatchId] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [historyAction, setHistoryAction] = useState<
    | { type: 'restore'; batch: PurgeBatch }
    | { type: 'delete'; batch: PurgeBatch }
    | null
  >(null);
  const [historyConfirmText, setHistoryConfirmText] = useState('');

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const r = await api.getPurgeBatches();
      setBatches(r.batches || []);
    } catch { setBatches([]); }
    finally { setLoadingBatches(false); }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  // ── Cascade filtering ─────────────────────────────────────
  const filteredSites = useMemo(() =>
    selectedOrgId ? allSites.filter(s => s.organization_id === selectedOrgId) : allSites,
    [allSites, selectedOrgId]);

  const filteredTerrains = useMemo(() => {
    if (selectedSiteId) return allTerrains.filter(t => t.site_id === selectedSiteId);
    if (selectedOrgId) return allTerrains.filter(t => t.org_id === selectedOrgId);
    return allTerrains;
  }, [allTerrains, selectedOrgId, selectedSiteId]);

  // ── Load points for a terrain ─────────────────────────────
  const loadPoints = useCallback(async (terrainId: string) => {
    setSelectedTerrainId(terrainId);
    setSelectedPointIds(new Set());
    setPoints([]);
    setResult(null);
    if (!terrainId) return;
    setLoadingPoints(true);
    try {
      const pts = await api.getPoints(terrainId);
      setPoints(Array.isArray(pts) ? pts : []);
    } catch {
      setPoints([]);
    } finally {
      setLoadingPoints(false);
    }
  }, []);

  // ── Terrain info ──────────────────────────────────────────
  const terrain = allTerrains.find(t => t.id === selectedTerrainId);
  const orgName = orgs.find(o => o.id === selectedOrgId)?.name;
  const siteName = allSites.find(s => s.id === selectedSiteId)?.name;

  // ── Filtered points by search ─────────────────────────────
  const visiblePoints = useMemo(() => {
    if (!pointSearch) return points;
    const lower = pointSearch.toLowerCase();
    return points.filter(p => p.name.toLowerCase().includes(lower) || (p.measure_category || '').toLowerCase().includes(lower));
  }, [points, pointSearch]);

  // ── Selection helpers ─────────────────────────────────────
  const togglePoint = (id: string) => {
    const next = new Set(selectedPointIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedPointIds(next);
  };

  const toggleAllVisible = () => {
    if (visiblePoints.length === 0) return;
    const allSelected = visiblePoints.every(p => selectedPointIds.has(p.id));
    if (allSelected) {
      const next = new Set(selectedPointIds);
      visiblePoints.forEach(p => next.delete(p.id));
      setSelectedPointIds(next);
    } else {
      const next = new Set(selectedPointIds);
      visiblePoints.forEach(p => next.add(p.id));
      setSelectedPointIds(next);
    }
  };

  // ── Current step ──────────────────────────────────────────
  const step = !selectedTerrainId ? 1 : selectedPointIds.size === 0 ? 2 : 3;

  // ── Purge handler ─────────────────────────────────────────
  const handlePurge = async () => {
    if (selectedPointIds.size === 0) return;
    setPurging(true);
    setPurgeActionError(null);
    setResult(null);
    try {
      const res = await api.batchPurgeReadings({
        pointIds: Array.from(selectedPointIds),
        from: useRange && dateFrom ? new Date(dateFrom).toISOString() : undefined,
        to: useRange && dateTo ? new Date(dateTo).toISOString() : undefined,
      });
      setResult(res);
      setSelectedPointIds(new Set());
      loadBatches();
      setConfirmOpen(false);
      setPurgeConfirmText('');
    } catch (e: any) {
      setPurgeActionError(e?.message || 'Échec de la suppression');
    } finally {
      setPurging(false);
    }
  };

  const requiredPurgeKeyword = useRange ? 'CONFIRM-PURGE-POINTS' : 'CONFIRM-PURGE-ALL-POINTS';
  const canConfirmPurge = purgeConfirmText.trim().toUpperCase() === requiredPurgeKeyword;

  const loadPurgePreview = useCallback(async () => {
    if (!confirmOpen || selectedPointIds.size === 0) {
      setPreviewTotals(null);
      setPreviewPointsFound(null);
      setPreviewPointsMissing(null);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await api.batchPurgePreview({
        pointIds: Array.from(selectedPointIds),
        from: useRange && dateFrom ? new Date(dateFrom).toISOString() : undefined,
        to: useRange && dateTo ? new Date(dateTo).toISOString() : undefined,
      });
      setPreviewTotals(data.totals);
      setPreviewPointsFound(data.points_found);
      setPreviewPointsMissing(data.points_missing);
    } catch (e: any) {
      setPreviewTotals(null);
      setPreviewPointsFound(null);
      setPreviewPointsMissing(null);
      setPreviewError(e?.message || 'Impossible de calculer l\'impact');
    } finally {
      setPreviewLoading(false);
    }
  }, [confirmOpen, selectedPointIds, useRange, dateFrom, dateTo]);

  useEffect(() => {
    if (!confirmOpen || !previewRequested) return;
    const id = setTimeout(() => {
      loadPurgePreview();
    }, 350);
    return () => clearTimeout(id);
  }, [confirmOpen, previewRequested, useRange, dateFrom, dateTo, selectedPointIds, loadPurgePreview]);

  const openHistoryAction = (action: NonNullable<typeof historyAction>) => {
    setHistoryConfirmText('');
    setHistoryAction(action);
  };

  const closeHistoryAction = () => {
    setHistoryConfirmText('');
    setHistoryAction(null);
  };

  const requiredHistoryKeyword = historyAction?.type === 'restore' ? 'CONFIRM-RESTORE' : historyAction?.type === 'delete' ? 'CONFIRM-DELETE' : '';
  const canConfirmHistoryAction = requiredHistoryKeyword !== '' && historyConfirmText.trim().toUpperCase() === requiredHistoryKeyword;

  const executeHistoryAction = async () => {
    if (!historyAction) return;

    if (historyAction.type === 'restore') {
      setRestoringBatchId(historyAction.batch.id);
      try {
        const r = await api.restorePurgeBatch(historyAction.batch.id);
        toast.success(`Restauration : ${r.restored.readings} readings, ${r.restored.agg_15m} agg15m, ${r.restored.agg_daily} daily`);
        loadBatches();
      } catch (e: any) {
        toast.error(e.message || 'Erreur de restauration');
      } finally {
        setRestoringBatchId(null);
      }
      closeHistoryAction();
      return;
    }

    setDeletingBatchId(historyAction.batch.id);
    try {
      await api.deletePurgeBatch(historyAction.batch.id);
      toast.success('Sauvegarde supprimée');
      loadBatches();
    } catch (e: any) {
      toast.error(e.message || 'Échec de la suppression de la sauvegarde');
    } finally {
      setDeletingBatchId(null);
    }
    closeHistoryAction();
  };

  const rangeLabel = useRange && (dateFrom || dateTo)
    ? `${dateFrom ? new Date(dateFrom).toLocaleDateString('fr-FR') : '∞'} → ${dateTo ? new Date(dateTo).toLocaleDateString('fr-FR') : '∞'}`
    : 'Depuis le début — tout supprimer';

  const globalRangeLabel = globalFrom && globalTo
    ? `${new Date(globalFrom).toLocaleDateString('fr-FR')} → ${new Date(globalTo).toLocaleDateString('fr-FR')}`
    : 'Sélectionnez une plage de dates';

  const canRequestGlobalPreview = !!globalFrom && !!globalTo;
  const requiredGlobalKeyword = globalPreviewError ? 'CONFIRM-PURGE-RANGE-FORCE' : 'CONFIRM-PURGE-RANGE';
  const canConfirmGlobalPurge = globalConfirmText.trim().toUpperCase() === requiredGlobalKeyword;

  const loadGlobalPreview = useCallback(async () => {
    if (!canRequestGlobalPreview) {
      setGlobalPreviewTotals(null);
      setGlobalPreviewError(null);
      return;
    }

    setGlobalPreviewLoading(true);
    setGlobalPreviewError(null);
    try {
      const r = await api.purgeByRangePreview({
        from: globalFrom,
        to: globalTo,
        includeReadings: globalIncludeReadings,
      });
      setGlobalPreviewTotals(r.totals);
    } catch (e: any) {
      setGlobalPreviewTotals(null);
      setGlobalPreviewError(e?.message || 'Impossible de calculer la prévisualisation globale');
    } finally {
      setGlobalPreviewLoading(false);
    }
  }, [canRequestGlobalPreview, globalFrom, globalTo, globalIncludeReadings]);

  const handleGlobalPurge = useCallback(async () => {
    if (!canRequestGlobalPreview) return;
    setGlobalPurging(true);
    setGlobalActionError(null);
    try {
      const r = await api.purgeByRange({
        from: globalFrom,
        to: globalTo,
        includeReadings: globalIncludeReadings,
      });
      setGlobalResult({ range: r.range, deleted: r.deleted });
      toast.success('Purge globale exécutée avec succès');
      loadBatches();
      setGlobalConfirmOpen(false);
      setGlobalConfirmText('');
      loadGlobalPreview();
    } catch (e: any) {
      const message = e?.message || 'Échec de la purge globale';
      setGlobalActionError(message);
      toast.error(message);
    } finally {
      setGlobalPurging(false);
    }
  }, [canRequestGlobalPreview, globalFrom, globalTo, globalIncludeReadings, loadBatches, loadGlobalPreview]);

  useEffect(() => {
    if (!globalPreviewRequested) return;
    const id = setTimeout(() => {
      loadGlobalPreview();
    }, 350);
    return () => clearTimeout(id);
  }, [globalPreviewRequested, globalFrom, globalTo, globalIncludeReadings, loadGlobalPreview]);

  // ── Back handlers ─────────────────────────────────────────
  const goBackToTerrains = () => {
    setSelectedTerrainId('');
    setPoints([]);
    setSelectedPointIds(new Set());
    setResult(null);
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  if (!isSuperAdmin) {
    return <Navigate to="/platform" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purge des mesures"
        description="Supprimer les readings et agrégations (agg_15m, agg_daily) par point de mesure — sélection par organisation, site et terrain"
      />

      {/* ── Breadcrumb ────────────────────────────────────── */}
      {selectedOrgId && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
          <Building2 className="w-3 h-3" />
          <button className="hover:text-foreground underline-offset-2 hover:underline" onClick={() => { setSelectedOrgId(''); setSelectedSiteId(''); goBackToTerrains(); }}>
            {orgName ?? '…'}
          </button>
          {selectedSiteId && (
            <>
              <ChevronRight className="w-3 h-3" />
              <MapPin className="w-3 h-3" />
              <button className="hover:text-foreground underline-offset-2 hover:underline" onClick={() => { setSelectedSiteId(''); goBackToTerrains(); }}>
                {siteName ?? '…'}
              </button>
            </>
          )}
          {selectedTerrainId && terrain && (
            <>
              <ChevronRight className="w-3 h-3" />
              <Layers className="w-3 h-3" />
              <span className="text-foreground font-medium">{terrain.name}</span>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          STEP 1 — Choose Terrain (org > site > terrain)
          ═══════════════════════════════════════════════════════ */}
      {!selectedTerrainId && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <StepNumber n={1} active={true} done={false} />
            <div>
              <div className="font-semibold text-sm">Choisir un terrain</div>
              <div className="text-xs text-muted-foreground">Naviguer par organisation → site → terrain</div>
            </div>
          </div>

          {/* Org + Site filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Organisation
              </label>
              <select
                value={selectedOrgId}
                onChange={e => { setSelectedOrgId(e.target.value); setSelectedSiteId(''); }}
                className="w-full px-2 py-2 rounded-lg border text-sm border-input bg-background hover:border-primary/50 focus:border-primary focus:outline-none"
              >
                <option value="">Toutes</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Site
              </label>
              <select
                value={selectedSiteId}
                onChange={e => setSelectedSiteId(e.target.value)}
                disabled={!selectedOrgId}
                className="w-full px-2 py-2 rounded-lg border text-sm border-input bg-background disabled:opacity-50 hover:border-primary/50 focus:border-primary focus:outline-none"
              >
                <option value="">Tous</option>
                {filteredSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Terrain grid */}
          {filteredTerrains.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                Aucun terrain trouvé{selectedOrgId ? ' pour cette sélection' : ''}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredTerrains.map(t => (
                <button
                  key={t.id}
                  onClick={() => loadPoints(t.id)}
                  className="group relative flex flex-col gap-1 p-4 rounded-xl border bg-card text-left transition-all hover:border-primary hover:shadow-md hover:scale-[1.01]"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary/70 group-hover:text-primary" />
                    <span className="font-semibold text-sm truncate">{t.name}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    {t.site_name && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{t.site_name}</div>}
                    {t.org_name && <div className="flex items-center gap-1"><Building2 className="w-3 h-3" />{t.org_name}</div>}
                  </div>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 group-hover:text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          STEP 2 — Select points + Step 3 — Period + Purge
          ═══════════════════════════════════════════════════════ */}
      {selectedTerrainId && (
        <div className="space-y-5 animate-fade-in">
          {/* Back button */}
          <Button variant="ghost" size="sm" onClick={goBackToTerrains} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Changer de terrain
          </Button>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Points list (3 cols) ─────────────────────── */}
            <div className="lg:col-span-3">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <StepNumber n={2} active={step === 2} done={step > 2} />
                    <div className="flex-1">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Activity className="w-4 h-4" /> Points de mesure — {terrain?.name}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        {selectedPointIds.size > 0
                          ? <span className="text-primary font-medium">{selectedPointIds.size}/{points.length} sélectionné{selectedPointIds.size > 1 ? 's' : ''}</span>
                          : `${points.length} point${points.length !== 1 ? 's' : ''} disponible${points.length !== 1 ? 's' : ''}`}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Search + select all */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Rechercher un point…"
                        value={pointSearch}
                        onChange={e => setPointSearch(e.target.value)}
                        className="h-8 pl-8 text-sm"
                      />
                    </div>
                    <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={toggleAllVisible}>
                      {visiblePoints.length > 0 && visiblePoints.every(p => selectedPointIds.has(p.id)) ? 'Tout désélectionner' : 'Tout sélectionner'}
                    </Button>
                  </div>

                  {loadingPoints ? (
                    <div className="py-10 text-center">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                      <div className="mt-2 text-xs text-muted-foreground">Chargement des points…</div>
                    </div>
                  ) : points.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Aucun point de mesure sur ce terrain
                    </div>
                  ) : (
                    <ScrollArea className="h-[420px]">
                      <div className="space-y-1.5 pr-3">
                        {visiblePoints.map(p => {
                          const checked = selectedPointIds.has(p.id);
                          return (
                            <div
                              key={p.id}
                              onClick={() => togglePoint(p.id)}
                              className={cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all',
                                'hover:border-primary/50 hover:bg-primary/5',
                                checked && 'border-primary bg-primary/10 shadow-sm',
                              )}
                            >
                              <Checkbox checked={checked} onCheckedChange={() => togglePoint(p.id)} />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium truncate block">{p.name}</span>
                                {(p.measure_category || p.modbus_addr) && (
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {p.measure_category && <Badge variant="outline" className="text-[9px] py-0">{p.measure_category}</Badge>}
                                    {p.modbus_addr && <span className="text-[10px] text-muted-foreground">Modbus {p.modbus_addr}</span>}
                                  </div>
                                )}
                              </div>
                              {p.status === 'active' && (
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Active" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Right panel: period + action (2 cols) ───── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Period card */}
              <Card className={cn(step >= 3 ? 'border-primary/30' : 'opacity-60 pointer-events-none')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <StepNumber n={3} active={step === 3} done={false} />
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Calendar className="w-4 h-4" /> Période
                      </CardTitle>
                      <CardDescription className="mt-0.5">Tout supprimer ou choisir un intervalle</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Toggle: all time vs range */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setUseRange(false); setDateFrom(''); setDateTo(''); }}
                      className={cn(
                        'py-2.5 px-3 rounded-lg border text-sm font-medium transition-all text-center',
                        !useRange ? 'border-primary bg-primary/10 text-primary shadow-sm' : 'hover:border-primary/40 text-muted-foreground',
                      )}
                    >
                      Tout supprimer
                    </button>
                    <button
                      onClick={() => setUseRange(true)}
                      className={cn(
                        'py-2.5 px-3 rounded-lg border text-sm font-medium transition-all text-center',
                        useRange ? 'border-primary bg-primary/10 text-primary shadow-sm' : 'hover:border-primary/40 text-muted-foreground',
                      )}
                    >
                      Choisir un intervalle
                    </button>
                  </div>

                  {useRange && (
                    <div className="space-y-3 animate-fade-in">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Début (vide = depuis toujours)</label>
                        <Input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Fin (vide = jusqu'à maintenant)</label>
                        <Input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Summary + purge button */}
              {selectedPointIds.size > 0 && (
                <Card className="border-red-200/60 bg-gradient-to-br from-red-50/30 to-orange-50/20 animate-fade-in">
                  <CardContent className="pt-5 space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Points sélectionnés</span>
                        <Badge variant="secondary" className="font-bold">{selectedPointIds.size}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Terrain</span>
                        <span className="font-medium text-xs">{terrain?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Période</span>
                        <span className="font-medium text-xs">{useRange && (dateFrom || dateTo) ? rangeLabel : 'Tout'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tables</span>
                        <div className="flex gap-1">
                          <Badge variant="outline" className="text-[9px]">readings</Badge>
                          <Badge variant="outline" className="text-[9px]">agg_15m</Badge>
                          <Badge variant="outline" className="text-[9px]">agg_daily</Badge>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      className="w-full h-10"
                      onClick={() => {
                        setResult(null);
                        setPurgeActionError(null);
                        setPurgeConfirmText('');
                        setPreviewTotals(null);
                        setPreviewPointsFound(null);
                        setPreviewPointsMissing(null);
                        setPreviewError(null);
                        setPreviewRequested(true);
                        setConfirmOpen(true);
                        loadPurgePreview();
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Purger {selectedPointIds.size} point{selectedPointIds.size > 1 ? 's' : ''}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          RESULT SUMMARY
          ═══════════════════════════════════════════════════════ */}
      {result && (
        <Card className="border-emerald-200 bg-emerald-50/50 animate-fade-in">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold text-emerald-800">
                  Purge effectuée — {result.points_purged} point{result.points_purged > 1 ? 's' : ''}
                </div>
                <div className="text-xs text-emerald-700/70 mt-0.5">
                  {result.range.from ? new Date(result.range.from).toLocaleString('fr-FR') : '∞'}
                  {' → '}
                  {result.range.to ? new Date(result.range.to).toLocaleString('fr-FR') : '∞'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white border text-center">
                <div className="text-xs text-muted-foreground">Readings</div>
                <div className="text-xl font-bold text-emerald-700">{result.totals.readings.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-lg bg-white border text-center">
                <div className="text-xs text-muted-foreground">Agg 15min</div>
                <div className="text-xl font-bold text-emerald-700">{result.totals.agg_15m.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-lg bg-white border text-center">
                <div className="text-xs text-muted-foreground">Agg Daily</div>
                <div className="text-xl font-bold text-emerald-700">{result.totals.agg_daily.toLocaleString()}</div>
              </div>
            </div>

            {(result.details?.length ?? 0) > 1 && (
              <div className="pt-3 border-t">
                <div className="text-xs font-semibold text-muted-foreground mb-2">Détail par point</div>
                <div className="space-y-1 text-xs max-h-40 overflow-y-auto">
                  {result.details!.map(d => (
                    <div key={d.point_id} className="flex justify-between text-muted-foreground">
                      <span className="truncate max-w-[60%]">{d.point_name}</span>
                      <span className="tabular-nums">
                        {d.deleted.readings.toLocaleString()} readings / {d.deleted.agg_15m} 15m / {d.deleted.agg_daily} daily
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-red-200/60 bg-gradient-to-br from-red-50/30 to-orange-50/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" /> Purge globale par plage de dates
          </CardTitle>
          <CardDescription>
            Supprime les données de toutes les entités sur la période choisie. Utilisez uniquement pour incidents majeurs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Du</label>
              <Input type="date" value={globalFrom} onChange={(e) => setGlobalFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Au</label>
              <Input type="date" value={globalTo} onChange={(e) => setGlobalTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Options</label>
              <div className="h-10 border rounded-md px-3 flex items-center gap-2 bg-background">
                <Checkbox
                  checked={globalIncludeReadings}
                  onCheckedChange={(v) => setGlobalIncludeReadings(Boolean(v))}
                  id="global-include-readings"
                />
                <label htmlFor="global-include-readings" className="text-xs">Inclure les readings bruts</label>
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-2.5 text-sm bg-background">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Période</span>
              <span className="font-medium text-xs">{globalRangeLabel}</span>
            </div>
            {!globalPreviewRequested ? (
              <div className="text-xs text-muted-foreground">Cliquez sur "Calculer l'impact" pour estimer la purge.</div>
            ) : globalPreviewLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calcul de l'impact global…
              </div>
            ) : globalPreviewError ? (
              <div className="text-xs text-red-600">{globalPreviewError}</div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Readings</span>
                  <span className="font-bold tabular-nums">{(globalPreviewTotals?.readings ?? 0).toLocaleString('fr-FR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agg 15m</span>
                  <span className="font-bold tabular-nums">{(globalPreviewTotals?.agg_15m ?? 0).toLocaleString('fr-FR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agg Daily</span>
                  <span className="font-bold tabular-nums">{(globalPreviewTotals?.agg_daily ?? 0).toLocaleString('fr-FR')}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={!canRequestGlobalPreview || globalPreviewLoading}
              onClick={() => {
                setGlobalPreviewRequested(true);
                loadGlobalPreview();
              }}
            >
              {globalPreviewLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Activity className="w-4 h-4 mr-2" />}
              Calculer l'impact
            </Button>
            <Button
              variant="destructive"
              disabled={!canRequestGlobalPreview || globalPreviewLoading}
              onClick={() => {
                setGlobalConfirmText('');
                setGlobalActionError(null);
                setGlobalPreviewRequested(true);
                setGlobalConfirmOpen(true);
                loadGlobalPreview();
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Lancer la purge globale
            </Button>
          </div>
          {globalPreviewError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Prévisualisation indisponible:</strong> vous pouvez continuer en mode forcé avec mot-clé renforcé.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {globalResult && (
        <Card className="border-emerald-200 bg-emerald-50/50 animate-fade-in">
          <CardContent className="pt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-4 text-sm font-semibold text-emerald-800">
              Purge globale effectuée: {new Date(globalResult.range.from).toLocaleDateString('fr-FR')} → {new Date(globalResult.range.to).toLocaleDateString('fr-FR')}
            </div>
            <div className="p-3 rounded-lg bg-white border text-center">
              <div className="text-xs text-muted-foreground">Readings</div>
              <div className="text-xl font-bold text-emerald-700">{globalResult.deleted.readings.toLocaleString('fr-FR')}</div>
            </div>
            <div className="p-3 rounded-lg bg-white border text-center">
              <div className="text-xs text-muted-foreground">Agg 15min</div>
              <div className="text-xl font-bold text-emerald-700">{globalResult.deleted.agg_15m.toLocaleString('fr-FR')}</div>
            </div>
            <div className="p-3 rounded-lg bg-white border text-center">
              <div className="text-xs text-muted-foreground">Agg Daily</div>
              <div className="text-xl font-bold text-emerald-700">{globalResult.deleted.agg_daily.toLocaleString('fr-FR')}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
          CONFIRM DIALOG
          ═══════════════════════════════════════════════════════ */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Les données seront sauvegardées dans la corbeille (30 jours) avant suppression.
              Vous pourrez les restaurer depuis l'historique ci-dessous.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-xl border p-4 space-y-2.5 text-sm bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Points</span>
                <span className="font-bold">{selectedPointIds.size}</span>
              </div>
              {previewPointsFound !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Points valides</span>
                  <span className="font-medium">{previewPointsFound}</span>
                </div>
              )}
              {(previewPointsMissing ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Points introuvables</span>
                  <span className="font-medium text-orange-700">{previewPointsMissing}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Terrain</span>
                <span className="font-medium">{terrain?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Période</span>
                <span className="font-medium text-xs">{rangeLabel}</span>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-2.5 text-sm bg-background">
              <div className="text-xs font-semibold text-muted-foreground">Impact estimé (dry-run)</div>
              {!previewRequested ? (
                <div className="text-xs text-muted-foreground">Cliquez sur "Calculer l'impact" pour générer l'estimation.</div>
              ) : previewLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calcul en cours…
                </div>
              ) : previewError ? (
                <div className="text-xs text-red-600">{previewError}</div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Readings</span>
                    <span className="font-bold tabular-nums">{(previewTotals?.readings ?? 0).toLocaleString('fr-FR')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agg 15m</span>
                    <span className="font-bold tabular-nums">{(previewTotals?.agg_15m ?? 0).toLocaleString('fr-FR')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agg Daily</span>
                    <span className="font-bold tabular-nums">{(previewTotals?.agg_daily ?? 0).toLocaleString('fr-FR')}</span>
                  </div>
                </>
              )}
            </div>

            {/* Selected points list preview */}
            <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1 border rounded-lg p-2">
              {Array.from(selectedPointIds).map(id => {
                const p = points.find(pp => pp.id === id);
                return <div key={id} className="truncate">{p?.name ?? id}</div>;
              })}
            </div>

            {!useRange && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span><strong>Attention:</strong> TOUTES les mesures historiques seront supprimées définitivement.</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tapez <strong>{requiredPurgeKeyword}</strong> pour confirmer
              </label>
              <Input
                value={purgeConfirmText}
                onChange={(e) => setPurgeConfirmText(e.target.value)}
                placeholder={requiredPurgeKeyword}
              />
              <p className="text-[11px] text-muted-foreground">
                Format attendu: <strong>{requiredPurgeKeyword}</strong>
              </p>
              {purgeActionError && <p className="text-xs text-red-600">{purgeActionError}</p>}
            </div>

            <div>
              <Button variant="outline" size="sm" onClick={loadPurgePreview} disabled={previewLoading}>
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Activity className="w-3.5 h-3.5 mr-2" />}
                Calculer l'impact
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purging || previewLoading}>Annuler</Button>
            <Button variant="destructive" onClick={handlePurge} disabled={purging || previewLoading || !canConfirmPurge}>
              {purging ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════
          PURGE HISTORY — Trash / Restore
          ═══════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm">Historique des purges</CardTitle>
              <CardDescription className="mt-0 ml-2">
                Les données sont conservées 30 jours dans la corbeille
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={loadBatches} disabled={loadingBatches} className="h-7 gap-1.5 text-xs">
              <RotateCcw className={cn("w-3 h-3", loadingBatches && "animate-spin")} /> Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingBatches && batches.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Chargement…
            </div>
          ) : batches.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Aucune purge enregistrée
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {batches.map(b => {
                const counts = b.counts || { readings: 0, agg_15m: 0, agg_daily: 0 };
                const isRestored = !!b.restored_at;
                const isRestoring = restoringBatchId === b.id;
                const isDeleting = deletingBatchId === b.id;
                const total = (counts.readings || 0) + (counts.agg_15m || 0) + (counts.agg_daily || 0);
                return (
                  <div key={b.id} className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    isRestored ? "bg-emerald-50/50 border-emerald-200/50" : "hover:border-primary/30",
                  )}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">
                          {new Date(b.deleted_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isRestored && <Badge variant="outline" className="text-[9px] text-emerald-700 border-emerald-300">Restauré</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{b.point_ids?.length || 0} point{(b.point_ids?.length || 0) > 1 ? 's' : ''}</span>
                        <span className="tabular-nums">{counts.readings?.toLocaleString()} readings</span>
                        <span className="tabular-nums">{counts.agg_15m?.toLocaleString()} agg15m</span>
                        <span className="tabular-nums">{counts.agg_daily?.toLocaleString()} daily</span>
                        {b.date_from && (
                          <span>
                            {new Date(b.date_from).toLocaleDateString('fr-FR')}
                            {' → '}
                            {b.date_to ? new Date(b.date_to).toLocaleDateString('fr-FR') : '∞'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {!isRestored && total > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          disabled={isRestoring}
                          onClick={() => openHistoryAction({ type: 'restore', batch: b })}
                        >
                          {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Restaurer
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={isDeleting}
                        onClick={() => openHistoryAction({ type: 'delete', batch: b })}
                      >
                        {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!historyAction} onOpenChange={(open) => { if (!open) closeHistoryAction(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              {historyAction?.type === 'restore' ? 'Confirmer la restauration du lot' : 'Confirmer la suppression définitive'}
            </DialogTitle>
            <DialogDescription>
              {historyAction?.type === 'restore'
                ? 'La restauration réinjecte les données sauvegardées dans les tables de production (les doublons sont ignorés).'
                : 'La suppression retire définitivement la sauvegarde de corbeille. Cette action est irréversible.'}
            </DialogDescription>
          </DialogHeader>

          {historyAction?.batch && (
            <div className="rounded-xl border p-4 space-y-2.5 text-sm bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lot</span>
                <span className="font-mono text-xs">{historyAction.batch.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Readings</span>
                <span className="font-medium">{(historyAction.batch.counts?.readings || 0).toLocaleString('fr-FR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agg 15m</span>
                <span className="font-medium">{(historyAction.batch.counts?.agg_15m || 0).toLocaleString('fr-FR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agg daily</span>
                <span className="font-medium">{(historyAction.batch.counts?.agg_daily || 0).toLocaleString('fr-FR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Points concernés</span>
                <span className="font-medium">{(historyAction.batch.point_ids?.length || 0).toLocaleString('fr-FR')}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tapez <strong>{requiredHistoryKeyword}</strong> pour confirmer
            </label>
            <Input
              value={historyConfirmText}
              onChange={(e) => setHistoryConfirmText(e.target.value)}
              placeholder={requiredHistoryKeyword}
            />
            <p className="text-[11px] text-muted-foreground">
              Format attendu: <strong>{requiredHistoryKeyword}</strong>
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={closeHistoryAction}>Annuler</Button>
            <Button
              variant={historyAction?.type === 'restore' ? 'default' : 'destructive'}
              disabled={!canConfirmHistoryAction || !!restoringBatchId || !!deletingBatchId}
              onClick={executeHistoryAction}
            >
              {(!!restoringBatchId || !!deletingBatchId) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={globalConfirmOpen} onOpenChange={setGlobalConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Confirmer la purge globale
            </DialogTitle>
            <DialogDescription>
              Cette action touche toutes les entités sur la plage choisie et peut supprimer un volume massif de données.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-xl border p-4 space-y-2.5 text-sm bg-muted/30">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Période</span>
                <span className="font-medium text-xs">{globalRangeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prévisualisation</span>
                <span className={cn('font-medium text-xs', globalPreviewError ? 'text-amber-700' : 'text-emerald-700')}>
                  {globalPreviewError ? 'Indisponible (mode forcé)' : 'Disponible'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Readings</span>
                <span className="font-bold tabular-nums">{(globalPreviewTotals?.readings ?? 0).toLocaleString('fr-FR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agg 15m</span>
                <span className="font-bold tabular-nums">{(globalPreviewTotals?.agg_15m ?? 0).toLocaleString('fr-FR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agg Daily</span>
                <span className="font-bold tabular-nums">{(globalPreviewTotals?.agg_daily ?? 0).toLocaleString('fr-FR')}</span>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>Attention:</strong> opération globale et irréversible hors mécanisme de corbeille.</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tapez <strong>{requiredGlobalKeyword}</strong> pour confirmer
              </label>
              <Input
                value={globalConfirmText}
                onChange={(e) => setGlobalConfirmText(e.target.value)}
                placeholder={requiredGlobalKeyword}
              />
              <p className="text-[11px] text-muted-foreground">
                Format attendu: <strong>{requiredGlobalKeyword}</strong>
              </p>
              {globalPreviewError && (
                <p className="text-xs text-amber-700">
                  Mode forcé activé car la prévisualisation a échoué. Vérifiez soigneusement la période avant confirmation.
                </p>
              )}
              {globalActionError && <p className="text-xs text-red-600">{globalActionError}</p>}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setGlobalConfirmOpen(false)} disabled={globalPurging}>Annuler</Button>
            <Button variant="destructive" onClick={handleGlobalPurge} disabled={globalPurging || !canConfirmGlobalPurge || globalPreviewLoading || !canRequestGlobalPreview}>
              {globalPurging ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Confirmer la purge globale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
