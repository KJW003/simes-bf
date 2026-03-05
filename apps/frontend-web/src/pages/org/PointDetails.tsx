import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Activity } from 'lucide-react';

export default function PointDetails() {
  const { pointId } = useParams<{ pointId: string }>();
  return (
    <div className="space-y-6">
      <PageHeader title={"Point " + (pointId?.slice(0,8) ?? '')} description="Détail d'un point de mesure" />
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Activity className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Module en préparation</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ce module nécessite un endpoint GET /points/:id avec historique et métriques.
            </p>
          </div>
          <div className="pt-4 text-left w-full max-w-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fonctionnalités prévues</h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />KPIs temps réel du point</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Courbe de charge 24h</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Historique et export</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}