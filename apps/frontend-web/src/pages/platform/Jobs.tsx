import React, { useState, useCallback, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useRuns } from '@/hooks/useApi';
import api from '@/lib/api';
import { toast } from 'sonner';
import {
  Play, Send, RefreshCw, Loader2, CheckCircle, XCircle, Clock,
  Activity, Database, HardDrive, Trash2, RotateCcw, AlertTriangle,
} from 'lucide-react';

const JOB_TYPES = [
  { value: 'aggregate', label: 'Agrégation télémétrie', desc: 'Re-calcule 15m + daily' },
  { value: 'forecast', label: 'Entraînement ML (prévisions)', desc: 'Entraîne tous les modèles LightGBM' },
  { value: 'report', label: 'Rapport', desc: 'Génère un rapport PDF' },
  { value: 'facture', label: 'Facture', desc: 'Génère une facture' },
  { value: 'audit-pv', label: 'Audit PV', desc: 'Analyse solaire' },
  { value: 'roi', label: 'ROI', desc: 'Analyse rentabilité' },
  { value: 'disk-recovery', label: 'Récupération disque', desc: 'Trash cleanup + VACUUM FULL' },
] as const;

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

const duration = (start: string | null, end: string | null) => {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export default function Jobs() {
  const { data: runs = [], isLoading, refetch } = useRuns();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string>('aggregate');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [trainingML, setTrainingML] = useState(false);
  const [diskStats, setDiskStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [purgeBatches, setPurgeBatches] = useState<any[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDiskStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await api.getDiskStats();
      setDiskStats(data);
    } catch { toast.error('Impossible de charger les stats disque'); }
    setLoadingStats(false);
  }, []);

  const loadPurgeBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const data = await api.getPurgeBatches();
      setPurgeBatches(data.batches || []);
    } catch { toast.error('Impossible de charger la corbeille'); }
    setLoadingBatches(false);
  }, []);

  const handleRestore = useCallback(async (batchId: string) => {
    setRestoringId(batchId);
    try {
      const res = await api.restorePurgeBatch(batchId);
      toast.success(`Restauré : ${res.restored.readings} readings, ${res.restored.agg_15m} agg 15m, ${res.restored.agg_daily} agg daily`);
      loadPurgeBatches();
      loadDiskStats();
    } catch (e: any) {
      toast.error(e?.message || 'Échec de la restauration');
    }
    setRestoringId(null);
  }, [loadPurgeBatches, loadDiskStats]);

  const handleDeleteTrash = useCallback(async (batchId: string) => {
    if (!window.confirm('Supprimer définitivement ce lot ? Les données ne pourront plus être restaurées.')) return;
    setDeletingId(batchId);
    try {
      await api.deletePurgeBatch(batchId);
      toast.success('Lot supprimé définitivement');
      loadPurgeBatches();
      loadDiskStats();
    } catch { toast.error('Échec de la suppression'); }
    setDeletingId(null);
  }, [loadPurgeBatches, loadDiskStats]);

  useEffect(() => { loadDiskStats(); loadPurgeBatches(); }, [loadDiskStats, loadPurgeBatches]);

  const handleDiskRecovery = useCallback(async () => {
    setRecovering(true);
    try {
      await api.runDiskRecovery({ trash_max_age_days: 7, vacuum: true });
      toast.success('Job de récupération disque mis en file d\'attente — consultez l\'historique des jobs');
      setTimeout(() => { loadDiskStats(); refetch(); }, 3000);
    } catch { toast.error('Échec de la récupération disque'); }
    setRecovering(false);
  }, [loadDiskStats, refetch]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(selectedJob);
    try {
      await api.submitJob(selectedJob);
      toast.success(`Job "${selectedJob}" soumis`);
      setTimeout(() => refetch(), 1500);
    } catch { toast.error('Échec de soumission'); }
    setSubmitting(null);
  }, [selectedJob, refetch]);

  const handleTrainML = useCallback(async () => {
    setTrainingML(true);
    try {
      await api.submitJob('forecast');
      toast.success('Entraînement ML lancé — vérifiez les résultats ci-dessous');
      setTimeout(() => refetch(), 2000);
    } catch { toast.error('Échec du lancement ML'); }
    setTrainingML(false);
  }, [refetch]);

  const statusBadge = (s: string) => {
    switch (s) {
      case 'success': return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"><CheckCircle className="w-3 h-3 mr-1" />Succès</Badge>;
      case 'failed': return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
      case 'running': return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"><Loader2 className="w-3 h-3 mr-1 animate-spin" />En cours</Badge>;
      case 'queued': return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />En file</Badge>;
      default: return <Badge variant="secondary">{s}</Badge>;
    }
  };

  const mlRuns = (runs as any[]).filter((r: any) => r.type === 'forecast' || r.type === 'ai.retrain_forecasts');
  const lastMLRun = mlRuns[0];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Jobs"
        description="Soumission et suivi des jobs (toutes organisations)"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Actualiser
          </Button>
        }
      />

      {/* Submit Job */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Send className="w-4 h-4" /> Lancer un job</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Type de job</Label>
              <Select value={selectedJob} onValueChange={setSelectedJob}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_TYPES.map(j => (
                    <SelectItem key={j.value} value={j.value}>
                      <span className="font-medium">{j.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">— {j.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleSubmit} disabled={!!submitting}>
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Soumettre
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ML Training */}
      <Card className="border-blue-200 dark:border-blue-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" /> Entraînement IA prédictive</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Programmé automatiquement à <strong>03:00</strong> chaque jour. Lance l'entraînement de tous les modèles LightGBM
            sur tous les terrains de toutes les organisations via le service ML.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={handleTrainML} disabled={trainingML}>
              {trainingML ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
              Lancer l'entraînement maintenant
            </Button>
            {lastMLRun ? (
              <div className="text-xs text-muted-foreground">
                Dernier run : {statusBadge(lastMLRun.status)} le {fmtDate(lastMLRun.created_at)}
                {lastMLRun.result?.trained != null && <span className="ml-2">({lastMLRun.result.trained}/{lastMLRun.result.total} modèles)</span>}
                {lastMLRun.error && <span className="ml-2 text-red-600">⚠️ {lastMLRun.error.slice(0, 80)}</span>}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Aucun run ML trouvé dans l'historique</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Corbeille — Restauration */}
      <Card className="border-green-200 dark:border-green-900">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><RotateCcw className="w-4 h-4 text-green-600" /> Corbeille — Restauration de données</CardTitle>
            <Button variant="ghost" size="sm" onClick={loadPurgeBatches} disabled={loadingBatches}>
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBatches ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Les données supprimées par une purge sont conservées ici. Vous pouvez les <strong>restaurer</strong> pour récupérer les mesures supprimées par erreur.
          </p>

          {loadingBatches ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : purgeBatches.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Aucune donnée dans la corbeille</div>
          ) : (
            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 px-2">Supprimé le</th>
                    <th className="py-2 px-2">Période</th>
                    <th className="py-2 px-2 text-right">Readings</th>
                    <th className="py-2 px-2 text-right">Agg 15m</th>
                    <th className="py-2 px-2 text-right">Agg Daily</th>
                    <th className="py-2 px-2">Points</th>
                    <th className="py-2 px-2">Statut</th>
                    <th className="py-2 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purgeBatches.map((b: any) => {
                    const counts = b.counts || {};
                    const isRestored = !!b.restored_at;
                    const totalRows = (counts.readings || 0) + (counts.agg_15m || 0) + (counts.agg_daily || 0);
                    return (
                      <tr key={b.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-2 whitespace-nowrap">{fmtDate(b.deleted_at)}</td>
                        <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">
                          {b.date_from ? new Date(b.date_from).toLocaleDateString('fr-FR') : '∞'}
                          {' → '}
                          {b.date_to ? new Date(b.date_to).toLocaleDateString('fr-FR') : '∞'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{(counts.readings || 0).toLocaleString('fr-FR')}</td>
                        <td className="py-2 px-2 text-right font-mono">{(counts.agg_15m || 0).toLocaleString('fr-FR')}</td>
                        <td className="py-2 px-2 text-right font-mono">{(counts.agg_daily || 0).toLocaleString('fr-FR')}</td>
                        <td className="py-2 px-2">
                          <span className="text-muted-foreground">{b.point_ids?.length || 0} point{(b.point_ids?.length || 0) > 1 ? 's' : ''}</span>
                        </td>
                        <td className="py-2 px-2">
                          {isRestored ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                              <CheckCircle className="w-3 h-3 mr-1" />Restauré
                            </Badge>
                          ) : (
                            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300">
                              <AlertTriangle className="w-3 h-3 mr-1" />En corbeille
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!isRestored && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs bg-green-600 hover:bg-green-700"
                                disabled={restoringId === b.id}
                                onClick={() => handleRestore(b.id)}
                              >
                                {restoringId === b.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                                Restaurer
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              disabled={deletingId === b.id}
                              onClick={() => handleDeleteTrash(b.id)}
                            >
                              {deletingId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </Button>
                          </div>
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

      {/* Disk Recovery */}
      <Card className="border-orange-200 dark:border-orange-900">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><HardDrive className="w-4 h-4 text-orange-600" /> Récupération d'espace disque</CardTitle>
            <Button variant="ghost" size="sm" onClick={loadDiskStats} disabled={loadingStats}>
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Supprime les lots trash &gt; 7 jours puis exécute <strong>VACUUM FULL</strong> sur toutes les tables pour libérer l'espace disque.
            Programmé automatiquement chaque <strong>dimanche à 01:00</strong>.
          </p>

          {diskStats && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">Base de données :</span>
                <Badge variant="outline" className="text-base font-mono">{diskStats.database_size_human}</Badge>
                {diskStats.trash_batches > 0 && (
                  <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300">
                    <Trash2 className="w-3 h-3 mr-1" />{diskStats.trash_batches} lot{diskStats.trash_batches > 1 ? 's' : ''} trash
                  </Badge>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 px-2 text-left">Table</th>
                      <th className="py-1 px-2 text-right">Lignes</th>
                      <th className="py-1 px-2 text-right">Taille</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diskStats.tables?.map((t: any) => (
                      <tr key={t.table} className="border-b hover:bg-muted/50">
                        <td className="py-1 px-2 font-mono">{t.table}</td>
                        <td className="py-1 px-2 text-right">{t.row_count?.toLocaleString('fr-FR')}</td>
                        <td className="py-1 px-2 text-right font-medium">{t.total_human}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="destructive" onClick={handleDiskRecovery} disabled={recovering}>
              {recovering ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <HardDrive className="w-3.5 h-3.5 mr-1" />}
              {recovering ? 'Récupération en cours…' : 'Lancer la récupération maintenant'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Runs Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Historique des jobs (50 derniers)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (runs as any[]).length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Aucun job trouvé</div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Statut</th>
                    <th className="py-2 px-3">Créé</th>
                    <th className="py-2 px-3">Durée</th>
                    <th className="py-2 px-3">Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs as any[]).map((run: any) => (
                    <tr key={run.id} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                      <td className="py-2 px-3 font-medium font-mono text-xs">{run.type}</td>
                      <td className="py-2 px-3">{statusBadge(run.status)}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{fmtDate(run.created_at)}</td>
                      <td className="py-2 px-3 text-xs">{duration(run.started_at, run.finished_at)}</td>
                      <td className="py-2 px-3">
                        {expandedRun === run.id ? (
                          <div className="space-y-1 text-[10px] max-w-md">
                            {run.payload && Object.keys(run.payload).length > 0 && (
                              <div><span className="font-semibold">Payload:</span> <code className="bg-muted px-1 rounded break-all">{JSON.stringify(run.payload)}</code></div>
                            )}
                            {run.result && (
                              <div><span className="font-semibold text-green-700">Result:</span> <code className="bg-muted px-1 rounded break-all">{JSON.stringify(run.result)}</code></div>
                            )}
                            {run.error && (
                              <div><span className="font-semibold text-red-600">Error:</span> <code className="bg-red-50 dark:bg-red-900/20 px-1 rounded break-all">{run.error}</code></div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{run.error ? '⚠️ ' + run.error.slice(0, 60) : run.result ? '✓' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
