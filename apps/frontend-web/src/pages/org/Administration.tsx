// ============================================================
// Administration – Full CRUD admin panel
// Tabs: Référentiel | Concentrateurs | Appareils | Points | Zones | Messages | Utilisateurs
// ============================================================

import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, ChevronRight, RefreshCw, Send, Radio,
  Building2, MapPin, Layers, Router, Cpu, MessageSquare, Users,
  AlertCircle, Check, ArrowRight, Info, Link2,
} from "lucide-react";

import {
  useOrgs, useSites, useTerrains, useAllTerrains, useAllSites,
  useGateways, useGatewayDevices, useIncoming,
  useUsers, usePoints, useZones,
  useCreateOrg, useUpdateOrg, useDeleteOrg,
  useCreateSite, useUpdateSite, useDeleteSite,
  useCreateTerrain, useUpdateTerrain, useDeleteTerrain,
  useProvisionGateway, useMapGateway, useDeleteGateway,
  useMapDevice, useUnmapDevice, useCreatePoint, useUpdatePoint, useDeletePoint,
  useDeleteIncoming, useDeleteAllIncoming, useReconcileIncoming,
  useCreateUser, useUpdateUser, useDeleteUser,
  useCreateZone, useUpdateZone, useDeleteZone,
} from "@/hooks/useApi";
import api from "@/lib/api";
import { PvSystemsTab } from "@/components/admin/PvSystemsTab";

