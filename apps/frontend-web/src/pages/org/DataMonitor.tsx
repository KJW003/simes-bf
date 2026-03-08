import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Map as MapIcon, Zap, Activity, Gauge, ChevronRight, Loader2, Radio, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTerrainOverview, useZones, useCreateZone, useUpdateZone, useDeleteZone } from '@/hooks/useApi';
import api from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

const fmt = (v: any, decimals = 2) => v != null && v !== '' ? Number(v).toFixed(decimals) : '—';

export default function DataMonitor() {
  const { selectedTerrain } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;

  const { data: overviewData, isLoading: loadOv } = useTerrainOverview(terrainId);
  const { data: zonesData, isLoading: loadZ } = useZones(terrainId);

  const queryClient = useQueryClient();
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();

  // Zone CRUD dialog state
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Record<string, any> | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Assign-to-zone state
  const [assigningPointId, setAssigningPointId] = useState<string | null>(null);
  const [assignTargetZone, setAssignTargetZone] = useState<string>('');

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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditingZone(null); setZoneName(''); setZoneDesc(''); setZoneDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" />Créer une zone
            </Button>
            <Link to="/points"><Button variant="outline" size="sm"><Activity className="w-4 h-4 mr-1" />Tous les points</Button></Link>
          </div>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Points de mesure" value={points.length} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Zones" value={zones.length} icon={<MapIcon className="w-4 h-4" />} />
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
              <MapIcon className="w-4 h-4 text-primary" />
              {String(zone.name)}
              <Badge variant="outline" className="text-[10px] ml-1">{zonePoints.length} points</Badge>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                setEditingZone(zone);
                setZoneName(String(zone.name));
                setZoneDesc(String(zone.description ?? ''));
                setZoneDialogOpen(true);
              }}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirmId(String(zone.id))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Link to={`/terrain/${terrainId}/zones/${zone.id}`}>
                <Button variant="ghost" size="sm">Voir zone <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </Link>
            </div>
          </CardHeader>
          {zone.description && (
            <CardContent className="pt-0 pb-3">
              <p className="text-xs text-muted-foreground">{String(zone.description)}</p>
            </CardContent>
          )}
        </Card>
      ))}

      {/* Unassigned points — simplified list with assign action */}
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
            <div className="space-y-1">
              {zoneMap.unassigned.map(p => (
                <div key={String(p.id)} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 transition-colors text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{String(p.name)}</span>
                    <Badge variant="outline" className="text-[9px]">{String(p.measure_category ?? '—')}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {zones.length > 0 && (
                      assigningPointId === String(p.id) ? (
                        <div className="flex items-center gap-1">
                          <Select value={assignTargetZone} onValueChange={setAssignTargetZone}>
                            <SelectTrigger className="h-7 text-xs w-[140px]">
                              <SelectValue placeholder="Zone…" />
                            </SelectTrigger>
                            <SelectContent>
                              {zones.map(z => (
                                <SelectItem key={String(z.id)} value={String(z.id)}>{String(z.name)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" className="h-7 text-xs" disabled={!assignTargetZone} onClick={async () => {
                            await api.assignZone(String(p.id), assignTargetZone);
                            setAssigningPointId(null);
                            setAssignTargetZone('');
                            queryClient.invalidateQueries({ queryKey: ['terrain-overview'] });
                            queryClient.invalidateQueries({ queryKey: ['zones'] });
                          }}>OK</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAssigningPointId(null); setAssignTargetZone(''); }}>✕</Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAssigningPointId(String(p.id))}>
                          Assigner
                        </Button>
                      )
                    )}
                    <Link to={`/points/${p.id}`}><Button variant="ghost" size="sm" className="h-6 text-xs">Détail</Button></Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state when no zones */}
      {zones.length === 0 && points.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
            <MapIcon className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucune zone ni point configuré pour ce terrain.</p>
            <Button variant="outline" size="sm" onClick={() => { setEditingZone(null); setZoneName(''); setZoneDesc(''); setZoneDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" />Créer une zone
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit zone dialog */}
      <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingZone ? 'Modifier la zone' : 'Créer une zone'}</DialogTitle>
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

      {/* Delete zone confirmation dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer la zone ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Les points de mesure assignés à cette zone seront désassignés mais pas supprimés.</p>
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