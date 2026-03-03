import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAllSites, useAllTerrains, useOrgs } from '@/hooks/useApi';
import { MapPin, Radio, ChevronRight, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function Sites() {
  const [search, setSearch] = useState('');
  const { data: allSites, isLoading } = useAllSites();
  const { data: allTerrains } = useAllTerrains();
  const { data: orgs } = useOrgs();

  const filtered = useMemo(() => {
    if (!allSites) return [];
    const q = search.toLowerCase().trim();
    if (!q) return allSites;
    return allSites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.location && s.location.toLowerCase().includes(q)),
    );
  }, [search, allSites]);

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Sites & Terrains" description="Vue globale de tous les sites et terrains" />

      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un site ou terrain..."
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
                <th>Site</th>
                <th>Organisation</th>
                <th>Lieu</th>
                <th className="text-center">Terrains</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(site => {
                const orgName = (site as any).org_name ?? orgs?.find(o => o.id === site.organization_id)?.name ?? '—';
                const terrains = (allTerrains ?? []).filter(t => t.site_id === site.id);
                return (
                  <React.Fragment key={site.id}>
                    <tr className="cursor-pointer">
                      <td className="font-medium flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" />{site.name}</td>
                      <td className="text-sm text-muted-foreground">{orgName}</td>
                      <td className="text-sm text-muted-foreground">{site.location ?? '—'}</td>
                      <td className="text-center">{terrains.length}</td>
                      <td className="text-xs text-muted-foreground">{new Date(site.created_at).toLocaleDateString('fr-FR')}</td>
                      <td><Button variant="ghost" size="sm"><ChevronRight className="w-4 h-4" /></Button></td>
                    </tr>
                    {terrains.map(terrain => (
                      <tr key={terrain.id} className="bg-muted/20">
                        <td className="pl-10 flex items-center gap-2"><Radio className="w-3.5 h-3.5 text-muted-foreground" />{terrain.name}</td>
                        <td className="mono text-xs">{terrain.gateway_id ?? '—'}</td>
                        <td className="text-xs text-muted-foreground">{(terrain as any).site_name ?? '—'}</td>
                        <td></td>
                        <td className="text-xs text-muted-foreground">{new Date(terrain.created_at).toLocaleDateString('fr-FR')}</td>
                        <td></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