// ─── Error Boundary ────────────────────────────────────────
class TabErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Card className="m-4">
          <CardContent className="py-8 text-center space-y-2">
            <p className="text-destructive font-medium">Erreur dans l'onglet {this.props.name}</p>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Réessayer</Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 1 – Référentiel (Orgs / Sites / Terrains)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ReferentialTab() {
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const { data: sites = [] } = useSites(selectedOrgId);
  const { data: terrains = [] } = useTerrains(selectedSiteId);

  // Mutations
  const createOrg = useCreateOrg();
  const updateOrg = useUpdateOrg();
  const deleteOrg = useDeleteOrg();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const createTerrain = useCreateTerrain();
  const updateTerrain = useUpdateTerrain();
  const deleteTerrain = useDeleteTerrain();

  // Create dialogs
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [showCreateSite, setShowCreateSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLocation, setNewSiteLocation] = useState("");
  const [showCreateTerrain, setShowCreateTerrain] = useState(false);
  const [newTerrainName, setNewTerrainName] = useState("");

  // Edit inline
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState("");
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editSiteName, setEditSiteName] = useState("");
  const [editingTerrainId, setEditingTerrainId] = useState<string | null>(null);
  const [editTerrainName, setEditTerrainName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "org"; id: string; name: string }
    | { type: "site"; id: string; name: string }
    | { type: "terrain"; id: string; name: string }
    | null
  >(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    try { await createOrg.mutateAsync(newOrgName.trim()); toast.success("Organisation créée"); setShowCreateOrg(false); setNewOrgName(""); } catch { toast.error("Erreur création org"); }
  };
  const handleCreateSite = async () => {
    if (!selectedOrgId || !newSiteName.trim()) return;
    try { await createSite.mutateAsync({ orgId: selectedOrgId, name: newSiteName.trim(), location: newSiteLocation.trim() || undefined }); toast.success("Site créé"); setShowCreateSite(false); setNewSiteName(""); setNewSiteLocation(""); } catch { toast.error("Erreur création site"); }
  };
  const handleCreateTerrain = async () => {
    if (!selectedSiteId || !newTerrainName.trim()) return;
    try { await createTerrain.mutateAsync({ siteId: selectedSiteId, name: newTerrainName.trim() }); toast.success("Terrain créé"); setShowCreateTerrain(false); setNewTerrainName(""); } catch { toast.error("Erreur création terrain"); }
  };

  const requiredDeleteKeyword = "CONFIRM-DELETE";

  const openDeleteConfirm = (target: NonNullable<typeof deleteTarget>) => {
    setDeleteError(null);
    setDeleteConfirmText("");
    setDeleteTarget(target);
  };

  const closeDeleteConfirm = () => {
    setDeleteError(null);
    setDeleteConfirmText("");
    setDeleteTarget(null);
  };

  const executeDeleteTarget = async () => {
    if (!deleteTarget) return;

    setDeleteError(null);
    setDeletingTargetId(deleteTarget.id);
    try {
      if (deleteTarget.type === "org") {
        await deleteOrg.mutateAsync(deleteTarget.id);
        toast.success("Organisation supprimée");
        if (selectedOrgId === deleteTarget.id) {
          setSelectedOrgId(null);
          setSelectedSiteId(null);
        }
      } else if (deleteTarget.type === "site") {
        await deleteSite.mutateAsync(deleteTarget.id);
        toast.success("Site supprimé");
        if (selectedSiteId === deleteTarget.id) {
          setSelectedSiteId(null);
        }
      } else {
        await deleteTerrain.mutateAsync(deleteTarget.id);
        toast.success("Terrain supprimé");
      }
      closeDeleteConfirm();
    } catch (e: any) {
      setDeleteError(e?.message || "Impossible de supprimer cet élément");
    } finally {
      setDeletingTargetId(null);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Organisations */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1"><Building2 className="w-4 h-4" /> Organisations</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setShowCreateOrg(true)}><Plus className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {orgsLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
          {orgs.map((o) => (
            <div key={o.id} className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-sm ${selectedOrgId === o.id ? "bg-primary/10 font-medium" : "hover:bg-muted"}`} onClick={() => { setSelectedOrgId(o.id); setSelectedSiteId(null); }}>
              {editingOrgId === o.id ? (
                <form className="flex gap-1 flex-1" onSubmit={(e) => { e.preventDefault(); updateOrg.mutateAsync({ orgId: o.id, name: editOrgName }).then(() => { toast.success("Org renommée"); setEditingOrgId(null); }); }}>
                  <Input className="h-6 text-xs" value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} autoFocus />
                  <Button type="submit" size="sm" variant="ghost" className="h-6 px-1 text-xs">OK</Button>
                </form>
              ) : (
                <>
                  <span className="flex items-center gap-1">{o.name} <ChevronRight className="w-3 h-3 text-muted-foreground" /></span>
                  <span className="flex gap-0.5">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setEditingOrgId(o.id); setEditOrgName(o.name); }}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); openDeleteConfirm({ type: "org", id: o.id, name: o.name }); }}><Trash2 className="w-3 h-3" /></Button>
                  </span>
                </>
              )}
            </div>
          ))}
          {!orgsLoading && orgs.length === 0 && <p className="text-xs text-muted-foreground italic">Aucune organisation</p>}
        </CardContent>
      </Card>

      {/* Sites */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1"><MapPin className="w-4 h-4" /> Sites</CardTitle>
          {selectedOrgId && <Button size="sm" variant="ghost" onClick={() => setShowCreateSite(true)}><Plus className="w-4 h-4" /></Button>}
        </CardHeader>
        <CardContent className="space-y-1">
          {!selectedOrgId && <p className="text-xs text-muted-foreground italic">Sélectionnez une organisation</p>}
          {sites.map((s) => (
            <div key={s.id} className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-sm ${selectedSiteId === s.id ? "bg-primary/10 font-medium" : "hover:bg-muted"}`} onClick={() => setSelectedSiteId(s.id)}>
              {editingSiteId === s.id ? (
                <form className="flex gap-1 flex-1" onSubmit={(e) => { e.preventDefault(); updateSite.mutateAsync({ siteId: s.id, name: editSiteName }).then(() => { toast.success("Site renommé"); setEditingSiteId(null); }); }}>
                  <Input className="h-6 text-xs" value={editSiteName} onChange={(e) => setEditSiteName(e.target.value)} autoFocus />
                  <Button type="submit" size="sm" variant="ghost" className="h-6 px-1 text-xs">OK</Button>
                </form>
              ) : (
                <>
                  <span className="flex items-center gap-1">{s.name} <ChevronRight className="w-3 h-3 text-muted-foreground" /></span>
                  <span className="flex gap-0.5">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setEditingSiteId(s.id); setEditSiteName(s.name); }}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); openDeleteConfirm({ type: "site", id: s.id, name: s.name }); }}><Trash2 className="w-3 h-3" /></Button>
                  </span>
                </>
              )}
            </div>
          ))}
          {selectedOrgId && sites.length === 0 && <p className="text-xs text-muted-foreground italic">Aucun site</p>}
        </CardContent>
      </Card>

      {/* Terrains */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1"><Layers className="w-4 h-4" /> Terrains</CardTitle>
          {selectedSiteId && <Button size="sm" variant="ghost" onClick={() => setShowCreateTerrain(true)}><Plus className="w-4 h-4" /></Button>}
        </CardHeader>
        <CardContent className="space-y-1">
          {!selectedSiteId && <p className="text-xs text-muted-foreground italic">Sélectionnez un site</p>}
          {terrains.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-2 py-1 rounded text-sm hover:bg-muted">
              {editingTerrainId === t.id ? (
                <form className="flex gap-1 flex-1" onSubmit={(e) => { e.preventDefault(); updateTerrain.mutateAsync({ terrainId: t.id, name: editTerrainName }).then(() => { toast.success("Terrain renommé"); setEditingTerrainId(null); }); }}>
                  <Input className="h-6 text-xs" value={editTerrainName} onChange={(e) => setEditTerrainName(e.target.value)} autoFocus />
                  <Button type="submit" size="sm" variant="ghost" className="h-6 px-1 text-xs">OK</Button>
                </form>
              ) : (
                <>
                  <span>{t.name}</span>
                  <span className="flex gap-0.5">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingTerrainId(t.id); setEditTerrainName(t.name); }}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => { openDeleteConfirm({ type: "terrain", id: t.id, name: t.name }); }}><Trash2 className="w-3 h-3" /></Button>
                  </span>
                </>
              )}
            </div>
          ))}
          {selectedSiteId && terrains.length === 0 && <p className="text-xs text-muted-foreground italic">Aucun terrain</p>}
        </CardContent>
      </Card>

      {/* Create Org Dialog */}
      <Dialog open={showCreateOrg} onOpenChange={setShowCreateOrg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouvelle organisation</DialogTitle></DialogHeader>
          <DialogDescription className="sr-only">Créer une nouvelle organisation</DialogDescription>
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="Ex: SONABEL" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={handleCreateOrg} disabled={!newOrgName.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Site Dialog */}
      <Dialog open={showCreateSite} onOpenChange={setShowCreateSite}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouveau site</DialogTitle></DialogHeader>
          <DialogDescription className="sr-only">Créer un nouveau site</DialogDescription>
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="Ex: Ouagadougou Centre" />
            <Label>Localisation <span className="text-muted-foreground">(optionnel)</span></Label>
            <Input value={newSiteLocation} onChange={(e) => setNewSiteLocation(e.target.value)} placeholder="12.3657, -1.5339" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={handleCreateSite} disabled={!newSiteName.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Terrain Dialog */}
      <Dialog open={showCreateTerrain} onOpenChange={setShowCreateTerrain}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Nouveau terrain</DialogTitle></DialogHeader>
          <DialogDescription className="sr-only">Créer un nouveau terrain</DialogDescription>
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input value={newTerrainName} onChange={(e) => setNewTerrainName(e.target.value)} placeholder="Ex: Bâtiment A" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={handleCreateTerrain} disabled={!newTerrainName.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) closeDeleteConfirm(); }}
        title="Confirmer la suppression"
        description="Cette action est irréversible et supprimera définitivement l'élément sélectionné."
        requiredKeyword={requiredDeleteKeyword}
        confirmText={deleteConfirmText}
        onConfirmTextChange={setDeleteConfirmText}
        onConfirm={executeDeleteTarget}
        error={deleteError}
        busy={!!deletingTargetId}
      >
        {deleteTarget && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">{deleteTarget.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nom</span>
              <span className="font-medium">{deleteTarget.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono">{deleteTarget.id}</span>
            </div>
          </div>
        )}
      </ConfirmActionDialog>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MEASURE_CATEGORIES = [
  { value: "LOAD", label: "Charge (LOAD)" },
  { value: "GRID", label: "Réseau (GRID)" },
  { value: "PV", label: "Solaire (PV)" },
  { value: "BATTERY", label: "Batterie (BATTERY)" },
  { value: "GENSET", label: "Groupe (GENSET)" },
  { value: "UNKNOWN", label: "Inconnu (UNKNOWN)" },
];

const NODE_TYPES = [
  { value: "source", label: "Source (arrivée)" },
  { value: "tableau", label: "Tableau (TGBT)" },
  { value: "depart", label: "Départ" },
  { value: "charge", label: "Charge" },
];

const NODE_TYPE_BADGE: Record<string, string> = {
  source: "bg-blue-100 text-blue-700",
  tableau: "bg-green-100 text-green-700",
  depart: "bg-amber-100 text-amber-700",
  charge: "bg-gray-100 text-gray-700",
};

