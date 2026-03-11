// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Points de mesure (Measurement Points CRUD)
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
import { Plus, Pencil, Trash2, Layers, Cpu } from "lucide-react";
import {
  useAllTerrains, usePoints, useCreatePoint, useUpdatePoint, useDeletePoint,
} from "@/hooks/useApi";
import { MEASURE_CATEGORIES, terrainLabelFn } from "./admin-shared";

export default function MeasurementPointsTab() {
  const { data: allTerrains = [] } = useAllTerrains();
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const { data: points = [], isLoading } = usePoints(selectedTerrainId);
  const createPointMut = useCreatePoint();
  const updatePointMut = useUpdatePoint();
  const deletePointMut = useDeletePoint();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDevice, setNewDevice] = useState("ADW300");
  const [newCategory, setNewCategory] = useState("LOAD");
  const [newModbus, setNewModbus] = useState("");
  const [newDevEui, setNewDevEui] = useState("");
  const [newCtRatio, setNewCtRatio] = useState("1");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDevice, setEditDevice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editCtRatio, setEditCtRatio] = useState("1");

  const handleCreate = async () => {
    if (!selectedTerrainId || !newName.trim()) return;
    try {
      await createPointMut.mutateAsync({
        terrainId: selectedTerrainId,
        name: newName.trim(),
        device: newDevice,
        measure_category: newCategory,
        modbus_addr: newModbus ? Number(newModbus) : undefined,
        lora_dev_eui: newDevEui || undefined,
        ct_ratio: newCtRatio ? Number(newCtRatio) : 1,
      });
      toast.success("Point de mesure créé");
      setShowCreate(false);
      setNewName(""); setNewDevice("ADW300"); setNewCategory("LOAD"); setNewModbus(""); setNewDevEui(""); setNewCtRatio("1");
    } catch { toast.error("Erreur création du point"); }
  };

  const handleUpdate = async (pointId: string) => {
    try {
      await updatePointMut.mutateAsync({
        pointId,
        name: editName,
        device: editDevice,
        measure_category: editCategory,
        ct_ratio: editCtRatio ? Number(editCtRatio) : 1,
      });
      toast.success("Point mis à jour");
      setEditingId(null);
    } catch { toast.error("Erreur mise à jour"); }
  };

  const handleDelete = (pointId: string, name: string) => {
    if (!confirm(`Supprimer le point « ${name} » ?\nCela supprimera aussi le mapping appareil associé.`)) return;
    deletePointMut.mutate(pointId, {
      onSuccess: () => toast.success("Point supprimé"),
      onError: () => toast.error("Erreur suppression"),
    });
  };

  return (
    <div className="space-y-4">
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
            <Plus className="w-4 h-4 mr-1" /> Ajouter un point
          </Button>
        )}
      </div>

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Layers className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Sélectionnez un terrain pour gérer ses points de mesure.</p>
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Points de mesure
              <Badge variant="outline" className="text-[10px]">{points.length} point{points.length !== 1 ? "s" : ""}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showCreate && (
              <div className="mb-4 p-3 rounded border bg-muted/30 space-y-2">
                <p className="text-sm font-medium">Nouveau point de mesure</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Nom</Label>
                    <Input className="h-8 text-xs" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: ACREL Charge Bât A" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Modèle appareil</Label>
                    <Input className="h-8 text-xs" value={newDevice} onChange={(e) => setNewDevice(e.target.value)} placeholder="ADW300" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Catégorie</Label>
                    <Select value={newCategory} onValueChange={setNewCategory}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MEASURE_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Adresse Modbus <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input className="h-8 text-xs" value={newModbus} onChange={(e) => setNewModbus(e.target.value)} placeholder="Ex: 1" type="number" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">DevEUI LoRa <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input className="h-8 text-xs font-mono" value={newDevEui} onChange={(e) => setNewDevEui(e.target.value)} placeholder="Ex: 24E124710D470399" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ratio TC <span className="text-muted-foreground">(CT ratio)</span></Label>
                    <Input className="h-8 text-xs" value={newCtRatio} onChange={(e) => setNewCtRatio(e.target.value)} placeholder="1" type="number" min="1" step="1" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || createPointMut.isPending}>
                    {createPointMut.isPending ? "Création…" : "Créer"}
                  </Button>
                </div>
              </div>
            )}

            {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {!isLoading && points.length === 0 && !showCreate && (
              <div className="text-center py-8 space-y-2">
                <Cpu className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">Aucun point de mesure sur ce terrain.</p>
                <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Créer un point
                </Button>
              </div>
            )}

            {points.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Nom</th>
                      <th className="py-2 px-3 font-medium">Appareil</th>
                      <th className="py-2 px-3 font-medium">Catégorie</th>
                      <th className="py-2 px-3 font-medium">Ratio TC</th>
                      <th className="py-2 px-3 font-medium">Modbus</th>
                      <th className="py-2 px-3 font-medium">DevEUI</th>
                      <th className="py-2 px-3 font-medium">Statut</th>
                      <th className="py-2 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p: any) => (
                      <tr key={p.id} className="border-t hover:bg-muted/30 transition-colors">
                        {editingId === p.id ? (
                          <>
                            <td className="py-2 px-3"><Input className="h-7 text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                            <td className="py-2 px-3"><Input className="h-7 text-xs" value={editDevice} onChange={(e) => setEditDevice(e.target.value)} /></td>
                            <td className="py-2 px-3">
                              <Select value={editCategory} onValueChange={setEditCategory}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {MEASURE_CATEGORIES.map((c) => (
                                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="py-2 px-3"><Input className="h-7 text-xs w-16" type="number" min="1" step="1" value={editCtRatio} onChange={(e) => setEditCtRatio(e.target.value)} /></td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.modbus_addr ?? "—"}</td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.lora_dev_eui ? (p.lora_dev_eui as string).slice(-8) : "—"}</td>
                            <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{p.status}</Badge></td>
                            <td className="py-2 px-3">
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleUpdate(p.id)}>OK</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>✕</Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-3 font-medium">{p.name}</td>
                            <td className="py-2 px-3">{p.device}</td>
                            <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{p.measure_category}</Badge></td>
                            <td className="py-2 px-3 font-mono">{p.ct_ratio ?? 1}</td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.modbus_addr ?? "—"}</td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.lora_dev_eui ? (p.lora_dev_eui as string).slice(-8) : "—"}</td>
                            <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{p.status}</Badge></td>
                            <td className="py-2 px-3">
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(p.id); setEditName(p.name); setEditDevice(p.device); setEditCategory(p.measure_category); setEditCtRatio(String(p.ct_ratio ?? 1)); }}>
                                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(p.id, p.name)}>
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
