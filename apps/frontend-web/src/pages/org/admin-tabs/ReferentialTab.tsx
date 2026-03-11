// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Référentiel (Orgs / Sites / Terrains)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ChevronRight, Building2, MapPin, Layers } from "lucide-react";
import {
  useOrgs, useSites, useTerrains,
  useCreateOrg, useUpdateOrg, useDeleteOrg,
  useCreateSite, useUpdateSite, useDeleteSite,
  useCreateTerrain, useUpdateTerrain, useDeleteTerrain,
} from "@/hooks/useApi";

export default function ReferentialTab() {
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const { data: sites = [] } = useSites(selectedOrgId);
  const { data: terrains = [] } = useTerrains(selectedSiteId);

  const createOrg = useCreateOrg();
  const updateOrg = useUpdateOrg();
  const deleteOrg = useDeleteOrg();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const createTerrain = useCreateTerrain();
  const updateTerrain = useUpdateTerrain();
  const deleteTerrain = useDeleteTerrain();

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [showCreateSite, setShowCreateSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLocation, setNewSiteLocation] = useState("");
  const [showCreateTerrain, setShowCreateTerrain] = useState(false);
  const [newTerrainName, setNewTerrainName] = useState("");

  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState("");
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editSiteName, setEditSiteName] = useState("");
  const [editingTerrainId, setEditingTerrainId] = useState<string | null>(null);
  const [editTerrainName, setEditTerrainName] = useState("");

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
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm(`Supprimer "${o.name}" ?`)) deleteOrg.mutateAsync(o.id).then(() => toast.success("Supprimée")); }}><Trash2 className="w-3 h-3" /></Button>
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
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm(`Supprimer "${s.name}" ?`)) deleteSite.mutateAsync(s.id).then(() => toast.success("Supprimé")); }}><Trash2 className="w-3 h-3" /></Button>
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
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => { if (confirm(`Supprimer "${t.name}" ?`)) deleteTerrain.mutateAsync(t.id).then(() => toast.success("Supprimé")); }}><Trash2 className="w-3 h-3" /></Button>
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
    </div>
  );
}
