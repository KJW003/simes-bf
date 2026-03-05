import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { AlertOctagon } from 'lucide-react';

export default function Incidents() {
  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Gestion des incidents plateforme" />
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <AlertOctagon className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Module en préparation</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ce module nécessite une table incidents et un système d'alerting.
            </p>
          </div>
          <div className="pt-4 text-left w-full max-w-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fonctionnalités prévues</h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Liste des incidents avec sévérité et timeline</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Assignation et suivi de résolution</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Intégration monitoring pipeline</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}