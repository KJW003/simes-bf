import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useIncidents, useIncidentStats, useUpdateIncident } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
} from 'lucide-react';

const severityConfig = {
  critical: { label: 'Critique', className: 'badge-critical', icon: AlertOctagon },
  warning: { label: 'Attention', className: 'badge-warning', icon: AlertTriangle },
  info: { label: 'Info', className: 'badge-ok', icon: CheckCircle2 },
} as const;

const statusConfig = {
  open: { label: 'Ouvert', className: 'text-red-600 bg-red-50 border-red-200' },
  acknowledged: { label: 'Pris en charge', className: 'text-amber-600 bg-amber-50 border-amber-200' },
  resolved: { label: 'Résolu', className: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
} as const;

const fmtDate = (d: string) => new Date(d).toLocaleString('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function Incidents() {
  const [statusFilter, setStatusFilter] = useState<string>('_all');
  const [severityFilter, setSeverityFilter] = useState<string>('_all');

  const params = {
    ...(statusFilter !== '_all' ? { status: statusFilter } : {}),
    ...(severityFilter !== '_all' ? { severity: severityFilter } : {}),
  };

  const { data, isLoading, refetch } = useIncidents(Object.keys(params).length ? params : undefined);
  const { data: stats } = useIncidentStats();
  const updateIncident = useUpdateIncident();

  const incidents = data?.incidents ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Incidents"
        description="Gestion des incidents plateforme"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Actualiser
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Total incidents" value={stats?.total ?? 0} icon={<AlertOctagon className="w-4 h-4" />} />
        <KpiCard label="Ouverts" value={stats?.open_count ?? 0} icon={<Clock className="w-4 h-4" />} variant={stats?.open_count ? 'warning' : 'default'} />
        <KpiCard label="Critiques actifs" value={stats?.critical_count ?? 0} icon={<AlertTriangle className="w-4 h-4" />} variant={stats?.critical_count ? 'critical' : 'default'} />
        <KpiCard label="Résolus" value={(stats?.total ?? 0) - (stats?.open_count ?? 0)} icon={<CheckCircle2 className="w-4 h-4" />} variant="success" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Statut :</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tous</SelectItem>
            <SelectItem value="open">Ouvert</SelectItem>
            <SelectItem value="acknowledged">Pris en charge</SelectItem>
            <SelectItem value="resolved">Résolu</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-2">Sévérité :</span>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Toutes</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Attention</SelectItem>
            <SelectItem value="critical">Critique</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Incidents ({data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : incidents.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Aucun incident trouvé</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table text-xs w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="py-2 px-2">Sévérité</th>
                    <th className="py-2 px-2">Titre</th>
                    <th className="py-2 px-2">Source</th>
                    <th className="py-2 px-2">Terrain</th>
                    <th className="py-2 px-2">Statut</th>
                    <th className="py-2 px-2">Assigné</th>
                    <th className="py-2 px-2">Créé</th>
                    <th className="py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc: any) => {
                    const sev = severityConfig[inc.severity as keyof typeof severityConfig] ?? severityConfig.info;
                    const st = statusConfig[inc.status as keyof typeof statusConfig] ?? statusConfig.open;
                    return (
                      <tr key={inc.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-1.5 px-2">
                          <Badge variant="outline" className={cn('text-[9px]', sev.className)}>{sev.label}</Badge>
                        </td>
                        <td className="py-1.5 px-2 font-medium max-w-[200px] truncate">{inc.title}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{inc.source || '—'}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{inc.terrain_name || '—'}</td>
                        <td className="py-1.5 px-2">
                          <Badge variant="outline" className={cn('text-[9px]', st.className)}>{st.label}</Badge>
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground">{inc.assigned_name || '—'}</td>
                        <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                        <td className="py-1.5 px-2">
                          {inc.status === 'open' && (
                            <Button size="sm" variant="outline" className="h-6 text-xs"
                              onClick={() => updateIncident.mutate({ id: inc.id, status: 'acknowledged' })}
                            >Prendre en charge</Button>
                          )}
                          {inc.status === 'acknowledged' && (
                            <Button size="sm" variant="outline" className="h-6 text-xs"
                              onClick={() => updateIncident.mutate({ id: inc.id, status: 'resolved' })}
                            >Résoudre</Button>
                          )}
                          {inc.status === 'resolved' && (
                            <span className="text-[10px] text-muted-foreground">{inc.resolved_at ? fmtDate(inc.resolved_at) : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}