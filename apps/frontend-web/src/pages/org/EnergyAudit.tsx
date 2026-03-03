import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, FileText } from 'lucide-react';

const diagnostics = [
  { label: 'Qualité tension', status: 'ok', detail: 'Déséquilibre < 2%' },
  { label: 'Facteur de puissance', status: 'warning', detail: 'PF moyen 0,82' },
  { label: 'THD', status: 'ok', detail: 'THD moyen 3,6%' },
  { label: 'Profil de charge', status: 'warning', detail: 'Pics matinaux élevés' },
  { label: 'Complétude données', status: 'ok', detail: '98,5% sur 24h' },
];

const recommendations = [
  { priority: 'Haute', title: 'Analyser PF bas sur ligne compresseurs', impact: 'Risque de pénalité PF' },
  { priority: 'Moyenne', title: 'Vérifier THD atelier mécanique', impact: 'Harmoniques ? surveiller' },
  { priority: 'Basse', title: 'Ajuster plages horaires HVAC', impact: 'Lissage des pics matinaux' },
];

export default function EnergyAudit() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit énergétique"
        description="Diagnostic et recommandations prioritaires"
        actions={
          <Button variant="outline" size="sm">
            <FileText className="w-4 h-4 mr-2" />
            Générer rapport
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">État du diagnostic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {diagnostics.map(item => (
              <div key={item.label} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  {item.status === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 text-severity-ok" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-severity-warning" />
                  )}
                  <span>{item.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Recommandations prioritaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map(item => (
              <div key={item.title} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{item.title}</div>
                  <Badge variant="secondary" className="text-[10px]">{item.priority}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Impact: {item.impact}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
