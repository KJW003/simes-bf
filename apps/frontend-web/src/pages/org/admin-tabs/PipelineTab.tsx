// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Pipeline Health & Queue Management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  RefreshCw, Trash2, Activity, Play, Loader2,
  Wrench, Database, Server,
} from "lucide-react";
import { usePipelineHealth } from "@/hooks/useApi";
import api from "@/lib/api";

export default function PipelineTab() {
  const { data: health, isLoading, refetch } = usePipelineHealth();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [flushing, setFlushing] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairFrom, setRepairFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [repairTo, setRepairTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Purge state
  const [purging, setPurging] = useState(false);
  const [purgeFrom, setPurgeFrom] = useState('');
  const [purgeTo, setPurgeTo] = useState('');
  const [purgeIncludeReadings, setPurgeIncludeReadings] = useState(true);
  const [purgeResult, setPurgeResult] = useState<{ deleted: { readings: number; agg_15m: number; agg_daily: number } } | null>(null);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  const components = health?.components ?? [];
  const queues = components.filter((c: any) => c.name.startsWith('Queue:'));
  const infra = components.filter((c: any) => !c.name.startsWith('Queue:'));

  const statusColor = (s: string) => {
    if (s === 'up') return 'bg-green-500';
    if (s === 'degraded' || s === 'warning') return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const statusBadge = (s: string) => {
    if (s === 'up') return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">{s}</Badge>;
    if (s === 'degraded' || s === 'warning') return <Badge variant="outline" className="border-yellow-500 text-yellow-700">{s}</Badge>;
    return <Badge variant="destructive">{s}</Badge>;
  };

  const handleRetry = useCallback(async (queue: string) => {
    setRetrying(queue);
    try {
      const res = await api.retryFailedJobs(queue);
      toast.success(`${res.retried} jobs retried on ${queue}`);
      refetch();
    } catch { toast.error('Retry failed'); }
    setRetrying(null);
  }, [refetch]);

  const handleFlush = useCallback(async (queue: string) => {
    setFlushing(queue);
    try {
      const res = await api.flushFailedJobs(queue);
      toast.success(`${res.removed} failed jobs removed from ${queue}`);
      refetch();
    } catch { toast.error('Flush failed'); }
    setFlushing(null);
  }, [refetch]);

  const handleRepair = useCallback(async () => {
    setRepairing(true);
    try {
      const res = await api.repairAggregations({ from: new Date(repairFrom).toISOString(), to: new Date(repairTo).toISOString() });
      toast.success(res.message || 'Aggregation repair queued');
      refetch();
    } catch { toast.error('Repair failed'); }
    setRepairing(false);
  }, [repairFrom, repairTo, refetch]);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    setPurgeResult(null);
    try {
      const res = await api.purgeByRange({ from: purgeFrom, to: purgeTo, includeReadings: purgeIncludeReadings });
      setPurgeResult(res);
      toast.success(`Supprimé: ${res.deleted.readings} readings, ${res.deleted.agg_15m} agg15m, ${res.deleted.agg_daily} daily`);
    } catch { toast.error('Purge failed'); }
    setPurging(false);
    setPurgeConfirmOpen(false);
  }, [purgeFrom, purgeTo, purgeIncludeReadings]);

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Infrastructure Status */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4" /> Infrastructure</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{health?.checked_at ? new Date(health.checked_at).toLocaleString('fr-FR') : ''}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Actualiser</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {infra.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                <div className={`w-2.5 h-2.5 rounded-full ${statusColor(c.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {typeof c.detail === 'object' ? (
                      c.detail.readings_last_hour !== undefined
                        ? `${c.detail.readings_last_hour} readings/h`
                        : JSON.stringify(c.detail)
                    ) : String(c.detail ?? '')}
                    {c.latency_ms != null && ` · ${c.latency_ms}ms`}
                  </div>
                </div>
                {statusBadge(c.status)}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Queue Management */}
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

      {/* Repair Aggregations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Wrench className="w-4 h-4" /> Réparation des agrégations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Re-calcule acrel_agg_15m et acrel_agg_daily depuis les readings bruts pour la période sélectionnée.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Du</Label>
              <Input type="date" className="h-8 w-40" value={repairFrom} onChange={e => setRepairFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Au</Label>
              <Input type="date" className="h-8 w-40" value={repairTo} onChange={e => setRepairTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </div>
            <Button size="sm" onClick={handleRepair} disabled={repairing}>
              {repairing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Database className="w-3.5 h-3.5 mr-1" />}
              Lancer la réparation
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Purge Data */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400"><Trash2 className="w-4 h-4" /> Purge de données (globale)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Supprime définitivement les agrégations et/ou readings bruts pour la période sélectionnée —
            <strong> toutes les organisations, tous les sites, tous les points</strong>.
            Pour une purge ciblée par point, utilisez <em>Purge en masse</em> dans le menu latéral.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Du</Label>
              <Input type="date" className="h-8 w-40" value={purgeFrom} onChange={e => setPurgeFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Au</Label>
              <Input type="date" className="h-8 w-40" value={purgeTo} onChange={e => setPurgeTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={purgeIncludeReadings} onCheckedChange={setPurgeIncludeReadings} id="purge-readings" />
              <Label htmlFor="purge-readings" className="text-xs">Inclure readings bruts</Label>
            </div>
            <Button size="sm" variant="destructive" onClick={() => setPurgeConfirmOpen(true)} disabled={purging || !purgeFrom || !purgeTo}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Purger
            </Button>
          </div>
          {purgeResult && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs">
              <span className="font-semibold">Résultat :</span> {purgeResult.deleted.readings} readings, {purgeResult.deleted.agg_15m} agg_15m, {purgeResult.deleted.agg_daily} agg_daily supprimés
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purge confirmation dialog */}
      <Dialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Vous allez supprimer {purgeIncludeReadings ? 'les readings bruts + ' : ''}les agrégations (15m et daily) du <strong>{purgeFrom}</strong> au <strong>{purgeTo}</strong> pour <strong>tous les points de toutes les organisations</strong>. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button variant="destructive" onClick={handlePurge} disabled={purging}>
              {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              Confirmer la purge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
