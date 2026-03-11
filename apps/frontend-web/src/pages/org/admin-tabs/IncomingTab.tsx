// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Messages Entrants (Incoming)
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Trash2, RefreshCw, MessageSquare, Info } from "lucide-react";
import {
  useIncoming, useDeleteIncoming, useDeleteAllIncoming, useReconcileIncoming,
} from "@/hooks/useApi";

export default function IncomingTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const actualFilter = statusFilter === "all" ? "" : statusFilter;
  const { data: inData, isLoading, refetch } = useIncoming(actualFilter ? { status: actualFilter } : undefined);
  const rows: Array<Record<string, any>> = (inData as any)?.rows ?? [];

  const [infoMsg, setInfoMsg] = useState<Record<string, any> | null>(null);

  const deleteMut = useDeleteIncoming();
  const deleteAllMut = useDeleteAllIncoming();
  const reconcileMut = useReconcileIncoming();

  const handleDeleteOne = (id: string) => {
    deleteMut.mutate(id, {
      onSuccess: () => toast.success("Message supprimé"),
      onError: (err: any) => toast.error(err?.message || "Erreur suppression"),
    });
  };

  const handleReconcile = () => {
    reconcileMut.mutate(undefined, {
      onSuccess: (data: any) => {
        const m = (data as any)?.reconciled_mapped ?? 0;
        const u = (data as any)?.reconciled_unmapped ?? 0;
        const total = m + u;
        toast.success(total > 0 ? `${total} message(s) resynchronisé(s) (${m} mappé, ${u} démappé)` : "Tout est déjà synchronisé");
      },
      onError: (err: any) => toast.error(err?.message || "Erreur réconciliation"),
    });
  };

  const handlePurgeAll = () => {
    const filterLabel = statusFilter === "all" ? "TOUS les messages" : `les messages « ${statusFilter} »`;
    if (!confirm(`Supprimer ${filterLabel} ?\nCette action est irréversible.`)) return;
    const params = actualFilter ? { status: actualFilter } : undefined;
    deleteAllMut.mutate(params, {
      onSuccess: (data: any) => {
        const count = (data as any)?.deleted_count ?? 0;
        toast.success(`${count} message(s) supprimé(s)`);
      },
      onError: (error: any) => {
        const msg = error?.message || JSON.stringify(error);
        toast.error(`Erreur purge: ${msg}`);
        console.error("Delete all incoming error:", error);
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium flex items-center gap-1"><MessageSquare className="w-4 h-4" /> Messages entrants</CardTitle>
        <div className="flex gap-2 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="unmapped">Non mappés</SelectItem>
              <SelectItem value="mapped">Mappés</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleReconcile} disabled={reconcileMut.isPending} title="Resynchroniser les statuts des messages avec les mappings existants">
            {reconcileMut.isPending ? "Sync…" : "Resync statuts"}
          </Button>
          {rows.length > 0 && (
            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handlePurgeAll} disabled={deleteAllMut.isPending}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {deleteAllMut.isPending ? "Purge…" : `Purger (${rows.length})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
        {!isLoading && rows.length === 0 && <p className="text-xs text-muted-foreground italic">Aucun message</p>}
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Gateway</th>
                <th className="py-1 pr-2">Device Key</th>
                <th className="py-1 pr-2">DevEUI / Modbus</th>
                <th className="py-1 pr-2">Statut</th>
                <th className="py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((msg: any) => (
                <tr key={msg.id} className="border-b border-muted/30 hover:bg-muted/30">
                  <td className="py-1 pr-2">{msg.received_at ? new Date(msg.received_at).toLocaleString("fr-FR") : "—"}</td>
                  <td className="py-1 pr-2 font-mono">{msg.gateway_id ?? "—"}</td>
                  <td className="py-1 pr-2 font-mono">{msg.device_key ?? "—"}</td>
                  <td className="py-1 pr-2 font-mono text-muted-foreground">
                    {msg.dev_eui ? `EUI: ${msg.dev_eui}` : msg.modbus_addr != null ? `Modbus: ${msg.modbus_addr}` : "—"}
                  </td>
                  <td className="py-1 pr-2"><Badge variant={msg.status === "unmapped" ? "destructive" : "outline"} className="text-[10px]">{msg.status}</Badge></td>
                  <td className="py-1">
                    <div className="flex gap-0.5">
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setInfoMsg(msg)}>
                        <Info className="w-3 h-3 mr-1" />Détails
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDeleteOne(msg.id)} disabled={deleteMut.isPending}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!infoMsg} onOpenChange={(open) => { if (!open) setInfoMsg(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5" /> Détails du message
            </DialogTitle>
            <DialogDescription>
              Message reçu le {infoMsg?.received_at ? new Date(infoMsg.received_at).toLocaleString("fr-FR") : "—"}
            </DialogDescription>
          </DialogHeader>
          {infoMsg && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Gateway</Label>
                  <p className="font-mono">{infoMsg.gateway_id ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Device Key</Label>
                  <p className="font-mono">{infoMsg.device_key ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">DevEUI</Label>
                  <p className="font-mono">{infoMsg.dev_eui ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Adresse Modbus</Label>
                  <p className="font-mono">{infoMsg.modbus_addr ?? "—"}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Statut</Label>
                  <Badge variant={infoMsg.status === "unmapped" ? "destructive" : "outline"} className="text-[10px]">{infoMsg.status}</Badge>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Topic</Label>
                  <p className="font-mono">{infoMsg.topic ?? "—"}</p>
                </div>
                {infoMsg.mapped_terrain_id && (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Terrain mappé</Label>
                    <p className="font-mono text-[11px]">{infoMsg.mapped_terrain_id}</p>
                  </div>
                )}
                {infoMsg.mapped_point_id && (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">Point mappé</Label>
                    <p className="font-mono text-[11px]">{infoMsg.mapped_point_id}</p>
                  </div>
                )}
              </div>
              {infoMsg.payload_raw && (
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Payload (JSON brut)</Label>
                  <pre className="bg-muted p-3 rounded-lg text-[11px] font-mono overflow-auto max-h-60 whitespace-pre-wrap break-all">
                    {JSON.stringify(infoMsg.payload_raw, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Fermer</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
