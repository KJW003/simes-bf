import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertTriangle, Bell, BellOff, CheckCircle, CheckCircle2, ShieldAlert,
  Activity, Brain, TrendingDown, Loader2, RefreshCw, Search, Info,
} from 'lucide-react';
import { useTerrainOverview, useAnomalies, useDetectAnomalies } from '@/hooks/useApi';
import { AlarmConfigPanel } from '@/components/widgets/dashboard-sections';
import { useAlarmEngine } from '@/hooks/useAlarmEngine';
import { cn } from '@/lib/utils';

// ── Anomaly Type Explanations ──
const anomalyExplanations: Record<string, { label: string; meaning: string; action: string }> = {
  'residual': {
    label: 'Écart prévu/réel',
    meaning: 'Votre site consomme plus ou moins que ce qui est prévu. Cela peut indiquer un équipement défaillant ou une utilisation anormale.',
    action: 'Vérifier l\'utilisation de la journée. Chercher les équipements qui fonctionnent anormalement.'
  },
  'isolation_forest': {
    label: 'Anomalie multivariée',
    meaning: 'Plusieurs mesures électriques (courant, tension, etc.) sont inhabituelles ensemble. C\'est un signal que quelque chose ne va pas.',
    action: 'Inspecter les équipements pour trouver celui qui fonctionne mal.'
  },
  'change_point': {
    label: 'Changement de consommation',
    meaning: 'La consommation a soudainement augmenté ou diminué. Cela peut être un équipement qui s\'est arrêté ou un nouveau service activé.',
    action: 'Vérifier quel équipement a changé son fonctionnement.'
  },
  'volatility_spike': {
    label: 'Instabilité équipement',
    meaning: 'Un équipement oscille rapidement (démarre/s\'arrête). Cela use le matériel plus vite.',
    action: 'Planifier une maintenance pour cet équipement avant qu\'il ne casse.'
  },
  'seasonality_break': {
    label: 'Pattern modifié',
    meaning: 'Votre consommation hebdomadaire a changé. Lundi/mercredi/vendredi ne ressemblent plus à avant.',
    action: 'Vérifier si les horaires ou les activités ont changé.'
  },
  'anomaly_cluster': {
    label: 'Problème systémique',
    meaning: 'Plusieurs anomalies se produisent pendant la même période. Cela peut indiquer un problème au niveau du site.',
    action: 'Contacter un électricien pour un diagnostic complet.'
  },
  'quality_thd': {
    label: 'THD élevé',
    meaning: 'La distorsion harmonique est trop élevée. Cela peut être causé par des équipements électroniques (variateurs, LED, etc.) qui polluent le réseau.',
    action: 'Installer des filtres harmoniques ou améliorer la qualité des équipements. Contacter un électricien spécialisé.'
  },
  'quality_pf': {
    label: 'Facteur de puissance faible',
    meaning: 'Le facteur de puissance est en dessous du seuil. Vous payez des pénalités tarifaires et l\'énergie réactive est gaspillée.',
    action: 'Installer un banc de condensateurs ou un correcteur de facteur de puissance. Consulter un électricien.'
  },
  'quality_voltage_unbalance': {
    label: 'Déséquilibre de tension',
    meaning: 'Les tensions entre les trois phases ne sont pas équilibrées. Cela use prématurément les moteurs et équipements triphasés.',
    action: 'Vérifier la répartition des charges monophasées. Demander un diagnostic au distributeur d\'électricité.'
  },
  'quality_current_unbalance': {
    label: 'Déséquilibre de courant',
    meaning: 'Les courants des trois phases sont déséquilibrés. Certaines phases sont surchargées, d\'autres sous-utilisées.',
    action: 'Rééquilibrer les charges monophasées entre les phases. Redistribuer les équipements de manière homogène.'
  }
};

