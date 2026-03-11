// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Zones (per terrain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, MapPin } from "lucide-react";
import {
  useAllTerrains, useZones,
  useCreateZone, useUpdateZone, useDeleteZone,
} from "@/hooks/useApi";
import { terrainLabelFn } from "./admin-shared";

export default function ZonesTab() {
  const { data: allTerrains = [] } = useAllTerrains();
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const { data: zones = [], isLoading } = useZones(selectedTerrainId);
  const createZoneMut = useCreateZone();
  const updateZoneMut = useUpdateZone();
  const deleteZoneMut = useDeleteZone();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const handleCreate = async () => {
    if (!selectedTerrainId || !newName.trim()) return;
    try {
      await createZoneMut.mutateAsync({
        terrainId: selectedTerrainId,
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      toast.success("Zone créée");
      setShowCreate(false);
      setNewName(""); setNewDescription("");
    } catch { toast.error("Erreur création de la zone"); }
  };

  const handleUpdate = async (zoneId: string) => {
    try {
      await updateZoneMut.mutateAsync({
        zoneId,
        name: editName,
        description: editDescription || undefined,
      });
      toast.success("Zone mise à jour");
      setEditingId(null);
    } catch { toast.error("Erreur mise à jour"); }
  };

  const handleDelete = (zoneId: string, name: string) => {
    if (!confirm(`Supprimer la zone « ${name} » ?\nLes points de mesure associés seront détachés de cette zone.`)) return;
    deleteZoneMut.mutate(zoneId, {
      onSuccess: () => toast.success("Zone supprimée"),
      onError: () => toast.error("Erreur suppression"),
    });
  };

  return (
    <div className="space-y-4">
      {/* Terrain selector */}
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
            <Plus className="w-4 h-4 mr-1" /> Ajouter une zone
          </Button>
        )}
      </div>

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <MapPin className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Sélectionnez un terrain pour gérer ses zones.</p>
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Zones
              <Badge variant="outline" className="text-[10px]">{zones.length} zone{zones.length !== 1 ? "s" : ""}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showCreate && (
              <div className="mb-4 p-3 rounded border bg-muted/30 space-y-2">
                <p className="text-sm font-medium">Nouvelle zone</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Nom</Label>
                    <Input className="h-8 text-xs" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Rez-de-chaussée" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input className="h-8 text-xs" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Ex: Tableau électrique principal" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || createZoneMut.isPending}>
                    {createZoneMut.isPending ? "Création…" : "Créer"}
                  </Button>
                </div>
              </div>
            )}

            {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {!isLoading && zones.length === 0 && !showCreate && (
              <div className="text-center py-8 space-y-2">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">Aucune zone sur ce terrain.</p>
                <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Créer une zone
                </Button>
              </div>
            )}

            {zones.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Nom</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(zones as any[]).map((z: any) => (
                      <tr key={z.id} className="border-t hover:bg-muted/30 transition-colors">
                        {editingId === z.id ? (
                          <>
                            <td className="py-2 px-3"><Input className="h-7 text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                            <td className="py-2 px-3"><Input className="h-7 text-xs" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></td>
                            <td className="py-2 px-3">
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleUpdate(z.id)}>OK</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>✕</Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-3 font-medium">{z.name}</td>
                            <td className="py-2 px-3 text-muted-foreground">{z.description ?? "—"}</td>
                            <td className="py-2 px-3">
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(z.id); setEditName(z.name); setEditDescription(z.description ?? ""); }}>
                                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(z.id, z.name)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
