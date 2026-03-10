import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Bell, BellOff, CheckCircle, CheckCircle2, ShieldAlert,
  Activity, Brain, TrendingDown,
} from 'lucide-react';
import { useTerrainOverview } from '@/hooks/useApi';
import { AlarmConfigPanel } from '@/components/widgets/dashboard-sections';
import { useAlarmEngine } from '@/hooks/useAlarmEngine';
import { cn } from '@/lib/utils';

export default function Anomalies() {
  const { selectedTerrainId } = useAppContext();
  const [tab, setTab] = useState<'local' | 'ai'>('local');

  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const alarmEngine = useAlarmEngine(selectedTerrainId);

  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;

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
        /* ── AI Anomaly Detection (future) ── */
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center">
              <Brain className="w-8 h-8 text-violet-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Détection d'anomalies par IA</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Ce module utilisera des algorithmes d'intelligence artificielle pour détecter
                automatiquement les anomalies de consommation énergétique.
              </p>
            </div>
            <div className="pt-4 text-left w-full max-w-sm">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fonctionnalités prévues</h4>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingDown className="w-4 h-4 text-violet-400" />
                  Détection de déviations par Z-score
                </li>
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Brain className="w-4 h-4 text-violet-400" />
                  Modèles ML de prédiction de consommation
                </li>
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="w-4 h-4 text-violet-400" />
                  Alertes automatiques sur anomalies détectées
                </li>
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="w-4 h-4 text-violet-400" />
                  Suivi et historique des anomalies
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}