export default function Anomalies() {
  const { selectedTerrainId } = useAppContext();
  const [tab, setTab] = useState<'local' | 'ai'>('local');
  const [showResolved, setShowResolved] = useState(false);

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const alarmEngine = useAlarmEngine(selectedTerrainId);
  const { data: anomalyData, isLoading: loadAnom } = useAnomalies(selectedTerrainId);
  const detectMutation = useDetectAnomalies();
  const detectedCount =
    (detectMutation.data?.residual?.found ?? 0) +
    (detectMutation.data?.isolation_forest?.found ?? 0);

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const anomalies = (anomalyData?.anomalies ?? []) as Array<Record<string, any>>;
  const activeAnoms = anomalies.filter(a => !a.resolved);
  const resolvedAnoms = anomalies.filter(a => a.resolved);
  
  const displayedAnoms = showResolved ? [...activeAnoms, ...resolvedAnoms] : activeAnoms;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes & Anomalies"
        description="Surveillance des alertes par appareil et détection d'anomalies"
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'local' ? 'default' : 'outline'} size="sm" onClick={() => setTab('local')}>
          <AlertTriangle className="w-4 h-4 mr-1" /> Détection locale
          {alarmEngine.stats.active > 0 && <Badge className="ml-1 bg-red-500 text-white text-[9px]">{alarmEngine.stats.active}</Badge>}
        </Button>
        <Button variant={tab === 'ai' ? 'default' : 'outline'} size="sm" onClick={() => setTab('ai')}>
          <Brain className="w-4 h-4 mr-1" /> Anomalies IA
        </Button>
      </div>

      {tab === 'local' ? (
        /* ── Local alarm detection (based on configured rules + device alarm_state) ── */
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
            <KpiCard label="Actives" value={alarmEngine.stats.active} icon={<Bell className="w-4 h-4" />} variant={alarmEngine.stats.active > 0 ? 'warning' : 'default'} />
            <KpiCard label="Résolues" value={alarmEngine.stats.resolved} icon={<CheckCircle className="w-4 h-4" />} variant="success" />
            <KpiCard label="Total historique" value={alarmEngine.stats.total} icon={<Activity className="w-4 h-4" />} />
            <KpiCard label="Critiques" value={alarmEngine.activeAlarms.filter(a => a.severity === 'critical').length} icon={<ShieldAlert className="w-4 h-4" />} variant={alarmEngine.activeAlarms.some(a => a.severity === 'critical') ? 'critical' : 'default'} />
          </div>

          {alarmEngine.allAlarms.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                <BellOff className="w-8 h-8" />
                <span>Aucune alarme détectée. Configurez des règles ci-dessous.</span>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Active alarms first, then resolved */}
              {[...alarmEngine.activeAlarms, ...alarmEngine.resolvedAlarms].map(a => {
                const isResolved = a.resolvedAt !== null;
                return (
                  <Card key={a.id} className={cn('transition-all', !isResolved && 'border-l-4', a.severity === 'critical' && !isResolved && 'border-l-red-500', a.severity === 'warning' && !isResolved && 'border-l-amber-400', isResolved && 'opacity-70')}>
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn('rounded-full p-1.5 mt-0.5', isResolved ? 'bg-green-100 border-green-200' : a.severity === 'critical' ? 'bg-red-100 border-red-200' : 'bg-amber-100 border-amber-200')}>
                        {isResolved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className={cn('w-4 h-4', a.severity === 'critical' ? 'text-red-700' : 'text-amber-700')} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{a.pointName}</span>
                          <Badge className={cn('text-[9px]', isResolved ? 'bg-green-100 text-green-700' : a.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                            {isResolved ? 'Résolu' : a.severity === 'critical' ? 'Critique' : 'Attention'}
                          </Badge>
                          <Badge variant="outline" className="text-[9px]">{a.source === 'device' ? 'Matériel' : 'Règle'}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{a.type}</p>
                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-3">
                          <span>Déclenché: {new Date(a.triggeredAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          {isResolved && <span className="text-green-600">Résolu: {new Date(a.resolvedAt!).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {alarmEngine.stats.total > 0 && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={alarmEngine.clearHistory}>Effacer l'historique</Button>
            </div>
          )}

          {/* Alarm rules configuration — inline */}
          {selectedTerrainId && <AlarmConfigPanel terrainId={selectedTerrainId} />}
        </>
      ) : (
        /* ── AI Anomaly Detection ── */
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
            <KpiCard label="Détectées" value={anomalies.length} icon={<Brain className="w-4 h-4" />} />
            <KpiCard label="Actives" value={activeAnoms.length} icon={<AlertTriangle className="w-4 h-4" />} variant={activeAnoms.length > 0 ? 'warning' : 'default'} />
            <KpiCard label="Résolues" value={resolvedAnoms.length} icon={<CheckCircle className="w-4 h-4" />} variant="success" />
            <KpiCard label="Critiques" value={activeAnoms.filter(a => a.severity === 'high').length} icon={<ShieldAlert className="w-4 h-4" />} variant={activeAnoms.some(a => a.severity === 'high') ? 'critical' : 'default'} />
          </div>

          <div className="flex flex-wrap items-center gap-3 justify-between">
            <Button
              size="sm"
              onClick={() => selectedTerrainId && detectMutation.mutate(selectedTerrainId)}
              disabled={detectMutation.isPending || !selectedTerrainId}
            >
              {detectMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
              Lancer la détection IA
            </Button>
            {detectMutation.isSuccess && (
              <Badge className="bg-green-100 text-green-700 text-[10px]">
                ✓ Analyse complète: {detectedCount} problèmes trouvés
              </Badge>
            )}
            {detectMutation.isError && (
              <Badge className="bg-red-100 text-red-700 text-[10px]">
                Erreur: {(detectMutation.error as Error)?.message ?? 'Échec'}
              </Badge>
            )}
          </div>

          {/* Show Resolved Toggle */}
          {resolvedAnoms.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg w-fit">
              <Checkbox 
                checked={showResolved}
                onCheckedChange={(checked) => setShowResolved(checked as boolean)}
                id="show-resolved"
              />
              <label htmlFor="show-resolved" className="text-sm cursor-pointer">
                Afficher {resolvedAnoms.length} anomalie{resolvedAnoms.length > 1 ? 's' : ''} résolue{resolvedAnoms.length > 1 ? 's' : ''}
              </label>
            </div>
          )}

          {loadAnom ? (
            <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
          ) : displayedAnoms.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                <Brain className="w-8 h-8 text-violet-400" />
                <span>Aucune anomalie {showResolved ? '' : 'active'}.</span>
                <span className="text-xs">Cliquez sur « Lancer la détection IA » pour analyser vos données.</span>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {displayedAnoms.map(a => {
                const isResolved = a.resolved;
                const explanation = anomalyExplanations[a.anomaly_type] || { 
                  label: a.anomaly_type, 
                  meaning: 'Anomalie détectée', 
                  action: 'Contacter support technique'
                };
                const severityColor = a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'blue';
                
                return (
                  <Card key={a.id} className={cn('transition-all', !isResolved && 'border-l-4', a.severity === 'high' && !isResolved && 'border-l-red-500', a.severity === 'medium' && !isResolved && 'border-l-amber-400', isResolved && 'opacity-60')}>
                    <CardContent className="p-4 space-y-3">
                      {/* Header Row */}
                      <div className="flex items-start gap-3">
                        <div className={cn('rounded-full p-1.5 flex-shrink-0', isResolved ? 'bg-green-100' : `bg-${severityColor}-100`)}>
                          {isResolved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <TrendingDown className={cn('w-4 h-4', a.severity === 'high' ? 'text-red-700' : 'text-amber-700')} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm">{explanation.label}</span>
                            <Badge className={cn('text-[9px]', isResolved ? 'bg-green-100 text-green-700' : a.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                              {isResolved ? 'Résolu' : a.severity === 'high' ? 'Critique' : a.severity === 'medium' ? 'Attention' : 'Info'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(a.anomaly_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                          
                          {/* Data Summary Row */}
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                            {a.expected_kwh != null && a.actual_kwh != null && (
                              <>
                                <span>Prévu: {Number(a.expected_kwh).toFixed(1)} kWh</span>
                                <span>•</span>
                                <span>Réel: {Number(a.actual_kwh).toFixed(1)} kWh</span>
                                {a.deviation_pct != null && (
                                  <>
                                    <span>•</span>
                                    <span className={a.deviation_pct > 0 ? 'text-red-600' : 'text-blue-600'}>
                                      {a.deviation_pct > 0 ? '+' : ''}{Number(a.deviation_pct).toFixed(1)}%
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                            {a.score != null && <span>Score confiance: {Number(a.score).toFixed(2)}</span>}
                          </div>
                        </div>
                      </div>
                      
                      {/* Explanation & Description */}
                      {!isResolved && (
                        <div className="space-y-2 pt-2 border-t">
                          <div>
                            <div className="flex items-start gap-2">
                              <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-xs font-medium text-blue-900 mb-0.5">Qu'est-ce que c'est?</p>
                                <p className="text-xs text-muted-foreground">{explanation.meaning}</p>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-xs font-medium text-green-900 mb-0.5">Que faire?</p>
                                <p className="text-xs text-muted-foreground">{explanation.action}</p>
                              </div>
                            </div>
                          </div>
                          {a.description && (
                            <p className="text-xs bg-muted/50 p-2 rounded mt-2">{a.description}</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}