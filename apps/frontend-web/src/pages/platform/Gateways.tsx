import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useGateways, useAllTerrains, useAllSites, useOrgs } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { Radio, Wifi, WifiOff, ChevronRight, Search, Activity, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function Gateways() {
  const [search, setSearch] = useState('');
  const { data: gwData, isLoading } = useGateways();
  const { data: allTerrains } = useAllTerrains();
  const { data: allSites } = useAllSites();
  const { data: orgs } = useOrgs();

  const gateways = (gwData?.gateways ?? []) as Array<Record<string, unknown>>;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return gateways;
    return gateways.filter(
      (gw) =>
        String(gw.gateway_id ?? '').toLowerCase().includes(q) ||
        String(gw.terrain_name ?? '').toLowerCase().includes(q),
    );
  }, [search, gateways]);

  const mapped = gateways.filter(gw => !!gw.terrain_id).length;
  const unmapped = gateways.length - mapped;

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Concentrateurs (Milesight)" description="Supervision de tous les concentrateurs Milesight" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Total" value={gateways.length} icon={<Radio className="w-4 h-4" />} />
        <KpiCard label="Mappés" value={mapped} icon={<Wifi className="w-4 h-4" />} variant="success" />
        <KpiCard label="Non mappés" value={unmapped} icon={<WifiOff className="w-4 h-4" />} variant={unmapped > 0 ? 'warning' : 'default'} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un concentrateur..."
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
                <th>Gateway ID</th>
                <th>Terrain</th>
                <th>Site / Organisation</th>
                <th>Appareils</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(gw => {
                const gwId = String(gw.gateway_id ?? '');
                const isMapped = !!gw.terrain_id;
                return (
                  <tr key={gwId} className={cn(!isMapped && 'bg-amber-50/30 dark:bg-amber-950/10')}>
                    <td className="mono text-xs font-medium">{gwId}</td>
                    <td className="font-medium text-sm">{gw.terrain_name ? String(gw.terrain_name) : '—'}</td>
                    <td className="text-sm text-muted-foreground">{gw.site_name ? `${String(gw.site_name)} / ${String(gw.org_name ?? '')}` : '—'}</td>
                    <td className="text-sm">{gw.device_count != null ? String(gw.device_count) : '0'}</td>
                    <td>
                      <Badge variant="outline" className={cn('text-[10px]', isMapped ? 'badge-ok' : 'badge-warning')}>
                        {isMapped ? 'Mappé' : 'Non mappé'}
                      </Badge>
                    </td>
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
