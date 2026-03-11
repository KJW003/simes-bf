// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Concentrateurs (Gateways) + Device mapping intégré
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Plus, Trash2, Radio, Router, Cpu, AlertCircle, Check,
  ArrowRight, Info, Link2, Send,
} from "lucide-react";
import {
  useGateways, useGatewayDevices, useIncoming, useAllTerrains, useAllSites,
  useProvisionGateway, useMapGateway, useDeleteGateway, useCreateTerrain,
} from "@/hooks/useApi";
import { terrainLabelFn } from "./admin-shared";
import DeviceMappingDialog from "./DeviceMappingDialog";

export default function GatewaysTab() {
  const { data: gwData, isLoading: gwLoading } = useGateways();
  const gateways: Array<Record<string, any>> = (gwData as any)?.gateways ?? [];
  const { data: allTerrains = [] } = useAllTerrains();
  const { data: inData } = useIncoming();
  const incomingRows: Array<Record<string, any>> = (inData as any)?.rows ?? [];

  const registeredIds = new Set(gateways.map((g: any) => g.gateway_id));
  const discoveredGateways = [...new Set(
    incomingRows.map((r: any) => r.gateway_id).filter((id: any) => id && !registeredIds.has(id))
  )] as string[];

  const discoveredDevicesMap = new Map<string, Array<{ device_key: string; dev_eui: string | null; modbus_addr: number | null; msg_count: number; last_seen: string | null }>>();
  for (const gwId of discoveredGateways) {
    const gwMessages = incomingRows.filter((r: any) => r.gateway_id === gwId && r.device_key && r.device_key !== "unknown");
    const devMap = new Map<string, { device_key: string; dev_eui: string | null; modbus_addr: number | null; msg_count: number; last_seen: string | null }>();
    for (const msg of gwMessages) {
      const existing = devMap.get(msg.device_key);
      if (existing) {
        existing.msg_count++;
        if (msg.received_at && (!existing.last_seen || msg.received_at > existing.last_seen)) existing.last_seen = msg.received_at;
      } else {
        devMap.set(msg.device_key, {
          device_key: msg.device_key,
          dev_eui: msg.dev_eui || null,
          modbus_addr: msg.modbus_addr ?? null,
          msg_count: 1,
          last_seen: msg.received_at || null,
        });
      }
    }
    discoveredDevicesMap.set(gwId, [...devMap.values()]);
  }

  const provisionMut = useProvisionGateway();
  const mapMut = useMapGateway();
  const deleteGwMut = useDeleteGateway();

  const [selectedGw, setSelectedGw] = useState<string | null>(null);
  const isSelectedRegistered = selectedGw ? registeredIds.has(selectedGw) : false;
  const { data: devData } = useGatewayDevices(selectedGw);
  const registeredDevices: Array<Record<string, any>> = (devData as any)?.devices ?? [];
  const displayDevices = isSelectedRegistered ? registeredDevices : (selectedGw ? discoveredDevicesMap.get(selectedGw) || [] : []);

  const selectedGwInfo = gateways.find((g: any) => g.gateway_id === selectedGw);
  const selectedTerrainId: string | null = selectedGwInfo?.terrain_id || null;

  const [mapDialogGw, setMapDialogGw] = useState<string | null>(null);
  const [mapTerrainId, setMapTerrainId] = useState("none");
  const [showCreateTerrainInline, setShowCreateTerrainInline] = useState(false);
  const [inlineTerrainName, setInlineTerrainName] = useState("");
  const [inlineTerrainSiteId, setInlineTerrainSiteId] = useState("none");
  const { data: allSitesList = [] } = useAllSites();
  const createTerrainMut = useCreateTerrain();

  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [newGwId, setNewGwId] = useState("");
  const [registerTerrainId, setRegisterTerrainId] = useState("none");
  const [showCreateTerrainRegister, setShowCreateTerrainRegister] = useState(false);
  const [regTerrainName, setRegTerrainName] = useState("");
  const [regTerrainSiteId, setRegTerrainSiteId] = useState("none");

  const [mappingDevice, setMappingDevice] = useState<Record<string, any> | null>(null);

  const handleMap = async (gatewayId: string) => {
    if (mapTerrainId === "none") return;
    try {
      await mapMut.mutateAsync({ gatewayId, terrain_id: mapTerrainId });
      toast.success(`Concentrateur « ${gatewayId} » mappé avec succès`);
      setMapDialogGw(null);
      setMapTerrainId("none");
      setShowCreateTerrainInline(false);
      setInlineTerrainName("");
      setInlineTerrainSiteId("none");
    } catch (err: any) { toast.error(err?.message || "Erreur lors du mapping"); }
  };

  const handleCreateTerrainAndMap = async (gatewayId: string) => {
    if (inlineTerrainSiteId === "none" || !inlineTerrainName.trim()) return;
    try {
      const t = await createTerrainMut.mutateAsync({ siteId: inlineTerrainSiteId, name: inlineTerrainName.trim() });
      await mapMut.mutateAsync({ gatewayId, terrain_id: t.id });
      toast.success(`Terrain « ${inlineTerrainName} » créé et concentrateur mappé`);
      setMapDialogGw(null);
      setMapTerrainId("none");
      setShowCreateTerrainInline(false);
      setInlineTerrainName("");
      setInlineTerrainSiteId("none");
    } catch { toast.error("Erreur lors de la création / mapping"); }
  };

  const handleRegister = async () => {
    if (!newGwId.trim() || registerTerrainId === "none") return;
    try {
      await mapMut.mutateAsync({ gatewayId: newGwId.trim(), terrain_id: registerTerrainId });
      toast.success(`Concentrateur « ${newGwId.trim()} » enregistré et mappé`);
      setShowRegisterDialog(false);
      setNewGwId("");
      setRegisterTerrainId("none");
      setShowCreateTerrainRegister(false);
      setRegTerrainName("");
      setRegTerrainSiteId("none");
    } catch (err: any) { toast.error(err?.message || "Erreur lors de l'enregistrement"); }
  };

  const handleCreateTerrainAndRegister = async () => {
    if (!newGwId.trim() || regTerrainSiteId === "none" || !regTerrainName.trim()) return;
    try {
      const t = await createTerrainMut.mutateAsync({ siteId: regTerrainSiteId, name: regTerrainName.trim() });
      await mapMut.mutateAsync({ gatewayId: newGwId.trim(), terrain_id: t.id });
      toast.success(`Terrain « ${regTerrainName} » créé et concentrateur enregistré`);
      setShowRegisterDialog(false);
      setNewGwId("");
      setRegisterTerrainId("none");
      setShowCreateTerrainRegister(false);
      setRegTerrainName("");
      setRegTerrainSiteId("none");
    } catch (err: any) { toast.error(err?.message || "Erreur lors de la création / enregistrement"); }
  };

  const handleProvision = async (gatewayId: string) => {
    try {
      await provisionMut.mutateAsync(gatewayId);
      toast.success("Auto-provisionnement réussi : les appareils ont été détectés et mappés automatiquement");
    } catch (err: any) { toast.error(err?.message || "Erreur provision"); }
  };

  const handleDeleteGateway = (gatewayId: string) => {
    if (!confirm(`Supprimer le concentrateur « ${gatewayId} » ?\nCette action supprime uniquement l'enregistrement, pas les données.`)) return;
    deleteGwMut.mutate(gatewayId, {
      onSuccess: () => toast.success("Concentrateur supprimé"),
      onError: (err: any) => toast.error(err?.message || "Erreur suppression"),
    });
  };

  const unmappedDeviceCount = displayDevices.filter((d: any) => !d.point_id).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gérez vos concentrateurs (gateways Milesight), mappez-les à un terrain, puis mappez chaque appareil (Acrel / LoRa) à un point de mesure.
        </p>
        <Button size="sm" onClick={() => setShowRegisterDialog(true)}>
          <Plus className="w-4 h-4 mr-1" /> Enregistrer un concentrateur
        </Button>
      </div>

      {discoveredGateways.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-4 h-4" />
              {discoveredGateways.length} concentrateur{discoveredGateways.length > 1 ? "s" : ""} découvert{discoveredGateways.length > 1 ? "s" : ""} (non enregistré{discoveredGateways.length > 1 ? "s" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-600 dark:text-amber-500 mb-3">
              Ces gateways ont envoyé des données mais ne sont pas encore enregistrés. Cliquez sur un gateway pour voir ses appareils détectés.
            </p>
            <div className="space-y-1.5">
              {discoveredGateways.map((gwId) => {
                const msgCount = incomingRows.filter((r: any) => r.gateway_id === gwId).length;
                const devCount = discoveredDevicesMap.get(gwId)?.length || 0;
                return (
                  <div
                    key={gwId}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg bg-white dark:bg-background border cursor-pointer transition-colors ${selectedGw === gwId ? "border-primary ring-1 ring-primary/30" : "border-amber-200 dark:border-amber-800 hover:border-amber-400"}`}
                    onClick={() => setSelectedGw(gwId)}
                  >
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-amber-500" />
                      <span className="font-mono text-sm font-medium">{gwId}</span>
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">{msgCount} msg</Badge>
                      {devCount > 0 && <Badge variant="outline" className="text-[10px]">{devCount} appareil{devCount > 1 ? "s" : ""}</Badge>}
                    </div>
                    <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100" onClick={(e) => { e.stopPropagation(); setMapDialogGw(gwId); setMapTerrainId("none"); }}>
                      <Link2 className="w-3.5 h-3.5 mr-1" /> Enregistrer & Mapper
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-5 gap-4">
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1"><Router className="w-4 h-4" /> Concentrateurs enregistrés</CardTitle>
          </CardHeader>
          <CardContent>
            {gwLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
            <div className="space-y-1">
              {gateways.map((gw: any) => (
                <div
                  key={gw.gateway_id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${selectedGw === gw.gateway_id ? "bg-primary/10 ring-1 ring-primary/30 font-medium" : "hover:bg-muted"}`}
                  onClick={() => setSelectedGw(gw.gateway_id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Radio className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono truncate">{gw.gateway_id}</span>
                    {gw.terrain_id ? (
                      <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 shrink-0">
                        <Check className="w-3 h-3 mr-0.5" /> {gw.terrain_name || gw.terrain_id.slice(0, 8)}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px] shrink-0">Non mappé</Badge>
                    )}
                  </div>
                  <div className="flex gap-0.5 shrink-0 ml-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Mapper" onClick={(e) => { e.stopPropagation(); setMapDialogGw(gw.gateway_id); setMapTerrainId(gw.terrain_id || "none"); }}>
                      <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title="Supprimer" onClick={(e) => { e.stopPropagation(); handleDeleteGateway(gw.gateway_id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {!gwLoading && gateways.length === 0 && (
                <div className="text-center py-6 space-y-2">
                  <Router className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Aucun concentrateur enregistré</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {selectedGw ? (
                <span className="flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  Appareils de <span className="font-mono">{selectedGw}</span>
                  {selectedTerrainId ? (
                    <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-950 dark:text-green-400">
                      <Check className="w-3 h-3 mr-0.5" /> {selectedGwInfo?.terrain_name || selectedTerrainId.slice(0, 8)}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Gateway non mappé</Badge>
                  )}
                </span>
              ) : "Sélectionnez un concentrateur"}
            </CardTitle>
            {selectedGw && isSelectedRegistered && selectedTerrainId && unmappedDeviceCount > 0 && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" title="Auto-provisionner" onClick={() => handleProvision(selectedGw)} disabled={provisionMut.isPending}>
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {provisionMut.isPending ? "…" : `Auto-provisionner (${unmappedDeviceCount})`}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedGw && (
              <div className="text-center py-10 space-y-2">
                <Info className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Cliquez sur un concentrateur pour voir et mapper ses appareils</p>
              </div>
            )}

            {selectedGw && !isSelectedRegistered && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Ce concentrateur n'est pas encore enregistré.</p>
                  <p>Enregistrez-le et mappez-le à un terrain pour pouvoir mapper ses appareils et exploiter les données.</p>
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-xs border-amber-300" onClick={() => { setMapDialogGw(selectedGw); setMapTerrainId("none"); }}>
                    <Link2 className="w-3 h-3 mr-1" /> Enregistrer & Mapper maintenant
                  </Button>
                </div>
              </div>
            )}

            {selectedGw && isSelectedRegistered && !selectedTerrainId && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Ce concentrateur n'est pas encore mappé à un terrain.</p>
                  <p>Mappez-le d'abord avant de pouvoir mapper ses appareils.</p>
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-xs border-amber-300" onClick={() => { setMapDialogGw(selectedGw); setMapTerrainId("none"); }}>
                    <Link2 className="w-3 h-3 mr-1" /> Mapper maintenant
                  </Button>
                </div>
              </div>
            )}

            {selectedGw && displayDevices.length === 0 && (
              <div className="text-center py-6 space-y-1">
                <Cpu className="w-6 h-6 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">Aucun appareil détecté. Envoyez des données depuis ce gateway.</p>
              </div>
            )}
            {selectedGw && displayDevices.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Device Key</th>
                      <th className="py-2 px-3 font-medium">DevEUI / Modbus</th>
                      <th className="py-2 px-3 font-medium">Messages</th>
                      <th className="py-2 px-3 font-medium">Dernier vu</th>
                      <th className="py-2 px-3 font-medium">Statut</th>
                      <th className="py-2 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayDevices.map((d: any, i: number) => (
                      <tr key={d.device_key || i} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <Cpu className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="font-mono font-medium">{d.device_key}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          {d.dev_eui ? (
                            <span className="font-mono text-[11px]" title={d.dev_eui}>EUI: {d.dev_eui}</span>
                          ) : d.modbus_addr != null ? (
                            <span className="text-[11px]">Modbus: {d.modbus_addr}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">{d.msg_count ?? "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {d.last_seen ? new Date(d.last_seen).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="py-2 px-3">
                          {d.point_id ? (
                            <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-950 dark:text-green-400">
                              <Check className="w-3 h-3 mr-0.5" /> Mappé
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">Non mappé</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {!d.point_id && selectedTerrainId ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMappingDevice(d)}>
                              <Link2 className="w-3 h-3 mr-1" /> Mapper
                            </Button>
                          ) : d.point_id ? (
                            <span className="text-[10px] font-mono text-muted-foreground" title={d.point_id}>{d.point_id.slice(0, 8)}…</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">Mappez le GW d'abord</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Map Gateway Dialog */}
      <Dialog open={!!mapDialogGw} onOpenChange={(open) => { if (!open) { setMapDialogGw(null); setMapTerrainId("none"); setShowCreateTerrainInline(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" /> Mapper le concentrateur
            </DialogTitle>
            <DialogDescription>
              Associez <span className="font-mono font-medium">{mapDialogGw}</span> à un terrain. Tous les appareils de ce gateway seront associés à ce terrain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!showCreateTerrainInline ? (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Terrain de destination</Label>
                <Select value={mapTerrainId} onValueChange={setMapTerrainId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Sélectionnez un terrain…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sélectionnez un terrain —</SelectItem>
                    {(allTerrains as any[]).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{terrainLabelFn(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => { setShowCreateTerrainInline(true); setMapTerrainId("none"); }}>
                  <Plus className="w-3 h-3 mr-1" /> Créer un nouveau terrain
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Nouveau terrain</Label>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowCreateTerrainInline(false)}>← Choisir un existant</Button>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Site parent</Label>
                    <Select value={inlineTerrainSiteId} onValueChange={setInlineTerrainSiteId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sélectionnez un site…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Sélectionnez un site —</SelectItem>
                        {(allSitesList as any[]).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.org_name ? `${s.org_name} › ` : ""}{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nom du terrain</Label>
                    <Input className="h-8 text-xs" value={inlineTerrainName} onChange={(e) => setInlineTerrainName(e.target.value)} placeholder="Ex: Bâtiment A" />
                  </div>
                </div>
              </div>
            )}
            {mapTerrainId !== "none" && !showCreateTerrainInline && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Après le mapping, vous pourrez mapper chaque appareil détecté à un point de mesure directement ci-dessous, ou utiliser l'auto-provisionnement.</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            {showCreateTerrainInline ? (
              <Button onClick={() => mapDialogGw && handleCreateTerrainAndMap(mapDialogGw)} disabled={inlineTerrainSiteId === "none" || !inlineTerrainName.trim() || createTerrainMut.isPending || mapMut.isPending}>
                {createTerrainMut.isPending || mapMut.isPending ? "Création…" : "Créer le terrain & Mapper"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={() => mapDialogGw && handleMap(mapDialogGw)} disabled={mapTerrainId === "none" || mapMut.isPending}>
                {mapMut.isPending ? "Mapping…" : "Mapper"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register New Gateway Dialog */}
      <Dialog open={showRegisterDialog} onOpenChange={(open) => { if (!open) { setShowRegisterDialog(false); setShowCreateTerrainRegister(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" /> Enregistrer un concentrateur
            </DialogTitle>
            <DialogDescription>
              Ajoutez manuellement un gateway en saisissant son identifiant (ex: UG67-OUAGA-01) et le terrain auquel il sera associé.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Identifiant du concentrateur</Label>
              <Input value={newGwId} onChange={(e) => setNewGwId(e.target.value)} placeholder="Ex: UG67-OUAGA-01" className="font-mono" />
            </div>
            {!showCreateTerrainRegister ? (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Terrain de destination</Label>
                <Select value={registerTerrainId} onValueChange={setRegisterTerrainId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Sélectionnez un terrain…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sélectionnez un terrain —</SelectItem>
                    {(allTerrains as any[]).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{terrainLabelFn(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => { setShowCreateTerrainRegister(true); setRegisterTerrainId("none"); }}>
                  <Plus className="w-3 h-3 mr-1" /> Créer un nouveau terrain
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Nouveau terrain</Label>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowCreateTerrainRegister(false)}>← Choisir un existant</Button>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Site parent</Label>
                    <Select value={regTerrainSiteId} onValueChange={setRegTerrainSiteId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sélectionnez un site…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Sélectionnez un site —</SelectItem>
                        {(allSitesList as any[]).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.org_name ? `${s.org_name} › ` : ""}{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nom du terrain</Label>
                    <Input className="h-8 text-xs" value={regTerrainName} onChange={(e) => setRegTerrainName(e.target.value)} placeholder="Ex: Bâtiment A" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            {showCreateTerrainRegister ? (
              <Button onClick={handleCreateTerrainAndRegister} disabled={!newGwId.trim() || regTerrainSiteId === "none" || !regTerrainName.trim() || createTerrainMut.isPending || mapMut.isPending}>
                {createTerrainMut.isPending || mapMut.isPending ? "Création…" : "Créer terrain & Enregistrer"}
              </Button>
            ) : (
              <Button onClick={handleRegister} disabled={!newGwId.trim() || registerTerrainId === "none" || mapMut.isPending}>
                {mapMut.isPending ? "Enregistrement…" : "Enregistrer & Mapper"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeviceMappingDialog
        device={mappingDevice}
        onClose={() => setMappingDevice(null)}
        defaultTerrainId={selectedTerrainId}
        allTerrains={allTerrains as any[]}
      />
    </div>
  );
}
