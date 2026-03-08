import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, Bell, BellOff, CheckCircle, ShieldAlert,
  Activity, Loader2, Brain, TrendingDown,
} from 'lucide-react';
import { useIncidents, useIncidentStats, useTerrainOverview, useUpdateIncident } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critique', color: 'text-red-700', bg: 'bg-red-100 border-red-200' },
  warning: { label: 'Attention', color: 'text-amber-700', bg: 'bg-amber-100 border-amber-200' },
  info: { label: 'Info', color: 'text-blue-700', bg: 'bg-blue-100 border-blue-200' },
};

export default function Anomalies() {
  const { selectedTerrainId } = useAppContext();
  const [statusFilter, setStatusFilter] = useState<string>('_all');
  const [severityFilter, setSeverityFilter] = useState<string>('_all');
  const [tab, setTab] = useState<'alerts' | 'ai'>('alerts');

  const { data: statsData, isLoading: statsLoading } = useIncidentStats();
  const { data: incidentsData, isLoading: incLoading } = useIncidents({
    terrain_id: selectedTerrainId ?? undefined,
    status: statusFilter !== '_all' ? statusFilter : undefined,
    severity: severityFilter !== '_all' ? severityFilter : undefined,
    limit: 100,
  });
  const { data: overviewData } = useTerrainOverview(selectedTerrainId);
  const updateIncident = useUpdateIncident();

  const incidents = (incidentsData?.incidents ?? []) as Array<Record<string, any>>;
  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const stats = statsData ?? { open_count: 0, critical_count: 0, total: 0, breakdown: [] };

  // Count alerts per device
  const alertsByDevice = useMemo(() => {
    const map = new Map<string, number>();
    for (const inc of incidents) {
      const pid = String(inc.point_id ?? 'unknown');
      map.set(pid, (map.get(pid) ?? 0) + 1);
    }
    return map;
  }, [incidents]);

  // Resolved count
  const resolvedCount = useMemo(() => incidents.filter(i => i.status === 'resolved' || i.status === 'closed').length, [incidents]);

  const handleResolve = async (id: string) => {
    await updateIncident.mutateAsync({ id, status: 'resolved' });
  };

  const handleAcknowledge = async (id: string) => {
    await updateIncident.mutateAsync({ id, status: 'acknowledged' });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes & Anomalies"
        description="Surveillance des alertes par appareil et détection d'anomalies"
      />

      {/* Tabs */}
      <div className="flex gap-2">
        <Button variant={tab === 'alerts' ? 'default' : 'outline'} size="sm" onClick={() => setTab('alerts')}>
          <Bell className="w-4 h-4 mr-1" /> Alertes
        </Button>
        <Button variant={tab === 'ai' ? 'default' : 'outline'} size="sm" onClick={() => setTab('ai')}>
          <Brain className="w-4 h-4 mr-1" /> Anomalies IA
        </Button>
      </div>

      {tab === 'alerts' ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
            <KpiCard
              label="Alertes actives"
              value={stats.open_count}
              icon={<Bell className="w-4 h-4" />}
              variant={stats.open_count > 0 ? 'warning' : 'default'}
            />
            <KpiCard
              label="Critiques"
              value={stats.critical_count}
              icon={<ShieldAlert className="w-4 h-4" />}
              variant={stats.critical_count > 0 ? 'critical' : 'default'}
            />
            <KpiCard
              label="Résolues"
              value={resolvedCount}
              icon={<CheckCircle className="w-4 h-4" />}
              variant="success"
            />
            <KpiCard
              label="Total"
              value={stats.total}
              icon={<Activity className="w-4 h-4" />}
            />
          </div>

          {/* Alerts per device summary */}
          {alertsByDevice.size > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Alertes par appareil</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Array.from(alertsByDevice.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([pid, count]) => {
                      const pointName = points.find(p => String(p.id) === pid)?.name ?? pid;
                      return (
                        <Badge key={pid} variant="outline" className="text-xs px-2 py-1 gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                          {String(pointName)}: {count}
                        </Badge>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Statut</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Tous</SelectItem>
                  <SelectItem value="open">Ouvert</SelectItem>
                  <SelectItem value="acknowledged">Reconnu</SelectItem>
                  <SelectItem value="resolved">Résolu</SelectItem>
                  <SelectItem value="closed">Fermé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Sévérité</label>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Toutes</SelectItem>
                  <SelectItem value="critical">Critique</SelectItem>
                  <SelectItem value="warning">Attention</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Alert list */}
          {(incLoading || statsLoading) && (
            <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
          )}

          {!incLoading && incidents.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                <BellOff className="w-8 h-8" />
                <span>Aucune alerte pour les filtres sélectionnés</span>
              </CardContent>
            </Card>
          )}

          {!incLoading && incidents.length > 0 && (
            <div className="space-y-2">
              {incidents.map(inc => {
                const sev = SEVERITY_CONFIG[inc.severity] ?? SEVERITY_CONFIG.info;
                const pointName = points.find(p => String(p.id) === String(inc.point_id))?.name;
                const isActive = inc.status === 'open' || inc.status === 'acknowledged';
                const created = new Date(inc.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

                return (
                  <Card key={inc.id} className={cn('transition-all', isActive && 'border-l-4', inc.severity === 'critical' && 'border-l-red-500', inc.severity === 'warning' && 'border-l-amber-400')}>
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn('rounded-full p-1.5 mt-0.5', sev.bg)}>
                        <AlertTriangle className={cn('w-4 h-4', sev.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{inc.title}</span>
                          <Badge className={cn('text-[9px]', sev.bg, sev.color)}>{sev.label}</Badge>
                          <Badge variant="outline" className="text-[9px]">{inc.status}</Badge>
                          {pointName && <Badge variant="outline" className="text-[9px]">{String(pointName)}</Badge>}
                        </div>
                        {inc.description && <p className="text-xs text-muted-foreground mt-1">{inc.description}</p>}
                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-3">
                          <span>{created}</span>
                          {inc.source && <span>Source: {inc.source}</span>}
                        </div>
                      </div>
                      {isActive && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {inc.status === 'open' && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleAcknowledge(inc.id)}>
                              Reconnaître
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="h-7 text-xs text-green-700" onClick={() => handleResolve(inc.id)}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Résoudre
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
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