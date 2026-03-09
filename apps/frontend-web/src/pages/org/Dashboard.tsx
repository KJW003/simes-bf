import React from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { WidgetBoard } from '@/components/widgets/WidgetBoard';

export default function Dashboard() {
  const { selectedTerrain, selectedSite, selectedTerrainId, aggregatedView } = useAppContext();

  const title = aggregatedView
    ? 'Site: ' + (selectedSite?.name ?? 'Site')
    : selectedTerrain?.name ?? 'Tableau de bord';
  const description = aggregatedView
    ? 'Vue agrégée sur ' + (selectedSite?.terrainsCount ?? 0) + ' terrain(s)'
    : 'Monitoring temps réel — ' + (selectedTerrain?.pointsCount ?? 0) + ' points';

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

      {!selectedTerrainId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain dans la barre supérieure pour voir les données.
          </CardContent>
        </Card>
      )}

      {selectedTerrainId && <WidgetBoard />}
    </div>
  );
}