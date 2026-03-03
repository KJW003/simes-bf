import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Layers } from 'lucide-react';

export default function ZonePage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  return (
    <div className="space-y-6">
      <PageHeader title={"Zone " + (zoneId?.slice(0,8) ?? '')} description="Detail d une zone de mesure" />
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Layers className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Module en preparation</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ce module necessite un endpoint GET /zones/:id avec les points associes.
            </p>
          </div>
          <div className="pt-4 text-left w-full max-w-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fonctionnalites prevues</h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Vue zone avec points de mesure</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Widgets configurables par zone</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Comparaison entre zones</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}