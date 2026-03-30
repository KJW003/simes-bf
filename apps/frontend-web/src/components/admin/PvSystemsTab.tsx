import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { usePvSystems, useCreatePvSystem, useUpdatePvSystem, useDeletePvSystem, useAssignPointToPvSystem, usePoints, useAllTerrains } from '@/hooks/useApi';

const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function terrainLabelFn(t: any) {
  return t.gateway_id ? `${t.name} (${t.gateway_id})` : t.name;
}

export function PvSystemsTab() {
  const { data: allTerrains = [] } = useAllTerrains();
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const { data: systems = [], isLoading: systemsLoading } = usePvSystems(selectedTerrainId);
  const { data: points = [] } = usePoints(selectedTerrainId);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assigningPointId, setAssigningPointId] = useState<string | null>(null);

  const createMutation = useCreatePvSystem();
  const updateMutation = useUpdatePvSystem();
  const deleteMutation = useDeletePvSystem();
  const assignMutation = useAssignPointToPvSystem();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    installed_capacity_kwc: '',
    installation_date: '',
    expected_tilt_degrees: '',
    expected_orientation: '',
  });

  const handleCreate = async () => {
    if (!formData.name.trim() || !selectedTerrainId) {
      toast.error('Nom du système requis');
      return;
    }

    try {
      await createMutation.mutateAsync({
        terrain_id: selectedTerrainId,
        name: formData.name,
        description: formData.description || undefined,
        location: formData.location || undefined,
        installed_capacity_kwc: formData.installed_capacity_kwc ? parseFloat(formData.installed_capacity_kwc) : undefined,
        installation_date: formData.installation_date || undefined,
        expected_tilt_degrees: formData.expected_tilt_degrees ? parseInt(formData.expected_tilt_degrees) : undefined,
        expected_orientation: formData.expected_orientation as any,
      });
      setFormData({
        name: '', description: '', location: '', installed_capacity_kwc: '',
        installation_date: '', expected_tilt_degrees: '', expected_orientation: '',
      });
      setShowCreate(false);
      toast.success('Système PV créé');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await updateMutation.mutateAsync({
        id,
        payload: {
          name: formData.name,
          description: formData.description || undefined,
          location: formData.location || undefined,
          installed_capacity_kwc: formData.installed_capacity_kwc ? parseFloat(formData.installed_capacity_kwc) : undefined,
          installation_date: formData.installation_date || undefined,
          expected_tilt_degrees: formData.expected_tilt_degrees ? parseInt(formData.expected_tilt_degrees) : undefined,
          expected_orientation: formData.expected_orientation as any,
        },
      });
      setEditingId(null);
      toast.success('Système PV mis à jour');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Système PV supprimé');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const handleAssignPoint = async (pointId: string, pvSystemId: string | null) => {
    try {
      await assignMutation.mutateAsync({ pointId, pvSystemId });
      setAssigningPointId(null);
      toast.success('Point assigné');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    }
  };

  const pvPoints = useMemo(() => points.filter(p => p.measure_category === 'PV'), [points]);

  return (
    <div className="space-y-4">
      {/* Terrain Selector */}
      <div className="flex gap-3 items-end">
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label className="text-sm font-medium">Terrain</Label>
          <Select value={selectedTerrainId ?? "none"} onValueChange={(v) => setSelectedTerrainId(v === "none" ? null : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Choisir un terrain…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sélectionnez un terrain —</SelectItem>
              {(allTerrains as any[]).map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{terrainLabelFn(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedTerrainId && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" /> Nouveau système
          </Button>
        )}
      </div>

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain pour gérer ses systèmes PV.
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && (
        <>
      {/* Systems List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Systèmes PV</CardTitle>
        </CardHeader>
        <CardContent>
          {systemsLoading ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : systems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun système PV créé.</p>
          ) : (
            <div className="space-y-3">
              {systems.map(sys => (
                <div key={sys.id} className="flex items-start justify-between p-3 border rounded">
                  <div className="flex-1">
                    <p className="font-medium">{sys.name}</p>
                    {sys.description && <p className="text-xs text-muted-foreground">{sys.description}</p>}
                    <div className="flex gap-2 mt-2">
                      {sys.installed_capacity_kwc && <Badge variant="outline">{sys.installed_capacity_kwc} kWc</Badge>}
                      {sys.point_count ? <Badge variant="secondary">{sys.active_point_count}/{sys.point_count} actifs</Badge> : <Badge variant="secondary">0 point</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => {
                      setFormData({
                        name: sys.name, description: sys.description || '', location: sys.location || '',
                        installed_capacity_kwc: sys.installed_capacity_kwc?.toString() || '',
                        installation_date: sys.installation_date || '', expected_tilt_degrees: sys.expected_tilt_degrees?.toString() || '',
                        expected_orientation: sys.expected_orientation || '',
                      });
                      setEditingId(sys.id);
                    }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <ConfirmActionDialog
                      title="Supprimer le système PV"
                      description="Cette action ne peut pas être annulée."
                      onConfirm={() => handleDelete(sys.id)}
                      trigger={<Button variant="ghost" size="sm"><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign points */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigner les points PV</CardTitle>
        </CardHeader>
        <CardContent>
          {pvPoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun point PV détecté sur ce terrain.</p>
          ) : (
            <div className="space-y-3">
              {pvPoints.map(pt => {
                const currentSystem = systems.find(s => s.id === pt.pv_system_id);
                return (
                  <div key={pt.id} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <p className="font-medium">{pt.name}</p>
                      <p className="text-xs text-muted-foreground">{pt.device}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentSystem && <Badge>{currentSystem.name}</Badge>}
                      <Select defaultValue={pt.pv_system_id || 'unassigned'} onValueChange={(v) => handleAssignPoint(pt.id, v === 'unassigned' ? null : v)}>
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Non assigné</SelectItem>
                          {systems.map(sys => (
                            <SelectItem key={sys.id} value={sys.id}>{sys.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showCreate || !!editingId} onOpenChange={(open) => {
        if (!open) { setShowCreate(false); setEditingId(null); setFormData({ name: '', description: '', location: '', installed_capacity_kwc: '', installation_date: '', expected_tilt_degrees: '', expected_orientation: '' }); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Éditer le système PV' : 'Nouveau système PV'}</DialogTitle>
            <DialogDescription>{editingId ? 'Modifier les propriétés du système' : 'Créer un nouveau système PV'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Nom *</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="loc">Localisation</Label>
              <Input id="loc" placeholder="Toit sud, parking, etc" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cap">Capacité (kWc)</Label>
                <Input id="cap" type="number" step="0.1" value={formData.installed_capacity_kwc} onChange={(e) => setFormData({ ...formData, installed_capacity_kwc: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="tilt">Inclinaison (°)</Label>
                <Input id="tilt" type="number" min="0" max="90" value={formData.expected_tilt_degrees} onChange={(e) => setFormData({ ...formData, expected_tilt_degrees: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="orient">Orientation</Label>
                <Select value={formData.expected_orientation || "none"} onValueChange={(v) => setFormData({ ...formData, expected_orientation: v === "none" ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune</SelectItem>
                    {ORIENTATIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="date">Date install.</Label>
                <Input id="date" type="date" value={formData.installation_date} onChange={(e) => setFormData({ ...formData, installation_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={() => editingId ? handleUpdate(editingId) : handleCreate()} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingId ? 'Mettre à jour' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
