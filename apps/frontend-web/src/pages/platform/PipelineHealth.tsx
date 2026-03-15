import React, { useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog';
import { usePipelineHealth } from '@/hooks/useApi';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2,
  Database, Server, Cpu, Wrench, RotateCcw, Trash2, Zap, Play,
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

interface PipelineComponent {
  name: string;
  status: string;
  latency_ms?: number | null;
  detail?: Record<string, unknown>;
}

export default function PipelineHealth() {
  const { data, isLoading, refetch } = usePipelineHealth();

  // Repair actions state
  const [repairLoading, setRepairLoading] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<string | null>(null);
  const [aggFrom, setAggFrom] = useState('');
  const [aggTo, setAggTo] = useState('');
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false);
  const [flushConfirmText, setFlushConfirmText] = useState('');

  const requiredFlushKeyword = 'CONFIRM-FLUSH-JOBS';

  // Queue actions state
  const [retrying, setRetrying] = useState<string | null>(null);
  const [flushing, setFlushing] = useState<string | null>(null);

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

  const handleRetry = useCallback(async (queue: string) => {
    setRetrying(queue);
    try {
      const res = await api.retryFailedJobs(queue);
      toast.success(`${res.retried} jobs relancés sur ${queue}`);
      refetch();
    } catch { toast.error('Échec du retry'); }
    setRetrying(null);
  }, [refetch]);

  const handleFlush = useCallback(async (queue: string) => {
    setFlushing(queue);
    try {
      const res = await api.flushFailedJobs(queue);
      toast.success(`${res.removed} jobs échoués supprimés de ${queue}`);
      refetch();
    } catch { toast.error('Échec du flush'); }
    setFlushing(null);
  }, [refetch]);

  const components = (data?.components ?? []) as PipelineComponent[];
  const queues = components.filter((c) => c.name.startsWith('Queue'));
  const infra = components.filter((c) => !c.name.startsWith('Queue'));
  const upCount = infra.filter((c) => c.status === 'up').length;
  const downCount = infra.filter((c) => c.status === 'down' || c.status === 'error').length;
  const avgLatency = (() => {
    const lats = infra
      .map((c) => c.latency_ms)
      .filter((v): v is number => typeof v === 'number');
    return lats.length ? Math.round(lats.reduce((s: number, v: number) => s + v, 0) / lats.length) : 0;
  })();
  const totalFailed = queues.reduce((s: number, q) => s + Number((q.detail as { failed?: number } | undefined)?.failed ?? 0), 0);

  const statusBadge = (s: string) => {
    if (s === 'up') return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">{s}</Badge>;
    if (s === 'degraded' || s === 'warning') return <Badge variant="outline" className="border-yellow-500 text-yellow-700">{s}</Badge>;
    return <Badge variant="destructive">{s}</Badge>;
  };

  const statusColor = (s: string) => {
    if (s === 'up') return 'bg-green-500';
    if (s === 'degraded' || s === 'warning') return 'bg-yellow-500';
    return 'bg-red-500';
  };

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-stagger-children">
        <KpiCard label="Composants actifs" value={`${upCount}/${infra.length}`} icon={<CheckCircle2 className="w-4 h-4" />} variant={downCount === 0 ? 'success' : 'warning'} />
        <KpiCard label="En panne" value={downCount} icon={<XCircle className="w-4 h-4" />} variant={downCount > 0 ? 'critical' : 'default'} />
        <KpiCard label="Latence moyenne" value={`${avgLatency} ms`} icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Jobs échoués" value={totalFailed} icon={<AlertTriangle className="w-4 h-4" />} variant={totalFailed > 0 ? 'critical' : 'default'} />
        <KpiCard label="Statut global" value={data?.ok ? 'OK' : downCount > 0 ? 'Dégradé' : '—'} icon={<Cpu className="w-4 h-4" />} variant={data?.ok ? 'success' : 'critical'} />
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      ) : (
        <>
          {/* Infrastructure Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4" /> Infrastructure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {infra.map((c: any, i: number) => {
                  const Icon = componentIcons[c.name] ?? Activity;
                  const StatusIcon = statusIcons[c.status] ?? Activity;
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(c.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          {c.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {typeof c.detail === 'object' && c.detail
                            ? Object.entries(c.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')
                            : String(c.detail ?? '')}
                          {c.latency_ms != null && ` · ${c.latency_ms}ms`}
                        </div>
                      </div>
                      {statusBadge(c.status)}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Queue Management */}
          {queues.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Files d'attente (BullMQ)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground text-xs">
                        <th className="py-2 px-3">Queue</th>
                        <th className="py-2 px-3">Statut</th>
                        <th className="py-2 px-3 text-right">En attente</th>
                        <th className="py-2 px-3 text-right">Actifs</th>
                        <th className="py-2 px-3 text-right">Échoués</th>
                        <th className="py-2 px-3 text-right">Complétés</th>
                        <th className="py-2 px-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queues.map((q: any, i: number) => {
                        const d = q.detail ?? {};
                        const queueName = q.name.replace('Queue: ', '');
                        return (
                          <tr key={i} className="border-b">
                            <td className="py-2 px-3 font-medium">{queueName}</td>
                            <td className="py-2 px-3">{statusBadge(q.status)}</td>
                            <td className="py-2 px-3 text-right">{d.waiting ?? 0}</td>
                            <td className="py-2 px-3 text-right">{d.active ?? 0}</td>
                            <td className="py-2 px-3 text-right font-semibold text-red-600">{d.failed ?? 0}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">{d.completed ?? 0}</td>
                            <td className="py-2 px-3">
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!d.failed || retrying === queueName}
                                  onClick={() => handleRetry(queueName)}>
                                  {retrying === queueName ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                                  Retry
                                </Button>
                                <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={!d.failed || flushing === queueName}
                                  onClick={() => handleFlush(queueName)}>
                                  {flushing === queueName ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                                  Flush
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Repair & Maintenance ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Réparation & Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Aggregation repair */}
          <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
            <div className="text-sm font-medium flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" /> Ré-agrégation
            </div>
            <p className="text-xs text-muted-foreground">Re-calcule acrel_agg_15m et acrel_agg_daily depuis les readings bruts pour la période sélectionnée.</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">Du</Label>
                <Input type="date" className="h-8 w-40" value={aggFrom} onChange={e => setAggFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Au</Label>
                <Input type="date" className="h-8 w-40" value={aggTo} onChange={e => setAggTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              </div>
              <Button size="sm" variant="outline"
                disabled={!aggFrom || !aggTo || repairLoading === 'reaggregate'}
                onClick={() => runRepair('reaggregate', () => api.repairAggregations({ from: new Date(aggFrom).toISOString(), to: new Date(aggTo).toISOString() }))}
              >
                {repairLoading === 'reaggregate' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
                Lancer la ré-agrégation
              </Button>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Vider jobs échoués
              </div>
              <p className="text-xs text-muted-foreground">Supprime définitivement tous les jobs échoués.</p>
              <Button size="sm" variant="destructive" className="w-full text-xs"
                disabled={repairLoading === 'flush'}
                onClick={() => {
                  setFlushConfirmText('');
                  setFlushConfirmOpen(true);
                }}
              >
                {repairLoading === 'flush' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Vider
              </Button>
            </div>

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

      <ConfirmActionDialog
        open={flushConfirmOpen}
        onOpenChange={(open) => {
          setFlushConfirmOpen(open);
          if (!open) setFlushConfirmText('');
        }}
        title="Vider les jobs échoués"
        description="Tous les jobs échoués de la file telemetry seront supprimés définitivement."
        confirmLabel={repairLoading === 'flush' ? 'Suppression...' : 'Vider'}
        cancelLabel="Annuler"
        requiredKeyword={requiredFlushKeyword}
        confirmText={flushConfirmText}
        onConfirmTextChange={setFlushConfirmText}
        onConfirm={async () => {
          await runRepair('flush', () => api.flushFailedJobs('telemetry'));
          setFlushConfirmOpen(false);
          setFlushConfirmText('');
        }}
        busy={repairLoading === 'flush'}
        destructive
      />
    </div>
  );
}
