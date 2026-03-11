// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Appareils (Device Mapping)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Cpu, Send, AlertCircle, Check, Link2, Router,
} from "lucide-react";
import {
  useGateways, useGatewayDevices, useAllTerrains, useProvisionGateway,
} from "@/hooks/useApi";
import DeviceMappingDialog from "./DeviceMappingDialog";

export default function DevicesTab() {
  const { data: gwData } = useGateways();
  const gateways: Array<Record<string, any>> = (gwData as any)?.gateways ?? [];
  const [selectedGw, setSelectedGw] = useState<string | null>(null);
  const { data: devData, isLoading } = useGatewayDevices(selectedGw);
  const devices: Array<Record<string, any>> = (devData as any)?.devices ?? [];

  const selectedGateway = gateways.find((g: any) => g.gateway_id === selectedGw);
  const gatewayTerrainId: string | null = selectedGateway?.terrain_id || null;
  const gatewayTerrainName: string = selectedGateway?.terrain_name || "";

  const { data: allTerrains = [] } = useAllTerrains();
  const provisionMut = useProvisionGateway();

  const [mappingDevice, setMappingDevice] = useState<Record<string, any> | null>(null);

  const handleAutoProvision = async () => {
    if (!selectedGw) return;
    try {
      await provisionMut.mutateAsync(selectedGw);
      toast.success("Auto-provisionnement terminé ! Les appareils ont été détectés et mappés automatiquement.");
    } catch (err: any) { toast.error(err?.message || "Erreur lors de l'auto-provisionnement"); }
  };

  const unmappedCount = devices.filter((d: any) => !d.point_id).length;
  const mappedCount = devices.filter((d: any) => d.point_id).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="space-y-1.5 flex-1 max-w-sm">
          <Label className="text-sm font-medium">Concentrateur</Label>
          <Select value={selectedGw ?? "none"} onValueChange={(v) => setSelectedGw(v === "none" ? null : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Choisir un concentrateur…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sélectionnez un concentrateur —</SelectItem>
              {gateways.map((gw: any) => (
                <SelectItem key={gw.gateway_id} value={gw.gateway_id}>
                  {gw.gateway_id} {gw.terrain_name ? `(${gw.terrain_name})` : "(non mappé)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedGw && gatewayTerrainId && unmappedCount > 0 && (
          <Button size="sm" variant="outline" onClick={handleAutoProvision} disabled={provisionMut.isPending}>
            <Send className="w-4 h-4 mr-1" />
            {provisionMut.isPending ? "Provisionnement…" : `Auto-provisionner (${unmappedCount})`}
          </Button>
        )}
      </div>

      {!selectedGw && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Cpu className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Sélectionnez un concentrateur pour voir et mapper ses appareils Acrel.</p>
            {gateways.length === 0 && (
              <p className="text-xs text-muted-foreground">Aucun concentrateur enregistré. Allez dans l'onglet « Concentrateurs » pour en ajouter un.</p>
            )}
          </CardContent>
        </Card>
      )}

      {selectedGw && !gatewayTerrainId && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-6 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">Ce concentrateur n'est pas encore mappé à un terrain</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">Allez dans l'onglet « Concentrateurs » pour mapper <span className="font-mono">{selectedGw}</span> à un terrain avant de pouvoir mapper ses appareils.</p>
          </CardContent>
        </Card>
      )}

      {selectedGw && gatewayTerrainId && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Appareils de {selectedGw}
              <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-950 dark:text-green-400">
                <Check className="w-3 h-3 mr-0.5" /> Terrain: {gatewayTerrainName || gatewayTerrainId.slice(0, 8)}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {devices.length > 0 && (
                <>
                  <span>{mappedCount} mappé{mappedCount > 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span className={unmappedCount > 0 ? "text-amber-600 font-medium" : ""}>{unmappedCount} non mappé{unmappedCount > 1 ? "s" : ""}</span>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
            {!isLoading && devices.length === 0 && (
              <div className="text-center py-8 space-y-2">
                <Cpu className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">Aucun appareil détecté pour ce concentrateur.</p>
                <p className="text-xs text-muted-foreground">Envoyez des données depuis le gateway pour que les appareils apparaissent ici.</p>
              </div>
            )}
            {devices.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Device Key</th>
                      <th className="py-2 px-3 font-medium">Type</th>
                      <th className="py-2 px-3 font-medium">Identifiant</th>
                      <th className="py-2 px-3 font-medium">Messages</th>
                      <th className="py-2 px-3 font-medium">Dernier vu</th>
                      <th className="py-2 px-3 font-medium">Statut</th>
                      <th className="py-2 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d: any, i: number) => (
                      <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3 font-mono font-medium">{d.device_key}</td>
                        <td className="py-2 px-3">
                          {d.modbus_addr != null ? (
                            <Badge variant="outline" className="text-[10px]">Modbus</Badge>
                          ) : d.dev_eui ? (
                            <Badge variant="outline" className="text-[10px]">LoRa</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">—</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">
                          {d.modbus_addr != null ? `Addr: ${d.modbus_addr}` : d.dev_eui ? `EUI: ${(d.dev_eui as string).slice(-8)}` : "—"}
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
                          {!d.point_id ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMappingDevice(d)}>
                              <Link2 className="w-3 h-3 mr-1" /> Mapper
                            </Button>
                          ) : (
                            <span className="text-[10px] font-mono text-muted-foreground" title={d.point_id}>{d.point_id.slice(0, 8)}…</span>
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
      )}

      <DeviceMappingDialog
        device={mappingDevice}
        onClose={() => setMappingDevice(null)}
        defaultTerrainId={gatewayTerrainId}
        allTerrains={allTerrains as any[]}
      />
    </div>
  );
}
