import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Gauge } from 'lucide-react';

export default function PowerQuality() {
  return (
    <div className="space-y-6">
      <PageHeader title="Qualite" description="Qualite de l energie electrique" />
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Gauge className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Module en preparation</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ce module necessite des endpoints de qualite (THD, PF, tensions) cote backend.
            </p>
          </div>
          <div className="pt-4 text-left w-full max-w-sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fonctionnalites prevues</h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Facteur de puissance et penalites</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Distorsion harmonique (THD)</li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Equilibre des phases</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}