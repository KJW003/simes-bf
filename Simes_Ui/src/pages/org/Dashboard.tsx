import React from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { WidgetBoard } from '@/components/widgets/WidgetBoard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, Activity, BatteryCharging, Clock } from 'lucide-react';
import { useDashboard } from '@/hooks/useApi';

function LiveKPIs({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useDashboard(terrainId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Chargement des données temps réel…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) return null; // Silently fall back — WidgetBoard has mock data

  const timeAgo = data.last_update
    ? `${Math.floor((Date.now() - new Date(data.last_update).getTime()) / 60000)} min`
    : '–';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Zap className="w-4 h-4 text-primary" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Puissance instantanée</div>
            <div className="text-lg font-semibold mono">{data.power_now_kw.toFixed(1)} <span className="text-xs font-normal">kW</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-import/10 p-2"><Activity className="w-4 h-4 text-energy-import" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Énergie import (aujourd'hui)</div>
            <div className="text-lg font-semibold mono">{data.energy_today.import_kwh.toFixed(1)} <span className="text-xs font-normal">kWh</span></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-energy-pv/10 p-2"><BatteryCharging className="w-4 h-4 text-energy-pv" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Points actifs</div>
            <div className="text-lg font-semibold mono">{data.points_count}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2"><Clock className="w-4 h-4 text-muted-foreground" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Dernière MAJ</div>
            <div className="text-sm font-medium">il y a {timeAgo}</div>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] badge-ok">Live</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { selectedTerrain, selectedSite, aggregatedView } = useAppContext();

  const title = aggregatedView
    ? `Site: ${selectedSite?.name ?? 'Site'}`
    : `Terrain: ${selectedTerrain?.name ?? 'Terrain'}`;
  const description = aggregatedView
    ? `Vue agrégée sur ${selectedSite?.terrainsCount ?? 0} terrain(s)`
    : `Concentrateur ${selectedTerrain?.gatewayId ?? '-'} - ${selectedTerrain?.pointsCount ?? 0} zones`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[
          { label: 'Accueil', href: '/' },
          { label: 'Tableau de bord' },
        ]}
      />
      {selectedTerrain && <LiveKPIs terrainId={selectedTerrain.id} />}
      <WidgetBoard />
    </div>
  );
}
