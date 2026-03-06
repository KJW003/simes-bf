import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePipelineHealth } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2,
  Database, Server, Cpu,
} from 'lucide-react';

const statusColors: Record<string, string> = {
  up: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  down: 'text-red-600 bg-red-50 border-red-200',
  degraded: 'text-amber-600 bg-amber-50 border-amber-200',
  warning: 'text-amber-600 bg-amber-50 border-amber-200',
  disabled: 'text-gray-500 bg-gray-50 border-gray-200',
  error: 'text-red-600 bg-red-50 border-red-200',
};

const statusIcons: Record<string, any> = {
  up: CheckCircle2,
  down: XCircle,
  degraded: AlertTriangle,
  warning: AlertTriangle,
  disabled: Activity,
  error: XCircle,
};

const componentIcons: Record<string, any> = {
  'Core DB': Database,
  'Telemetry DB': Database,
  'Redis': Server,
  'Telemetry Throughput': Activity,
};

export default function PipelineHealth() {
  const { data, isLoading, refetch } = usePipelineHealth();

  const components = data?.components ?? [];
  const upCount = components.filter(c => c.status === 'up').length;
  const downCount = components.filter(c => c.status === 'down' || c.status === 'error').length;
  const avgLatency = (() => {
    const lats = components.filter(c => c.latency_ms != null).map(c => c.latency_ms);
    return lats.length ? Math.round(lats.reduce((s: number, v: number) => s + v, 0) / lats.length) : 0;
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pipeline"
        description={`Santé du pipeline de données${data?.checked_at ? ' — vérifié à ' + new Date(data.checked_at).toLocaleTimeString('fr-FR') : ''}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Actualiser
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Composants actifs" value={`${upCount}/${components.length}`} icon={<CheckCircle2 className="w-4 h-4" />} variant={downCount === 0 ? 'success' : 'warning'} />
        <KpiCard label="En panne" value={downCount} icon={<XCircle className="w-4 h-4" />} variant={downCount > 0 ? 'critical' : 'default'} />
        <KpiCard label="Latence moyenne" value={`${avgLatency} ms`} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Statut global" value={data?.ok ? 'OK' : downCount > 0 ? 'Dégradé' : '—'} icon={<Cpu className="w-4 h-4" />} variant={data?.ok ? 'success' : 'critical'} />
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {components.map((comp: any, i: number) => {
            const Icon = componentIcons[comp.name] ?? (comp.name.startsWith('Queue') ? Cpu : Activity);
            const StatusIcon = statusIcons[comp.status] ?? Activity;
            return (
              <Card key={i}>
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {comp.name}
                  </CardTitle>
                  <Badge variant="outline" className={cn('text-[10px]', statusColors[comp.status] ?? '')}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {comp.status}
                  </Badge>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  {comp.latency_ms != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Latence</span>
                      <span className="mono">{comp.latency_ms} ms</span>
                    </div>
                  )}
                  {typeof comp.detail === 'string' && (
                    <div className="text-muted-foreground truncate">{comp.detail}</div>
                  )}
                  {typeof comp.detail === 'object' && comp.detail && (
                    <div className="space-y-0.5">
                      {Object.entries(comp.detail).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="mono">{String(v ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
