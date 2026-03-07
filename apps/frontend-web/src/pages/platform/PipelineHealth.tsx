import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePipelineHealth } from '@/hooks/useApi';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2,
  Database, Server, Cpu, Wrench, RotateCcw, Trash2, Zap,
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

  // Repair actions state
  const [repairLoading, setRepairLoading] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<string | null>(null);
  const [aggFrom, setAggFrom] = useState('');
  const [aggTo, setAggTo] = useState('');

  const runRepair = async (action: string, fn: () => Promise<any>) => {
    setRepairLoading(action);
    setRepairResult(null);
    try {
      const r = await fn();
      setRepairResult(`✓ ${action}: ${JSON.stringify(r)}`);
    } catch (e: any) {
      setRepairResult(`✗ ${action}: ${e.message}`);
    } finally {
      setRepairLoading(null);
    }
  };

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

      {/* ── Repair Actions ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Actions de réparation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {/* Re-aggregate */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Ré-agrégation
              </div>
              <div className="space-y-1">
                <Input type="datetime-local" className="h-7 text-xs" placeholder="Début" value={aggFrom} onChange={e => setAggFrom(e.target.value)} />
                <Input type="datetime-local" className="h-7 text-xs" placeholder="Fin" value={aggTo} onChange={e => setAggTo(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs"
                disabled={!aggFrom || !aggTo || repairLoading === 'reaggregate'}
                onClick={() => runRepair('reaggregate', () => api.repairAggregations({ from: new Date(aggFrom).toISOString(), to: new Date(aggTo).toISOString() }))}
              >
                {repairLoading === 'reaggregate' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Lancer
              </Button>
            </div>

            {/* Retry failed */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> Retry jobs échoués
              </div>
              <p className="text-xs text-muted-foreground">Relance les jobs en échec dans la queue telemetry.</p>
              <Button size="sm" variant="outline" className="w-full text-xs"
                disabled={repairLoading === 'retry'}
                onClick={() => runRepair('retry', () => api.retryFailedJobs('telemetry', 50))}
              >
                {repairLoading === 'retry' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Relancer
              </Button>
            </div>

            {/* Flush failed */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Vider jobs échoués
              </div>
              <p className="text-xs text-muted-foreground">Supprime définitivement tous les jobs échoués.</p>
              <Button size="sm" variant="destructive" className="w-full text-xs"
                disabled={repairLoading === 'flush'}
                onClick={() => { if (window.confirm('Supprimer TOUS les jobs échoués ?')) runRepair('flush', () => api.flushFailedJobs('telemetry')); }}
              >
                {repairLoading === 'flush' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Vider
              </Button>
            </div>

            {/* Reprocess unmapped */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Retraiter unmapped
              </div>
              <p className="text-xs text-muted-foreground">Relance le traitement des messages buffered/unmapped.</p>
              <Button size="sm" variant="outline" className="w-full text-xs"
                disabled={repairLoading === 'reprocess'}
                onClick={() => runRepair('reprocess', () => api.reprocessUnmapped(500))}
              >
                {repairLoading === 'reprocess' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Retraiter
              </Button>
            </div>
          </div>

          {/* Result banner */}
          {repairResult && (
            <div className={cn(
              "p-2 rounded text-xs font-mono",
              repairResult.startsWith('✓') ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
            )}>
              {repairResult}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
