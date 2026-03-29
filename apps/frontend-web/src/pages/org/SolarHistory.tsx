import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSolarScenarios, useCreateSolarScenario } from '@/hooks/useApi';
import {
  Sun, Calculator, Loader2, Clock, ChevronRight, XCircle, CheckCircle2,
  Zap, Gauge, Maximize2,
} from 'lucide-react';

const METHOD_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  average_load: { label: 'Charge moyenne', icon: Zap },
  peak_demand: { label: 'Puissance de pointe', icon: Gauge },
  theoretical_production: { label: 'Production théorique', icon: Sun },
  available_surface: { label: 'Surface disponible', icon: Maximize2 },
};

function statusBadge(status: string) {
  switch (status) {
    case 'ready':
      return <Badge className="bg-green-100 text-green-700 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Terminé</Badge>;
    case 'computing':
    case 'draft':
      return <Badge className="bg-blue-100 text-blue-700 text-[10px]"><Loader2 className="w-3 h-3 mr-1 animate-spin" />En cours</Badge>;
    case 'failed':
      return <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
  }
}

const fmt = (v: number | undefined | null) => v != null ? Math.round(v).toLocaleString('fr-FR') : '—';

export default function SolarHistory() {
  const { selectedTerrainId } = useAppContext();
  const navigate = useNavigate();
  const createScenario = useCreateSolarScenario();
  const { data, isLoading } = useSolarScenarios(selectedTerrainId, { limit: 50 });
  const scenarios = data?.scenarios ?? [];

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Historique solaire" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Historique des scénarios solaires"
        description="Résultats des calculs de prédimensionnement PV"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/predimensionnement')}>
              <Calculator className="w-4 h-4 mr-2" />
              Nouveau scénario
            </Button>
          </div>
        }
      />

      {isLoading && (
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      )}

      {!isLoading && scenarios.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sun className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun scénario solaire pour ce terrain.</p>
            <p className="text-xs mt-1">Lancez un calcul depuis la page de prédimensionnement.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && scenarios.length > 0 && (
        <div className="space-y-3">
          {scenarios.map((sc: any) => {
            const methodInfo = METHOD_LABELS[sc.method] ?? { label: sc.method, icon: Sun };
            const MethodIcon = methodInfo.icon;
            return (
              <Card
                key={sc.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/solar-history/${sc.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
                        <MethodIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{sc.name}</span>
                          {statusBadge(sc.status)}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">{methodInfo.label}</Badge>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(sc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          {sc.status === 'ready' && sc.financial && (
                            <>
                              {sc.financial.annual_production_kwh != null && (
                                <span>{fmt(sc.financial.annual_production_kwh)} kWh/an</span>
                              )}
                              {sc.financial.payback_years != null && (
                                <span>ROI {sc.financial.payback_years.toFixed(1)} ans</span>
                              )}
                            </>
                          )}
                          {sc.error && (
                            <span className="text-red-500">{sc.error}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
