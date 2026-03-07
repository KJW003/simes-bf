import React, { useState, useMemo } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useOrgs, useAllSites, useAllTerrains } from '@/hooks/useApi';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Trash2, AlertTriangle, Loader2, CheckCircle2, Database, Filter,
  Building2, MapPin, Layers, Activity,
} from 'lucide-react';

const fmt = (v: unknown) => v != null && v !== '' ? Number(v).toFixed(2) : '—';

export default function PurgeReadings() {
  // ─── Cascading selectors state
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedTerrainId, setSelectedTerrainId] = useState('');
  const [selectedPointId, setSelectedPointId] = useState('');

  // ─── Date range
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ─── Purge state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<{
    point: string;
    deleted: { readings: number; agg_15m: number; agg_daily: number };
    range: { from: string | null; to: string | null };
  } | null>(null);

  // ─── Points state (loaded when terrain selected)
  const [points, setPoints] = useState<Array<Record<string, unknown>>>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);

  // ─── Data fetching
  const { data: orgsData } = useOrgs();
  const { data: sitesData } = useAllSites();
  const { data: terrainsData } = useAllTerrains();

  const orgs = (orgsData?.orgs ?? []) as Array<Record<string, unknown>>;
  const allSites = (sitesData?.sites ?? []) as Array<Record<string, unknown>>;
  const allTerrains = (terrainsData?.terrains ?? []) as Array<Record<string, unknown>>;

  // Filter cascading
  const filteredSites = useMemo(() =>
    selectedOrgId ? allSites.filter(s => String(s.organization_id) === selectedOrgId) : allSites,
    [allSites, selectedOrgId],
  );

  const filteredTerrains = useMemo(() =>
    selectedSiteId ? allTerrains.filter(t => String(t.site_id) === selectedSiteId) : 
    selectedOrgId ? allTerrains.filter(t => String(t.org_id) === selectedOrgId) : allTerrains,
    [allTerrains, selectedOrgId, selectedSiteId],
  );

  // Load points when terrain changes
  const loadPoints = async (terrainId: string) => {
    setSelectedTerrainId(terrainId);
    setSelectedPointId('');
    setPoints([]);
    if (!terrainId) return;
    setLoadingPoints(true);
    try {
      const res = await api.getPoints(terrainId);
      setPoints((res?.points ?? []) as Array<Record<string, unknown>>);
    } catch {
      setPoints([]);
    } finally {
      setLoadingPoints(false);
    }
  };

  const selectedPoint = points.find(p => String(p.id) === selectedPointId);
  const canPurge = !!selectedPointId;

  // ─── Purge handler
  const handlePurge = async () => {
    if (!selectedPointId) return;
    setPurging(true);
    setResult(null);
    try {
      const res = await api.purgeReadings(
        selectedPointId,
        dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo ? new Date(dateTo).toISOString() : undefined,
      );
      setResult(res);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purge des mesures"
        description="Supprimer les mesures d'un point sans supprimer le point lui-même"
      />

      {/* Step 1 — Cascading Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" /> Sélection du point de mesure
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Org */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Organisation
              </label>
              <Select value={selectedOrgId} onValueChange={v => { setSelectedOrgId(v); setSelectedSiteId(''); setSelectedTerrainId(''); setSelectedPointId(''); setPoints([]); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choisir une organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Toutes</SelectItem>
                  {orgs.map(o => <SelectItem key={String(o.id)} value={String(o.id)}>{String(o.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Site */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Site
              </label>
              <Select value={selectedSiteId} onValueChange={v => { setSelectedSiteId(v); setSelectedTerrainId(''); setSelectedPointId(''); setPoints([]); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choisir un site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Tous</SelectItem>
                  {filteredSites.map(s => (
                    <SelectItem key={String(s.id)} value={String(s.id)}>
                      {String(s.name)} {s.org_name ? `(${s.org_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Terrain */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Layers className="w-3 h-3" /> Terrain
              </label>
              <Select value={selectedTerrainId} onValueChange={v => loadPoints(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choisir un terrain" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTerrains.map(t => (
                    <SelectItem key={String(t.id)} value={String(t.id)}>
                      {String(t.name)} {t.site_name ? `— ${t.site_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Point */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" /> Point de mesure
              </label>
              <Select value={selectedPointId} onValueChange={setSelectedPointId} disabled={!selectedTerrainId || loadingPoints}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={loadingPoints ? 'Chargement…' : 'Choisir un point'} />
                </SelectTrigger>
                <SelectContent>
                  {points.map(p => (
                    <SelectItem key={String(p.id)} value={String(p.id)}>
                      {String(p.name)} {p.measure_category ? `(${p.measure_category})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — Date Range */}
      {selectedPointId && (
        <Card className="animate-fade-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" /> Plage de suppression
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Date début (vide = depuis toujours)</label>
                <Input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Date fin (vide = jusqu'à maintenant)</label>
                <Input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              <div>
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={!canPurge || purging}
                  onClick={() => { setResult(null); setConfirmOpen(true); }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Purger les mesures
                </Button>
              </div>
            </div>

            {/* Selected point summary */}
            {selectedPoint && (
              <div className="mt-4 p-3 rounded-lg border bg-muted/30 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-primary" />
                  <span className="font-semibold">{String(selectedPoint.name)}</span>
                  <Badge variant="outline" className="text-[10px]">{String(selectedPoint.measure_category ?? '—')}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  ID: {String(selectedPoint.id).slice(0, 12)}…
                  {selectedPoint.device_key && <span className="ml-3">Device: {String(selectedPoint.device_key)}</span>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result banner */}
      {result && (
        <Card className="border-emerald-200 bg-emerald-50/50 animate-fade-in">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-emerald-800">Suppression effectuée — {result.point}</div>
                <div className="grid grid-cols-3 gap-4 text-sm mt-2">
                  <div className="p-2 rounded bg-white border">
                    <div className="text-xs text-muted-foreground">Readings</div>
                    <div className="text-lg font-bold text-emerald-700">{result.deleted.readings.toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-white border">
                    <div className="text-xs text-muted-foreground">Agg 15min</div>
                    <div className="text-lg font-bold text-emerald-700">{result.deleted.agg_15m.toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-white border">
                    <div className="text-xs text-muted-foreground">Agg Daily</div>
                    <div className="text-lg font-bold text-emerald-700">{result.deleted.agg_daily.toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Plage: {result.range.from ? new Date(result.range.from).toLocaleString('fr-FR') : '∞'} → {result.range.to ? new Date(result.range.to).toLocaleString('fr-FR') : '∞'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Les données supprimées ne pourront pas être récupérées.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Point</span>
                <span className="font-medium">{selectedPoint ? String(selectedPoint.name) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plage</span>
                <span className="font-medium">{rangeLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tables ciblées</span>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-[10px]">acrel_readings</Badge>
                  <Badge variant="outline" className="text-[10px]">acrel_agg_15m</Badge>
                  <Badge variant="outline" className="text-[10px]">acrel_agg_daily</Badge>
                </div>
              </div>
            </div>

            {!dateFrom && !dateTo && (
              <div className="flex items-center gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>Aucune plage de dates définie — <strong>TOUTES</strong> les mesures seront supprimées.</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purging}>Annuler</Button>
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
