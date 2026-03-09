import React, { useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, MapPin, FolderTree } from 'lucide-react';
import DataMonitorContent from './DataMonitor';
import PointsContent from './Points';

export default function ZonesPoints() {
  const { selectedTerrain } = useAppContext();
  const terrainId = selectedTerrain?.id ?? null;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Default tab based on route: /points → points, /data-monitor → zones
  const defaultTab = location.pathname === '/points' ? 'points' : 'zones';
  const tab = searchParams.get('tab') ?? defaultTab;

  const setTab = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  if (!terrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Zones et Points de mesures" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Zones et Points de mesures"
        description={selectedTerrain?.name ?? ''}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="zones" className="gap-1.5">
            <FolderTree className="w-4 h-4" />
            Zones
          </TabsTrigger>
          <TabsTrigger value="points" className="gap-1.5">
            <MapPin className="w-4 h-4" />
            Points de mesure
          </TabsTrigger>
        </TabsList>
        <TabsContent value="zones" className="mt-4">
          <DataMonitorContent embedded />
        </TabsContent>
        <TabsContent value="points" className="mt-4">
          <PointsContent embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
