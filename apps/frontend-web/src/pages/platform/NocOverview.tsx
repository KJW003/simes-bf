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
  Wifi,
  Loader2,
} from 'lucide-react';
import { useOrgs, useAllSites, useAllTerrains, useGateways, useRuns } from '@/hooks/useApi';

export default function NocOverview() {
  const { data: orgs } = useOrgs();
  const { data: allSites } = useAllSites();
  const { data: allTerrains } = useAllTerrains();
  const { data: gwData } = useGateways();
  const { data: runsData } = useRuns();

  const totalOrgs = orgs?.length ?? 0;
  const totalTerrains = allTerrains?.length ?? 0;
  const gateways = (gwData?.gateways ?? []) as Array<Record<string, unknown>>;
  const runs = (runsData?.runs ?? runsData ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue NOC"
        description="Supervision globale de toutes les organisations SIMES-BF"
        actions={
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Rafraîchir
          </Button>
        }
      />

      {/* Global KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-stagger-children">
        <KpiCard label="Organisations" value={totalOrgs} icon={<Building2 className="w-4 h-4" />} />
        <KpiCard label="Terrains" value={totalTerrains} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Sites" value={allSites?.length ?? 0} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Concentrateurs" value={gateways.length} icon={<Wifi className="w-4 h-4" />} />
        <KpiCard label="Jobs récents" value={runs.length} icon={<Clock className="w-4 h-4" />} />
        <KpiCard label="Jobs échoués" value={runs.filter(r => r.status === 'failed').length} icon={<AlertOctagon className="w-4 h-4" />}
          variant={runs.some(r => r.status === 'failed') ? 'warning' : 'success'} />
      </div>

      {/* Gateways + Recent runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-base font-medium">Concentrateurs ({gateways.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {gateways.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Aucun concentrateur enregistré</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th>Nom / EUI</th>
                    <th>Modèle</th>
                    <th>Terrain</th>
                  </tr>
                </thead>
                <tbody>
                  {gateways.slice(0, 10).map((gw, i) => (
                    <tr key={i}>
                      <td>
                        <div className="font-medium text-sm">{String(gw.name ?? gw.gateway_eui ?? '—')}</div>
                        <div className="text-xs text-muted-foreground font-mono">{String(gw.gateway_eui ?? '').slice(0, 16)}</div>
                      </td>
                      <td className="text-xs">{String(gw.model ?? '—')}</td>
                      <td className="text-xs text-muted-foreground">{String(gw.terrain_id ?? '').slice(0, 8) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-base font-medium">Derniers jobs ({runs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {runs.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Aucun job exécuté</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th>Type</th>
                    <th>Statut</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 10).map((run, i) => (
                    <tr key={i}>
                      <td className="font-medium text-sm">{String(run.job_type ?? run.type ?? '—')}</td>
                      <td>
                        <Badge variant="outline" className={
                          run.status === 'completed' ? 'badge-ok text-[10px]' :
                          run.status === 'failed' ? 'badge-critical text-[10px]' :
                          'text-[10px]'
                        }>
                          {String(run.status ?? '—')}
                        </Badge>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {run.created_at ? new Date(String(run.created_at)).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                <th>Créé le</th>
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