// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Utilisateurs (Users CRUD)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import {
  useOrgs, useUsers, useCreateUser, useUpdateUser, useDeleteUser,
} from "@/hooks/useApi";
import { roleLabels } from "./admin-shared";

export default function UsersTab() {
  const { data: users = [], isLoading } = useUsers();
  const { data: orgs = [] } = useOrgs();
  const createUserMut = useCreateUser();
  const updateUserMut = useUpdateUser();
  const deleteUserMut = useDeleteUser();

  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("operator");
  const [newOrgId, setNewOrgId] = useState("none");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editOrgId, setEditOrgId] = useState("none");
  const [editActive, setEditActive] = useState(true);

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
    if (!confirm(`Supprimer l'utilisateur « ${userName} » ?`)) return;
    deleteUserMut.mutate(userId, {
      onSuccess: () => toast.success("Utilisateur supprimé"),
      onError: () => toast.error("Erreur suppression"),
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium flex items-center gap-1"><Users className="w-4 h-4" /> Utilisateurs</CardTitle>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" />Ajouter</Button>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}

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
    </Card>
  );
}
