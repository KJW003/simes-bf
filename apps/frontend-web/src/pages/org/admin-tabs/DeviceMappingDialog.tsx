// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Device Mapping Dialog component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Plus, Check, ArrowRight, Link2 } from "lucide-react";
import { useMapDevice, useCreatePoint, usePoints } from "@/hooks/useApi";
import { MEASURE_CATEGORIES, terrainLabelFn } from "./admin-shared";

export default function DeviceMappingDialog({
  device,
  onClose,
  defaultTerrainId,
  allTerrains,
}: {
  device: Record<string, any> | null;
  onClose: () => void;
  defaultTerrainId: string | null;
  allTerrains: any[];
}) {
  const mapDeviceMut = useMapDevice();
  const createPointMut = useCreatePoint();

  const [mapTerrainId, setMapTerrainId] = useState(defaultTerrainId || "none");
  const [mapPointId, setMapPointId] = useState("none");
  const [showCreatePoint, setShowCreatePoint] = useState(false);
  const [newPointName, setNewPointName] = useState("");
  const [newPointDevice, setNewPointDevice] = useState("ADW300");
  const [newPointCategory, setNewPointCategory] = useState("LOAD");

  const deviceKey = device?.device_key;
  useEffect(() => {
    setMapTerrainId(defaultTerrainId || "none");
    setMapPointId("none");
    setShowCreatePoint(false);
    setNewPointName("");
    setNewPointDevice("ADW300");
    setNewPointCategory("LOAD");
  }, [deviceKey, defaultTerrainId]);

  const effectiveTerrainId = mapTerrainId !== "none" ? mapTerrainId : null;
  const { data: terrainPoints = [] } = usePoints(effectiveTerrainId);

  const handleMapDevice = async () => {
    if (!device || mapTerrainId === "none" || mapPointId === "none") return;
    try {
      await mapDeviceMut.mutateAsync({
        deviceKey: device.device_key,
        terrain_id: mapTerrainId,
        point_id: mapPointId,
        modbus_addr: device.modbus_addr ? Number(device.modbus_addr) : undefined,
        dev_eui: device.dev_eui || undefined,
      });
      toast.success(`Appareil « ${device.device_key} » mappé avec succès`);
      onClose();
    } catch (err: any) { toast.error(err?.message || "Erreur lors du mapping"); }
  };

  const handleCreatePointAndMap = async () => {
    if (!device || mapTerrainId === "none" || !newPointName.trim()) return;
    try {
      const point = await createPointMut.mutateAsync({
        terrainId: mapTerrainId,
        name: newPointName.trim(),
        device: newPointDevice,
        measure_category: newPointCategory,
        lora_dev_eui: device.dev_eui || undefined,
        modbus_addr: device.modbus_addr ? Number(device.modbus_addr) : undefined,
      });
      await mapDeviceMut.mutateAsync({
        deviceKey: device.device_key,
        terrain_id: mapTerrainId,
        point_id: point.id,
        modbus_addr: device.modbus_addr ? Number(device.modbus_addr) : undefined,
        dev_eui: device.dev_eui || undefined,
      });
      toast.success(`Point « ${newPointName} » créé et appareil mappé`);
      onClose();
    } catch (err: any) { toast.error(err?.message || "Erreur lors de la création / mapping"); }
  };

  return (
    <Dialog open={!!device} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" /> Mapper l'appareil
          </DialogTitle>
          <DialogDescription>
            <span>Associez </span>
            <span className="font-mono font-medium">{device?.device_key}</span>
            <span> à un point de mesure.</span>
            {device?.dev_eui && <span className="ml-1">(DevEUI: <span className="font-mono">{device.dev_eui}</span>)</span>}
            {device?.modbus_addr != null && <span className="ml-1">(Modbus: {device.modbus_addr})</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Step 1: Terrain */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">1</span>
              Terrain
            </Label>
            <Select value={mapTerrainId} onValueChange={(v) => { setMapTerrainId(v); setMapPointId("none"); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Sélectionnez un terrain —</SelectItem>
                {allTerrains.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{terrainLabelFn(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {defaultTerrainId && mapTerrainId === defaultTerrainId && (
              <p className="text-[11px] text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Terrain du concentrateur (auto-détecté)</p>
            )}
          </div>

          {/* Step 2: Select existing point */}
          {mapTerrainId !== "none" && !showCreatePoint && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">2</span>
                Point de mesure
              </Label>
              {terrainPoints.length > 0 ? (
                <Select value={mapPointId} onValueChange={setMapPointId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Sélectionnez un point…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sélectionnez un point —</SelectItem>
                    {terrainPoints.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.measure_category}){p.modbus_addr ? ` · Modbus:${p.modbus_addr}` : ""}{p.lora_dev_eui ? ` · EUI:${(p.lora_dev_eui as string).slice(-6)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground italic py-1">Aucun point de mesure sur ce terrain. Créez-en un ci-dessous.</p>
              )}
              <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => setShowCreatePoint(true)}>
                <Plus className="w-3 h-3 mr-1" /> Créer un nouveau point de mesure
              </Button>
            </div>
          )}

          {/* Step 2 alt: Create new point */}
          {mapTerrainId !== "none" && showCreatePoint && (
            <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">2</span>
                  Nouveau point de mesure
                </Label>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowCreatePoint(false)}>← Choisir un existant</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nom du point</Label>
                  <Input className="h-8 text-xs" value={newPointName} onChange={(e) => setNewPointName(e.target.value)} placeholder="Ex: Acrel Charge Bât. A" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Modèle d'appareil</Label>
                  <Input className="h-8 text-xs" value={newPointDevice} onChange={(e) => setNewPointDevice(e.target.value)} placeholder="Ex: ADW300" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Catégorie de mesure</Label>
                  <Select value={newPointCategory} onValueChange={setNewPointCategory}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEASURE_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {device?.modbus_addr != null && (
                <p className="text-[11px] text-muted-foreground">Adresse Modbus <span className="font-mono">{device.modbus_addr}</span> sera associée automatiquement.</p>
              )}
              {device?.dev_eui && (
                <p className="text-[11px] text-muted-foreground">DevEUI <span className="font-mono">{device.dev_eui}</span> sera associé automatiquement.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
          {showCreatePoint ? (
            <Button onClick={handleCreatePointAndMap} disabled={mapTerrainId === "none" || !newPointName.trim() || createPointMut.isPending || mapDeviceMut.isPending}>
              {createPointMut.isPending || mapDeviceMut.isPending ? "Création…" : "Créer le point & Mapper"}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleMapDevice} disabled={mapTerrainId === "none" || mapPointId === "none" || mapDeviceMut.isPending}>
              {mapDeviceMut.isPending ? "Mapping…" : "Mapper l'appareil"}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
