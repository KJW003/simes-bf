import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgs, useAllSites, useAllTerrains } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { Building2, ChevronRight, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function Tenants() {
  const [search, setSearch] = useState('');
  const { data: orgs, isLoading: loadingOrgs } = useOrgs();
  const { data: allSites } = useAllSites();
  const { data: allTerrains } = useAllTerrains();

  const filtered = useMemo(() => {
    if (!orgs) return [];
    const q = search.toLowerCase().trim();
    if (!q) return orgs;
    return orgs.filter(
      (o) => o.name.toLowerCase().includes(q),
    );
  }, [search, orgs]);

  if (loadingOrgs) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /><p className="text-sm text-muted-foreground mt-2">Chargement…</p></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Tenants (Organisations)" description="Gestion de toutes les organisations sur la plateforme" />

      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher une organisation..."
          className="pl-8 h-8 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="data-table">
            <thead>
              <tr className="bg-muted/50">
                <th>Organisation</th>
                <th className="text-center">Sites</th>
                <th className="text-center">Terrains</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(org => {
                const orgSites = (allSites ?? []).filter(s => s.organization_id === org.id);
                const orgTerrains = (allTerrains ?? []).filter(t => (t as any).org_id === org.id || orgSites.some(s => s.id === t.site_id));
                return (
                  <tr key={org.id} className="cursor-pointer">
                    <td>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{org.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{org.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center">{orgSites.length}</td>
                    <td className="text-center">{orgTerrains.length}</td>
                    <td className="text-sm text-muted-foreground">{new Date(org.created_at).toLocaleDateString('fr-FR')}</td>
                    <td><Button variant="ghost" size="sm"><ChevronRight className="w-4 h-4" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