function terrainLabelFn(t: any) {
  const parts: string[] = [];
  if (t.org_name) parts.push(t.org_name);
  if (t.site_name) parts.push(t.site_name);
  parts.push(t.name);
  return parts.join(" › ");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Device Mapping Dialog component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function DeviceMappingDialog({
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

  // Reset state when device changes
  const deviceKey = device?.device_key;
  useEffect(() => {
    setMapTerrainId(defaultTerrainId || "none");
    setMapPointId("none");
    setShowCreatePoint(false);
    setNewPointName("");
    setNewPointDevice("ADW300");
    setNewPointCategory("LOAD");
  }, [deviceKey, defaultTerrainId]);

  // Load measurement points for the selected terrain
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 2 – Concentrateurs (Gateways) + Device mapping intégré
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function GatewaysTab() {
  const { data: gwData, isLoading: gwLoading } = useGateways();
  const gateways: Array<Record<string, any>> = (gwData as any)?.gateways ?? [];
  const { data: allTerrains = [] } = useAllTerrains();
  const { data: inData } = useIncoming();
  const incomingRows: Array<Record<string, any>> = (inData as any)?.rows ?? [];

  // Discover unregistered gateways from incoming messages
  const registeredIds = new Set(gateways.map((g: any) => g.gateway_id));
  const discoveredGateways = [...new Set(
    incomingRows.map((r: any) => r.gateway_id).filter((id: any) => id && !registeredIds.has(id))
  )] as string[];

  // Build discovered devices per unregistered gateway from incoming_messages
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
  const unmapDeviceMut = useUnmapDevice();
  const deleteGwMut = useDeleteGateway();

  // Selected gateway (can be registered OR discovered)
  const [selectedGw, setSelectedGw] = useState<string | null>(null);
  const isSelectedRegistered = selectedGw ? registeredIds.has(selectedGw) : false;
  const { data: devData } = useGatewayDevices(selectedGw);
  const registeredDevices: Array<Record<string, any>> = (devData as any)?.devices ?? [];

  // For unregistered gateways, use discovered devices from incoming
  const displayDevices = isSelectedRegistered ? registeredDevices : (selectedGw ? discoveredDevicesMap.get(selectedGw) || [] : []);

  // Get selected gateway info
  const selectedGwInfo = gateways.find((g: any) => g.gateway_id === selectedGw);
  const selectedTerrainId: string | null = selectedGwInfo?.terrain_id || null;

  // Mapping gateway dialog
  const [mapDialogGw, setMapDialogGw] = useState<string | null>(null);
  const [mapTerrainId, setMapTerrainId] = useState("none");
  const [showCreateTerrainInline, setShowCreateTerrainInline] = useState(false);
  const [inlineTerrainName, setInlineTerrainName] = useState("");
  const [inlineTerrainSiteId, setInlineTerrainSiteId] = useState("none");
  const { data: allSitesList = [] } = useAllSites();
  const createTerrainMut = useCreateTerrain();

  // Register new gateway dialog
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [newGwId, setNewGwId] = useState("");
  const [registerTerrainId, setRegisterTerrainId] = useState("none");
  const [showCreateTerrainRegister, setShowCreateTerrainRegister] = useState(false);
  const [regTerrainName, setRegTerrainName] = useState("");
  const [regTerrainSiteId, setRegTerrainSiteId] = useState("none");

  // Device mapping dialog
  const [mappingDevice, setMappingDevice] = useState<Record<string, any> | null>(null);
  const [deleteGatewayTarget, setDeleteGatewayTarget] = useState<string | null>(null);
  const [deleteGatewayConfirmText, setDeleteGatewayConfirmText] = useState("");
  const [deleteGatewayError, setDeleteGatewayError] = useState<string | null>(null);

  const requiredDeleteGatewayKeyword = "CONFIRM-DELETE-GATEWAY";

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

  const handleUnmapDevice = async (device: any) => {
    if (!selectedTerrainId || !device?.device_key) return;
    try {
      await unmapDeviceMut.mutateAsync({ deviceKey: device.device_key, terrain_id: selectedTerrainId });
      toast.success(`Appareil ${device.device_key} demappe`);
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors du demapping");
    }
  };

  const handleDeleteGateway = (gatewayId: string) => {
    setDeleteGatewayError(null);
    setDeleteGatewayConfirmText("");
    setDeleteGatewayTarget(gatewayId);
  };

  const executeDeleteGateway = async () => {
    if (!deleteGatewayTarget) return;
    setDeleteGatewayError(null);
    try {
      await deleteGwMut.mutateAsync(deleteGatewayTarget);
      toast.success("Concentrateur supprimé");
      setDeleteGatewayTarget(null);
      setDeleteGatewayConfirmText("");
    } catch (err: any) {
      setDeleteGatewayError(err?.message || "Erreur suppression");
    }
  };

  const unmappedDeviceCount = displayDevices.filter((d: any) => !d.point_id).length;

  return (
    <div className="space-y-4">
      {/* ── Header + Actions ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gérez vos concentrateurs (gateways Milesight), mappez-les à un terrain, puis mappez chaque appareil (Acrel / LoRa) à un point de mesure.
        </p>
        <Button size="sm" onClick={() => setShowRegisterDialog(true)}>
          <Plus className="w-4 h-4 mr-1" /> Enregistrer un concentrateur
        </Button>
      </div>

      {/* ── Discovered but unregistered gateways ── */}
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

      {/* ── Registered gateways + details ── */}
      <div className="grid grid-cols-5 gap-4">
        {/* LEFT: Gateway list (2 cols) */}
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
                      <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 dark:bg-green-200 dark:text-black dark:border-green-300 shrink-0">
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

        {/* RIGHT: Details + Devices (3 cols) */}
        <Card className="col-span-3">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {selectedGw ? (
                <span className="flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  Appareils de <span className="font-mono">{selectedGw}</span>
                  {selectedTerrainId ? (
                    <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-200 dark:text-black dark:border-green-300">
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

            {/* Warning: unregistered gateway selected */}
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

            {/* Warning: registered but not mapped to terrain */}
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

            {/* Devices list */}
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
                            <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-200 dark:text-black dark:border-green-300">
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
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-muted-foreground" title={d.point_id}>{d.point_id.slice(0, 8)}...</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px] text-amber-700 dark:text-amber-300"
                                onClick={() => handleUnmapDevice(d)}
                                disabled={unmapDeviceMut.isPending}
                              >
                                Demapper
                              </Button>
                            </div>
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

      {/* ── Map Gateway Dialog ── */}
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

      {/* ── Register New Gateway Dialog ── */}
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

      <ConfirmActionDialog
        open={!!deleteGatewayTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGatewayTarget(null);
            setDeleteGatewayConfirmText("");
            setDeleteGatewayError(null);
          }
        }}
        title="Supprimer ce concentrateur"
        description={deleteGatewayTarget ? `Le concentrateur « ${deleteGatewayTarget} » sera supprimé du registre. Les données historiques ne seront pas supprimées.` : ""}
        confirmLabel={deleteGwMut.isPending ? "Suppression..." : "Supprimer"}
        cancelLabel="Annuler"
        requiredKeyword={requiredDeleteGatewayKeyword}
        confirmText={deleteGatewayConfirmText}
        onConfirmTextChange={setDeleteGatewayConfirmText}
        onConfirm={executeDeleteGateway}
        busy={deleteGwMut.isPending}
        error={deleteGatewayError}
        destructive
      />

      {/* ── Device Mapping Dialog (shared component) ── */}
      <DeviceMappingDialog
        device={mappingDevice}
        onClose={() => setMappingDevice(null)}
        defaultTerrainId={selectedTerrainId}
        allTerrains={allTerrains as any[]}
      />
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 3 – Appareils (Device Mapping)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function DevicesTab() {
  const { data: gwData } = useGateways();
  const gateways: Array<Record<string, any>> = (gwData as any)?.gateways ?? [];
  const [selectedGw, setSelectedGw] = useState<string | null>(null);
  const { data: devData, isLoading } = useGatewayDevices(selectedGw);
  const devices: Array<Record<string, any>> = (devData as any)?.devices ?? [];

  // Auto-resolve terrain from selected gateway
  const selectedGateway = gateways.find((g: any) => g.gateway_id === selectedGw);
  const gatewayTerrainId: string | null = selectedGateway?.terrain_id || null;
  const gatewayTerrainName: string = selectedGateway?.terrain_name || "";

  const { data: allTerrains = [] } = useAllTerrains();
  const provisionMut = useProvisionGateway();
  const unmapDeviceMut = useUnmapDevice();

  // Mapping dialog state (uses shared DeviceMappingDialog)
  const [mappingDevice, setMappingDevice] = useState<Record<string, any> | null>(null);

  const handleAutoProvision = async () => {
    if (!selectedGw) return;
    try {
      await provisionMut.mutateAsync(selectedGw);
      toast.success("Auto-provisionnement terminé ! Les appareils ont été détectés et mappés automatiquement.");
    } catch (err: any) { toast.error(err?.message || "Erreur lors de l'auto-provisionnement"); }
  };

  const handleUnmap = async (device: any) => {
    if (!selectedGw || !gatewayTerrainId || !device?.device_key) return;
    try {
      await unmapDeviceMut.mutateAsync({ deviceKey: device.device_key, terrain_id: gatewayTerrainId });
      toast.success(`Appareil ${device.device_key} demappe`);
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors du demapping");
    }
  };

  const unmappedCount = devices.filter((d: any) => !d.point_id).length;
  const mappedCount = devices.filter((d: any) => d.point_id).length;

  return (
    <div className="space-y-4">
      {/* ── Gateway selector ── */}
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

      {/* ── No gateway selected ── */}
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

      {/* ── Gateway not mapped warning ── */}
      {selectedGw && !gatewayTerrainId && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-6 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">Ce concentrateur n'est pas encore mappé à un terrain</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">Allez dans l'onglet « Concentrateurs » pour mapper <span className="font-mono">{selectedGw}</span> à un terrain avant de pouvoir mapper ses appareils.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Devices table ── */}
      {selectedGw && gatewayTerrainId && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Appareils de {selectedGw}
              <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-200 dark:text-black dark:border-green-300">
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
                            <Badge className="bg-green-100 text-green-700 text-[10px] border-green-200 dark:bg-green-200 dark:text-black dark:border-green-300">
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
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-muted-foreground" title={d.point_id}>{d.point_id.slice(0, 8)}...</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[11px] text-amber-700 dark:text-amber-300"
                                onClick={() => handleUnmap(d)}
                                disabled={unmapDeviceMut.isPending}
                              >
                                Demapper
                              </Button>
                            </div>
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

      {/* ── Device Mapping Dialog (shared component) ── */}
      <DeviceMappingDialog
        device={mappingDevice}
        onClose={() => setMappingDevice(null)}
        defaultTerrainId={gatewayTerrainId}
        allTerrains={allTerrains as any[]}
      />
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 4 – Messages Entrants (Incoming)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function IncomingTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [includeProcessed, setIncludeProcessed] = useState(true);
  const [deviceKeyFilter, setDeviceKeyFilter] = useState("");
  const actualFilter = statusFilter === "all" ? "" : statusFilter;
  const incomingParams: { status?: string; device_key?: string; include_processed?: boolean } = {};
  if (actualFilter) incomingParams.status = actualFilter;
  if (deviceKeyFilter.trim()) incomingParams.device_key = deviceKeyFilter.trim();
  if (includeProcessed || actualFilter === "processed") incomingParams.include_processed = true;
  const { data: inData, isLoading, refetch } = useIncoming(Object.keys(incomingParams).length ? incomingParams : undefined);
  const rows: Array<Record<string, any>> = (inData as any)?.rows ?? [];

  // Info dialog state
  const [infoMsg, setInfoMsg] = useState<Record<string, any> | null>(null);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // Delete mutations
  const deleteMut = useDeleteIncoming();
  const deleteAllMut = useDeleteAllIncoming();
  const reconcileMut = useReconcileIncoming();

  const requiredPurgeKeyword = "CONFIRM-PURGE-INCOMING";

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
    setPurgeError(null);
    setPurgeConfirmText("");
    setPurgeConfirmOpen(true);
  };

  const executePurgeAll = async () => {
    setPurgeError(null);
    const params = actualFilter ? { status: actualFilter } : undefined;
    try {
      const data = await deleteAllMut.mutateAsync(params);
      const count = (data as any)?.deleted_count ?? 0;
      toast.success(`${count} message(s) supprimé(s)`);
      setPurgeConfirmOpen(false);
      setPurgeConfirmText("");
    } catch (error: any) {
      const msg = error?.message || JSON.stringify(error);
      setPurgeError(`Erreur purge: ${msg}`);
      console.error("Delete all incoming error:", error);
    }
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
                <SelectItem value="processed">Traités (mapped)</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={deviceKeyFilter}
            onChange={(e) => setDeviceKeyFilter(e.target.value)}
            placeholder="Filtrer device_key"
            className="h-8 w-48 text-xs font-mono"
          />
          <div className="flex items-center gap-2 rounded-md border px-2 h-8">
            <Switch checked={includeProcessed} onCheckedChange={setIncludeProcessed} />
            <span className="text-[11px] text-muted-foreground">Inclure traites</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleReconcile} disabled={reconcileMut.isPending} title="Resynchroniser les statuts des messages avec les mappings existants">
            {reconcileMut.isPending ? "Sync…" : "Resync statuts"}
          </Button>
          {rows.length > 0 && statusFilter !== "processed" && (
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
                      {msg.status !== "processed" && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDeleteOne(msg.id)} disabled={deleteMut.isPending}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* ── Message Info Dialog ── */}
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

      <ConfirmActionDialog
        open={purgeConfirmOpen}
        onOpenChange={(open) => {
          setPurgeConfirmOpen(open);
          if (!open) {
            setPurgeConfirmText("");
            setPurgeError(null);
          }
        }}
        title="Purger les messages entrants"
        description={`Cette action supprimera ${statusFilter === "all" ? "TOUS les messages" : `les messages « ${statusFilter} »`} de la liste entrante. Action irréversible.`}
        confirmLabel={deleteAllMut.isPending ? "Purge..." : "Purger"}
        cancelLabel="Annuler"
        requiredKeyword={requiredPurgeKeyword}
        confirmText={purgeConfirmText}
        onConfirmTextChange={setPurgeConfirmText}
        onConfirm={executePurgeAll}
        busy={deleteAllMut.isPending}
        error={purgeError}
        destructive
      />
    </Card>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 5 – Points de mesure (Measurement Points CRUD)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function MeasurementPointsTab() {
  const { data: allTerrains = [] } = useAllTerrains();
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const { data: points = [], isLoading } = usePoints(selectedTerrainId);
  const createPointMut = useCreatePoint();
  const updatePointMut = useUpdatePoint();
  const deletePointMut = useDeletePoint();

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDevice, setNewDevice] = useState("ADW300");
  const [newCategory, setNewCategory] = useState("LOAD");
  const [newModbus, setNewModbus] = useState("");
  const [newDevEui, setNewDevEui] = useState("");
  const [newCtRatio, setNewCtRatio] = useState("1");
  const [newNodeType, setNewNodeType] = useState("charge");
  const [newParentId, setNewParentId] = useState<string>("none");
  const [newIsBilling, setNewIsBilling] = useState(true);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDevice, setEditDevice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editCtRatio, setEditCtRatio] = useState("1");
  const [editNodeType, setEditNodeType] = useState("charge");
  const [editParentId, setEditParentId] = useState<string>("none");
  const [editIsBilling, setEditIsBilling] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requiredDeleteKeyword = "CONFIRM-DELETE-POINT";

  // Points that can be parents (exclude self for edit, exclude children to prevent cycles)
  const parentOptions = (excludeId?: string) =>
    (points as any[]).filter((p: any) => p.id !== excludeId);

  // Build hierarchy tree for display
  const hasHierarchy = (points as any[]).some((p: any) => p.parent_id);
  const buildTree = () => {
    const pts = points as any[];
    const roots = pts.filter(p => !p.parent_id);
    const childrenOf = (pid: string): any[] => pts.filter(p => p.parent_id === pid);
    const renderNode = (p: any, depth: number): string => {
      const indent = depth > 0 ? "  ".repeat(depth) + "\u2514\u2500 " : "";
      const icon = p.measure_category === "GRID" ? "\u26A1" : p.measure_category === "PV" ? "\u2600\uFE0F" : p.measure_category === "GENSET" ? "\u2699\uFE0F" : "\uD83D\uDD0C";
      const billing = p.is_billing ? " \u2190 facturation" : "";
      const label = `${indent}${icon} ${p.name} (${NODE_TYPES.find(n => n.value === p.node_type)?.label ?? p.node_type})${billing}`;
      const children = childrenOf(p.id);
      return [label, ...children.map(c => renderNode(c, depth + 1))].join("\n");
    };
    return roots.map(r => renderNode(r, 0)).join("\n");
  };

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
        node_type: newNodeType as any,
        parent_id: newParentId === "none" ? null : newParentId,
        is_billing: newIsBilling,
      });
      toast.success("Point de mesure créé");
      setShowCreate(false);
      setNewName(""); setNewDevice("ADW300"); setNewCategory("LOAD"); setNewModbus(""); setNewDevEui(""); setNewCtRatio("1");
      setNewNodeType("charge"); setNewParentId("none"); setNewIsBilling(true);
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
        node_type: editNodeType as any,
        parent_id: editParentId === "none" ? null : editParentId,
        is_billing: editIsBilling,
      });
      toast.success("Point mis à jour");
      setEditingId(null);
    } catch { toast.error("Erreur mise à jour"); }
  };

  // Quick toggle is_billing without entering full edit mode
  const handleToggleBilling = async (p: any) => {
    try {
      await updatePointMut.mutateAsync({
        pointId: p.id,
        name: p.name,
        is_billing: !p.is_billing,
      });
    } catch { toast.error("Erreur toggle facturation"); }
  };

  const handleDelete = (pointId: string, name: string) => {
    setDeleteError(null);
    setDeleteConfirmText("");
    setDeleteTarget({ id: pointId, name });
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deletePointMut.mutateAsync(deleteTarget.id);
      toast.success("Point supprimé");
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch {
      setDeleteError("Erreur suppression");
    }
  };

  const getParentName = (parentId: string | null) => {
    if (!parentId) return "—";
    const parent = (points as any[]).find((p: any) => p.id === parentId);
    return parent ? parent.name : "—";
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

      {/* Hierarchy tree view (shown only when parent-child relationships exist) */}
      {selectedTerrainId && hasHierarchy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Layers className="w-4 h-4" /> Hiérarchie du terrain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-muted-foreground whitespace-pre font-mono leading-relaxed">{buildTree()}</pre>
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
            {/* Create form */}
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
                    <Label className="text-xs">Catégorie énergie</Label>
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
                    <Label className="text-xs">Rôle dans le réseau</Label>
                    <Select value={newNodeType} onValueChange={setNewNodeType}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NODE_TYPES.map((n) => (
                          <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Point parent <span className="text-muted-foreground">(hiérarchie)</span></Label>
                    <Select value={newParentId} onValueChange={setNewParentId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">(Aucun — point racine)</SelectItem>
                        {parentOptions().map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} ({p.measure_category})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 flex items-end gap-2 pb-1">
                    <div className="flex items-center gap-2">
                      <Switch checked={newIsBilling} onCheckedChange={setNewIsBilling} className="scale-75" />
                      <Label className="text-xs">Point de facturation</Label>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Adresse Modbus <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input className="h-8 text-xs" value={newModbus} onChange={(e) => setNewModbus(e.target.value)} placeholder="Ex: 1" type="number" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ratio TC <span className="text-muted-foreground">(CT ratio)</span></Label>
                    <Input className="h-8 text-xs" value={newCtRatio} onChange={(e) => setNewCtRatio(e.target.value)} placeholder="1" type="number" min="1" step="1" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">DevEUI LoRa <span className="text-muted-foreground">(optionnel)</span></Label>
                    <Input className="h-8 text-xs font-mono" value={newDevEui} onChange={(e) => setNewDevEui(e.target.value)} placeholder="Ex: 24E124710D470399" />
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
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Nom</th>
                      <th className="py-2 px-3 font-medium">Appareil</th>
                      <th className="py-2 px-3 font-medium">Catégorie</th>
                      <th className="py-2 px-3 font-medium">Rôle</th>
                      <th className="py-2 px-3 font-medium">Parent</th>
                      <th className="py-2 px-3 font-medium text-center" title="Point de facturation">Fact.</th>
                      <th className="py-2 px-3 font-medium">TC</th>
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
                            <td className="py-2 px-3">
                              <Select value={editNodeType} onValueChange={setEditNodeType}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {NODE_TYPES.map((n) => (
                                    <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="py-2 px-3">
                              <Select value={editParentId} onValueChange={setEditParentId}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">(Aucun)</SelectItem>
                                  {parentOptions(p.id).map((pp: any) => (
                                    <SelectItem key={pp.id} value={pp.id}>{pp.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <Switch checked={editIsBilling} onCheckedChange={setEditIsBilling} className="scale-75" />
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
                            <td className="py-2 px-3 font-medium">{p.parent_id ? <span className="text-muted-foreground mr-1">\u2514</span> : null}{p.name}</td>
                            <td className="py-2 px-3">{p.device}</td>
                            <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{p.measure_category}</Badge></td>
                            <td className="py-2 px-3"><Badge className={`text-[10px] ${NODE_TYPE_BADGE[p.node_type] ?? NODE_TYPE_BADGE.charge}`}>{NODE_TYPES.find(n => n.value === p.node_type)?.label ?? p.node_type}</Badge></td>
                            <td className="py-2 px-3 text-muted-foreground">{getParentName(p.parent_id)}</td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() => handleToggleBilling(p)}
                                className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${p.is_billing ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                                title={p.is_billing ? "Point de facturation (cliquer pour désactiver)" : "Non utilisé pour la facturation (cliquer pour activer)"}
                              >
                                {p.is_billing ? <Check className="w-3 h-3" /> : null}
                              </button>
                            </td>
                            <td className="py-2 px-3 font-mono">{p.ct_ratio ?? 1}</td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.modbus_addr ?? "—"}</td>
                            <td className="py-2 px-3 font-mono text-muted-foreground">{p.lora_dev_eui ? (p.lora_dev_eui as string).slice(-8) : "—"}</td>
                            <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{p.status}</Badge></td>
                            <td className="py-2 px-3">
                              <div className="flex gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(p.id); setEditName(p.name); setEditDevice(p.device); setEditCategory(p.measure_category); setEditCtRatio(String(p.ct_ratio ?? 1)); setEditNodeType(p.node_type ?? "charge"); setEditParentId(p.parent_id ?? "none"); setEditIsBilling(p.is_billing ?? true); }}>
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

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
            setDeleteError(null);
          }
        }}
        title="Supprimer ce point de mesure"
        description={deleteTarget ? `Le point « ${deleteTarget.name} » sera supprimé, ainsi que le mapping appareil associé.` : ""}
        confirmLabel={deletePointMut.isPending ? "Suppression..." : "Supprimer"}
        cancelLabel="Annuler"
        requiredKeyword={requiredDeleteKeyword}
        confirmText={deleteConfirmText}
        onConfirmTextChange={setDeleteConfirmText}
        onConfirm={executeDelete}
        busy={deletePointMut.isPending}
        error={deleteError}
        destructive
      />
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 6 – Utilisateurs (Users CRUD)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const roleLabels: Record<string, string> = {
  platform_super_admin: "Super Admin",
  org_admin: "Admin Org",
  operator: "Opérateur",
  manager: "Manager",
};

function UsersTab() {
  const { data: users = [], isLoading } = useUsers();
  const { data: orgs = [] } = useOrgs();
  const createUserMut = useCreateUser();
  const updateUserMut = useUpdateUser();
  const deleteUserMut = useDeleteUser();

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("operator");
  const [newOrgId, setNewOrgId] = useState("none");

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editOrgId, setEditOrgId] = useState("none");
  const [editActive, setEditActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requiredDeleteKeyword = "CONFIRM-DELETE-USER";

  const handleCreate = async () => {
    if (!newEmail.trim() || !newName.trim() || !newPassword.trim()) return;
    try {
      await createUserMut.mutateAsync({
        email: newEmail.trim(),
        password: newPassword,
        name: newName.trim(),
        role: newRole,
        organization_id: newOrgId === "none" ? null : newOrgId,
      });
      toast.success("Utilisateur créé");
      setShowCreate(false); setNewEmail(""); setNewName(""); setNewPassword(""); setNewRole("operator"); setNewOrgId("none");
    } catch { toast.error("Erreur création utilisateur"); }
  };

  const handleUpdate = async (userId: string) => {
    try {
      await updateUserMut.mutateAsync({
        userId,
        name: editName,
        email: editEmail,
        role: editRole,
        organization_id: editOrgId === "none" ? null : editOrgId,
        active: editActive,
      });
      toast.success("Utilisateur mis à jour");
      setEditingId(null);
    } catch { toast.error("Erreur mise à jour"); }
  };

  const handleDelete = (userId: string, userName: string) => {
    setDeleteError(null);
    setDeleteConfirmText("");
    setDeleteTarget({ id: userId, name: userName });
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteUserMut.mutateAsync(deleteTarget.id);
      toast.success("Utilisateur supprimé");
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch {
      setDeleteError("Erreur suppression");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium flex items-center gap-1"><Users className="w-4 h-4" /> Utilisateurs</CardTitle>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" />Ajouter</Button>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}

        {/* Create form */}
        {showCreate && (
          <div className="mb-4 p-3 rounded border bg-muted/30 space-y-2">
            <p className="text-sm font-medium">Nouvel utilisateur</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Nom</Label>
                <Input className="h-8 text-xs" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jean Dupont" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input className="h-8 text-xs" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="jean@simes.bf" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mot de passe</Label>
                <Input className="h-8 text-xs" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rôle</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="platform_super_admin">Super Admin</SelectItem>
                    <SelectItem value="org_admin">Admin Org</SelectItem>
                    <SelectItem value="operator">Opérateur</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Organisation</Label>
                <Select value={newOrgId} onValueChange={setNewOrgId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Aucune" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune</SelectItem>
                    {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
              <Button size="sm" onClick={handleCreate} disabled={!newEmail.trim() || !newName.trim() || !newPassword.trim()}>Créer</Button>
            </div>
          </div>
        )}

        {/* Users table */}
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground border-b"><th className="py-1 pr-2">Nom</th><th className="py-1 pr-2">Email</th><th className="py-1 pr-2">Rôle</th><th className="py-1 pr-2">Organisation</th><th className="py-1 pr-2">Actif</th><th className="py-1">Actions</th></tr></thead>
          <tbody>
            {(users as any[]).map((u: any) => (
              <tr key={u.id} className="border-b border-muted/30 hover:bg-muted/30">
                {editingId === u.id ? (
                  <>
                    <td className="py-1 pr-2"><Input className="h-7 text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                    <td className="py-1 pr-2"><Input className="h-7 text-xs" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></td>
                    <td className="py-1 pr-2">
                      <Select value={editRole} onValueChange={setEditRole}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="platform_super_admin">Super Admin</SelectItem>
                          <SelectItem value="org_admin">Admin Org</SelectItem>
                          <SelectItem value="operator">Opérateur</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={editOrgId} onValueChange={setEditOrgId}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Aucune</SelectItem>
                          {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1 pr-2"><Switch checked={editActive} onCheckedChange={setEditActive} /></td>
                    <td className="py-1 flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleUpdate(u.id)}>OK</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>✕</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1 pr-2">{u.name}</td>
                    <td className="py-1 pr-2 font-mono">{u.email}</td>
                    <td className="py-1 pr-2"><Badge variant="outline" className="text-[10px]">{roleLabels[u.role] ?? u.role}</Badge></td>
                    <td className="py-1 pr-2">{orgs.find((o) => o.id === u.orgId)?.name ?? "—"}</td>
                    <td className="py-1 pr-2">{u.active ? <Badge className="text-[10px] bg-green-100 text-green-800">Oui</Badge> : <Badge variant="destructive" className="text-[10px]">Non</Badge>}</td>
                    <td className="py-1 flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(u.id); setEditName(u.name); setEditEmail(u.email); setEditRole(u.role); setEditOrgId(u.orgId ?? "none"); setEditActive(u.active); }}><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(u.id, u.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && (users as any[]).length === 0 && <p className="text-xs text-muted-foreground italic mt-2">Aucun utilisateur</p>}
      </CardContent>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
            setDeleteError(null);
          }
        }}
        title="Supprimer cet utilisateur"
        description={deleteTarget ? `L'utilisateur « ${deleteTarget.name} » sera supprimé de la plateforme.` : ""}
        confirmLabel={deleteUserMut.isPending ? "Suppression..." : "Supprimer"}
        cancelLabel="Annuler"
        requiredKeyword={requiredDeleteKeyword}
        confirmText={deleteConfirmText}
        onConfirmTextChange={setDeleteConfirmText}
        onConfirm={executeDelete}
        busy={deleteUserMut.isPending}
        error={deleteError}
        destructive
      />
    </Card>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 7 – Zones (Zone CRUD per terrain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ZonesTab() {
  const { data: allTerrains = [] } = useAllTerrains();
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const { data: zones = [], isLoading } = useZones(selectedTerrainId);
  const createZoneMut = useCreateZone();
  const updateZoneMut = useUpdateZone();
  const deleteZoneMut = useDeleteZone();

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requiredDeleteKeyword = "CONFIRM-DELETE-ZONE";

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
    setDeleteError(null);
    setDeleteConfirmText("");
    setDeleteTarget({ id: zoneId, name });
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteZoneMut.mutateAsync(deleteTarget.id);
      toast.success("Zone supprimée");
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch {
      setDeleteError("Erreur suppression");
    }
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
            {/* Create form */}
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

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText("");
            setDeleteError(null);
          }
        }}
        title="Supprimer cette zone"
        description={deleteTarget ? `La zone « ${deleteTarget.name} » sera supprimée et les points associés seront détachés.` : ""}
        confirmLabel={deleteZoneMut.isPending ? "Suppression..." : "Supprimer"}
        cancelLabel="Annuler"
        requiredKeyword={requiredDeleteKeyword}
        confirmText={deleteConfirmText}
        onConfirmTextChange={setDeleteConfirmText}
        onConfirm={executeDelete}
        busy={deleteZoneMut.isPending}
        error={deleteError}
        destructive
      />
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Administration Page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Administration() {
  const { data: gwData } = useGateways();
  const gateways: Array<Record<string, any>> = (gwData as any)?.gateways ?? [];
  const { data: incomingData } = useIncoming();
  const incomingRows: Array<Record<string, any>> = (incomingData as any)?.rows ?? [];
  const { data: users = [] } = useUsers();

  const [flowView, setFlowView] = useState<"hub" | "setup" | "operations" | "maintenance" | "access">("hub");
  const [setupStep, setSetupStep] = useState(1);
  const [opsTab, setOpsTab] = useState<"topology" | "mapping" | "messages">("topology");
  const [maintenanceTab, setMaintenanceTab] = useState<"points" | "zones" | "pv-systems">("points");

  const mappedGateways = gateways.filter((g: any) => !!g.terrain_id).length;
  const unmappedGateways = Math.max(0, gateways.length - mappedGateways);
  const unmappedIncoming = incomingRows.filter((r: any) => r.status === "unmapped").length;
  const uniqueUnmappedDevices = new Set(
    incomingRows
      .filter((r: any) => r.status === "unmapped" && r.device_key && r.device_key !== "unknown")
      .map((r: any) => r.device_key)
  ).size;

  const setupSteps = [
    { id: 1, label: "Structure", help: "Créer organisations, sites et terrains." },
    { id: 2, label: "Concentrateurs", help: "Enregistrer et mapper les gateways." },
    { id: 3, label: "Appareils", help: "Associer les devices aux points de mesure." },
    { id: 4, label: "Messages", help: "Contrôler les flux entrants et corriger." },
    { id: 5, label: "Publication", help: "Valider l'etat et passer en exploitation." },
  ] as const;

  const renderSetupStep = () => {
    if (setupStep === 1) return <TabErrorBoundary name="Referentiel"><ReferentialTab /></TabErrorBoundary>;
    if (setupStep === 2) return <TabErrorBoundary name="Concentrateurs"><GatewaysTab /></TabErrorBoundary>;
    if (setupStep === 3) return <TabErrorBoundary name="Appareils"><DevicesTab /></TabErrorBoundary>;
    if (setupStep === 4) return <TabErrorBoundary name="Messages"><IncomingTab /></TabErrorBoundary>;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Pret pour exploitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">Concentrateurs mappes</p>
              <p className="text-xl font-semibold">{mappedGateways}/{gateways.length}</p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">Devices non mappes detectes</p>
              <p className="text-xl font-semibold">{uniqueUnmappedDevices}</p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">Messages entrants non mappes</p>
              <p className="text-xl font-semibold">{unmappedIncoming}</p>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">Utilisateurs actifs</p>
              <p className="text-xl font-semibold">{users.length}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => { setFlowView("operations"); setOpsTab("mapping"); }}>
              Passer en exploitation
            </Button>
            <Button variant="outline" onClick={() => { setFlowView("maintenance"); setMaintenanceTab("points"); }}>
              Ouvrir maintenance
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Configuration plateforme</h1>
          <p className="text-sm text-muted-foreground">
            Flux guide pour parametrage initial, exploitation quotidienne et maintenance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={flowView === "hub" ? "default" : "outline"} size="sm" onClick={() => setFlowView("hub")}>Accueil</Button>
          <Button variant={flowView === "setup" ? "default" : "outline"} size="sm" onClick={() => setFlowView("setup")}>Setup guide</Button>
          <Button variant={flowView === "operations" ? "default" : "outline"} size="sm" onClick={() => setFlowView("operations")}>Exploitation</Button>
          <Button variant={flowView === "maintenance" ? "default" : "outline"} size="sm" onClick={() => setFlowView("maintenance")}>Maintenance</Button>
          <Button variant={flowView === "access" ? "default" : "outline"} size="sm" onClick={() => setFlowView("access")}>Acces</Button>
        </div>
      </div>

      {flowView === "hub" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Topologie</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{mappedGateways}/{gateways.length}</p>
                <p className="text-xs text-muted-foreground">concentrateurs mappes</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Gateways a traiter</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{unmappedGateways}</p>
                <p className="text-xs text-muted-foreground">non mappes</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Devices en attente</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{uniqueUnmappedDevices}</p>
                <p className="text-xs text-muted-foreground">a mapper</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Flux entrants</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{unmappedIncoming}</p>
                <p className="text-xs text-muted-foreground">messages non mappes</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions recommandees</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => { setFlowView("setup"); setSetupStep(1); }}>Continuer le setup</Button>
              <Button variant="outline" onClick={() => { setFlowView("operations"); setOpsTab("mapping"); }}>Mapper les appareils</Button>
              <Button variant="outline" onClick={() => { setFlowView("operations"); setOpsTab("messages"); }}>Traiter les messages</Button>
              <Button variant="outline" onClick={() => { setFlowView("maintenance"); setMaintenanceTab("points"); }}>Maintenance donnees</Button>
              <Button variant="outline" onClick={() => setFlowView("access")}>Gerer les acces</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {flowView === "setup" && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <Card className="xl:col-span-1 h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Etapes de setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {setupSteps.map((step) => (
                <button
                  key={step.id}
                  className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${setupStep === step.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                  onClick={() => setSetupStep(step.id)}
                >
                  <p className="text-xs text-muted-foreground">Etape {step.id}</p>
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.help}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="xl:col-span-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Etape {setupStep}: {setupSteps[setupStep - 1].label}</h2>
                <p className="text-xs text-muted-foreground">{setupSteps[setupStep - 1].help}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setupStep === 1}
                  onClick={() => setSetupStep((s) => Math.max(1, s - 1))}
                >
                  Precedent
                </Button>
                <Button
                  size="sm"
                  disabled={setupStep === 5}
                  onClick={() => setSetupStep((s) => Math.min(5, s + 1))}
                >
                  Suivant
                </Button>
              </div>
            </div>
            {renderSetupStep()}
          </div>
        </div>
      )}

      {flowView === "operations" && (
        <Tabs value={opsTab} onValueChange={(v) => setOpsTab(v as typeof opsTab)}>
          <TabsList>
            <TabsTrigger value="topology">Topologie</TabsTrigger>
            <TabsTrigger value="mapping">Mapping Center</TabsTrigger>
            <TabsTrigger value="messages">Message Center</TabsTrigger>
          </TabsList>
          <TabsContent value="topology"><TabErrorBoundary name="Topologie"><ReferentialTab /></TabErrorBoundary></TabsContent>
          <TabsContent value="mapping"><TabErrorBoundary name="Mapping"><GatewaysTab /></TabErrorBoundary></TabsContent>
          <TabsContent value="messages"><TabErrorBoundary name="Messages"><IncomingTab /></TabErrorBoundary></TabsContent>
        </Tabs>
      )}

      {flowView === "maintenance" && (
        <Tabs value={maintenanceTab} onValueChange={(v) => setMaintenanceTab(v as typeof maintenanceTab)}>
          <TabsList>
            <TabsTrigger value="points">Points de mesure</TabsTrigger>
            <TabsTrigger value="zones">Zones</TabsTrigger>
            <TabsTrigger value="pv-systems">Systèmes PV</TabsTrigger>
          </TabsList>
          <TabsContent value="points"><TabErrorBoundary name="Points de mesure"><MeasurementPointsTab /></TabErrorBoundary></TabsContent>
          <TabsContent value="zones"><TabErrorBoundary name="Zones"><ZonesTab /></TabErrorBoundary></TabsContent>
          <TabsContent value="pv-systems"><TabErrorBoundary name="Systèmes PV"><PvSystemsTab /></TabErrorBoundary></TabsContent>
        </Tabs>
      )}

      {flowView === "access" && (
        <TabErrorBoundary name="Utilisateurs">
          <UsersTab />
        </TabErrorBoundary>
      )}
    </div>
  );
}
