import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Radio,
  Activity,
  AlertOctagon,
  Clock,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { useOrgs, useAllSites, useAllTerrains } from '@/hooks/useApi';

export default function NocOverview() {
  const { data: orgs } = useOrgs();
  const { data: allSites } = useAllSites();
  const { data: allTerrains } = useAllTerrains();

  const totalOrgs = orgs?.length ?? 0;
  const totalTerrains = allTerrains?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue NOC"
        description="Supervision globale de toutes les organisations SIMES-BF"
        actions={
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Rafraichir
          </Button>
        }
      />

      {/* Global KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-stagger-children">
        <KpiCard label="Organisations" value={totalOrgs} icon={<Building2 className="w-4 h-4" />} />
        <KpiCard label="Terrains" value={totalTerrains} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Sites" value={allSites?.length ?? 0} icon={<Activity className="w-4 h-4" />} />
      </div>

      {/* Pipeline Health + Incidents placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-base font-medium">Sante Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
            <Activity className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Necessite un endpoint /health/pipeline</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-base font-medium">Incidents recents</CardTitle>
          </CardHeader>
          <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
            <AlertOctagon className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Necessite une table incidents</p>
          </CardContent>
        </Card>
      </div>

      {/* Organizations Summary (real API data) */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-base font-medium">Organisations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="data-table">
            <thead>
              <tr className="bg-muted/50">
                <th>Organisation</th>
                <th className="text-center">Sites</th>
                <th className="text-center">Terrains</th>
                <th>Cree le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(orgs ?? []).map(org => {
                const orgSites = (allSites ?? []).filter(s => s.organization_id === org.id);
                const orgTerrains = (allTerrains ?? []).filter(t =>
                  orgSites.some(s => s.id === t.site_id)
                );
                return (
                  <tr key={org.id} className="cursor-pointer">
                    <td>
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{org.id.slice(0, 8)}</div>
                    </td>
                    <td className="text-center">{orgSites.length}</td>
                    <td className="text-center">{orgTerrains.length}</td>
                    <td className="text-xs text-muted-foreground">{new Date(org.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <Button variant="ghost" size="sm">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </td>
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