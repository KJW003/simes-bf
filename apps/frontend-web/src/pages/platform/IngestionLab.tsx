import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useDeleteIncoming,
  useGatewayDevices,
  useGateways,
  useIncoming,
  useProvisionGateway,
  useReconcileIncoming,
  useReplayIncoming,
} from '@/hooks/useApi';
import api from '@/lib/api';
import { toast } from 'sonner';
import { AlertTriangle, Beaker, Loader2, RefreshCw, Wrench } from 'lucide-react';

const ALL_GATEWAYS = '__all_gateways__';
const NO_DEVICE = '__no_device__';

const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function IngestionLab() {
  const [selectedGateway, setSelectedGateway] = useState<string>(ALL_GATEWAYS);
  const [selectedDevice, setSelectedDevice] = useState<string>(NO_DEVICE);
  const [incomingStatusFilter, setIncomingStatusFilter] = useState<string>('all');
  const [incomingDeviceFilter, setIncomingDeviceFilter] = useState('');
  const [incomingFrom, setIncomingFrom] = useState('');
  const [incomingTo, setIncomingTo] = useState('');
  const [incomingPage, setIncomingPage] = useState(1);
  const incomingPageSize = 50;

  const incomingParams = useMemo(
    () => (selectedGateway === ALL_GATEWAYS ? undefined : { gateway_id: selectedGateway }),
    [selectedGateway],
  );

  const { data: incomingData, isLoading, refetch } = useIncoming(incomingParams);
  const { data: gatewaysData } = useGateways();
  const { data: gatewayDevicesData, isLoading: devicesLoading, refetch: refetchDevices } = useGatewayDevices(
    selectedGateway === ALL_GATEWAYS ? null : selectedGateway,
  );
  const provisionGatewayMut = useProvisionGateway();
  const reconcileMut = useReconcileIncoming();
  const replayMut = useReplayIncoming();
  const deleteMut = useDeleteIncoming();

  const [processingUnmapped, setProcessingUnmapped] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [processingHistorical, setProcessingHistorical] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [sandboxGateway, setSandboxGateway] = useState('sandbox-gw');
  const [sandboxTopic, setSandboxTopic] = useState('sandbox/topic');
  const [sandboxModbus, setSandboxModbus] = useState('1');
  const [sandboxDevEui, setSandboxDevEui] = useState('A1B2C3D4E5F6A7B8');

  const [manualTerrainId, setManualTerrainId] = useState('');
  const [manualDeviceKey, setManualDeviceKey] = useState('');

  const [cleanupLogs, setCleanupLogs] = useState<string[]>([]);
  const [schedulerLogs, setSchedulerLogs] = useState<string[]>([]);
  const [incomingAction, setIncomingAction] = useState<
    | {
      type: 'replay' | 'delete';
      rowId: string;
      gatewayId: string;
      deviceKey: string;
      receivedAt: string;
    }
    | null
  >(null);
  const [incomingConfirmText, setIncomingConfirmText] = useState('');
  const [incomingActionError, setIncomingActionError] = useState<string | null>(null);
  const [replayingRowId, setReplayingRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const gateways = useMemo(
    () =>
      (gatewaysData?.gateways ?? []) as Array<{
        gateway_id: string;
        terrain_id?: string | null;
        terrain_name?: string | null;
        site_name?: string | null;
        org_name?: string | null;
      }>,
    [gatewaysData],
  );

  const selectedGatewayRow = useMemo(
    () => gateways.find((g) => g.gateway_id === selectedGateway) ?? null,
    [gateways, selectedGateway],
  );

  const selectedTerrainId = selectedGatewayRow?.terrain_id ? String(selectedGatewayRow.terrain_id) : '';

  const gatewayDevices = useMemo(
    () =>
      (gatewayDevicesData?.devices ?? []) as Array<{
        device_key: string;
        mapped?: boolean;
        point_id?: string | null;
        msg_count?: number;
      }>,
    [gatewayDevicesData],
  );

  useEffect(() => {
    setSelectedDevice(NO_DEVICE);
  }, [selectedGateway]);

  const rows = useMemo(() => (incomingData?.rows ?? []) as Array<Record<string, unknown>>, [incomingData]);

  const filteredIncomingRows = useMemo(() => {
    return rows.filter((r) => {
      const status = String(r.status ?? '');
      const device = String(r.device_key ?? '');
      const receivedAt = String(r.received_at ?? '');

      if (incomingStatusFilter !== 'all' && status !== incomingStatusFilter) return false;
      if (incomingDeviceFilter.trim() && !device.toLowerCase().includes(incomingDeviceFilter.trim().toLowerCase())) return false;

      if (incomingFrom) {
        const fromDate = new Date(incomingFrom);
        if (!Number.isNaN(fromDate.getTime()) && new Date(receivedAt) < fromDate) return false;
      }

      if (incomingTo) {
        const toDate = new Date(incomingTo);
        toDate.setHours(23, 59, 59, 999);
        if (!Number.isNaN(toDate.getTime()) && new Date(receivedAt) > toDate) return false;
      }

      return true;
    });
  }, [rows, incomingStatusFilter, incomingDeviceFilter, incomingFrom, incomingTo]);

  const totalIncomingPages = Math.max(1, Math.ceil(filteredIncomingRows.length / incomingPageSize));
  const paginatedIncomingRows = useMemo(() => {
    const start = (incomingPage - 1) * incomingPageSize;
    return filteredIncomingRows.slice(start, start + incomingPageSize);
  }, [filteredIncomingRows, incomingPage]);

  useEffect(() => {
    setIncomingPage(1);
  }, [incomingStatusFilter, incomingDeviceFilter, incomingFrom, incomingTo, selectedGateway]);

  useEffect(() => {
    if (incomingPage > totalIncomingPages) {
      setIncomingPage(totalIncomingPages);
    }
  }, [incomingPage, totalIncomingPages]);

  const handleInjectSandbox = async () => {
    setInjecting(true);
    try {
      const addr = Number(sandboxModbus);
      await api.postSandboxIncoming({
        topic: sandboxTopic,
        gateway_id: sandboxGateway,
        modbus_addr: Number.isFinite(addr) ? addr : null,
        dev_eui: sandboxDevEui || null,
        source: { mode: 'platform_lab' },
        metrics: {
          voltage_a: 229.5,
          current_a: 8.3,
          active_power_total: 1.88,
          energy_import: 12345.67,
        },
      });
      toast.success('Message sandbox injecté');
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Échec de l\'injection sandbox');
    }
    setInjecting(false);
  };

  const handleReconcile = async () => {
    try {
      const result = await reconcileMut.mutateAsync();
      const mapped = (result as any)?.reconciled_mapped ?? 0;
      const unmapped = (result as any)?.reconciled_unmapped ?? 0;
      toast.success(`Réconciliation terminée: ${mapped} mappés, ${unmapped} non mappés`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Échec de la réconciliation');
    }
  };

  const handleProcessUnmapped = async () => {
    setProcessingUnmapped(true);
    try {
      const result = await api.processUnmappedIncoming();
      toast.success(`Reprocess terminé: ${result.enqueued}/${result.processed} traités`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Échec du reprocess des non mappés');
    }
    setProcessingUnmapped(false);
  };

  const handleProcessHistorical = async () => {
    const terrainId = selectedTerrainId || manualTerrainId.trim();
    const deviceKey = selectedDevice !== NO_DEVICE ? selectedDevice : manualDeviceKey.trim();

    if (!terrainId || !deviceKey) {
      toast.error('terrain_id et device_key sont requis');
      return;
    }
    setProcessingHistorical(true);
    try {
      const result = await api.processHistoricalMessages(terrainId.trim(), deviceKey.trim());
      const sum = result.summary;
      if (sum) {
        toast.success(`Historique traité: ${sum.processed}/${sum.total} (échecs ${sum.failed})`);
      } else {
        toast.success(result.message || 'Traitement historique terminé');
      }
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Échec du traitement historique');
    }
    setProcessingHistorical(false);
  };

  const handleProvisionGateway = async () => {
    if (selectedGateway === ALL_GATEWAYS) {
      toast.error('Sélectionnez une passerelle pour auto-provisionner');
      return;
    }
    try {
      const result = await provisionGatewayMut.mutateAsync(selectedGateway);
      const summary = (result as any)?.summary;
      const devicesFound = summary?.devices_found ?? 0;
      const created = summary?.points_created ?? 0;
      toast.success(`Provision terminée: ${created} points créés (${devicesFound} appareils détectés)`);
      refetch();
      refetchDevices();
    } catch (e: any) {
      toast.error(e?.message || 'Échec de l\'auto-provisionnement de la passerelle');
    }
  };

  const handleLoadLogs = async () => {
    setLoadingLogs(true);
    try {
      const [cleanup, scheduler] = await Promise.all([
        api.getCleanupLogs(80),
        api.getSchedulerLogs(80),
      ]);
      setCleanupLogs(cleanup.logs ?? []);
      setSchedulerLogs(scheduler.logs ?? []);
      toast.success('Logs techniques chargés');
    } catch {
      toast.error('Impossible de charger les logs techniques');
    }
    setLoadingLogs(false);
  };

  const openIncomingAction = (action: NonNullable<typeof incomingAction>) => {
    setIncomingConfirmText('');
    setIncomingActionError(null);
    setIncomingAction(action);
  };

  const closeIncomingAction = () => {
    setIncomingConfirmText('');
    setIncomingActionError(null);
    setIncomingAction(null);
  };

  const requiredIncomingKeyword = incomingAction?.type === 'delete' ? 'CONFIRM-DELETE' : incomingAction?.type === 'replay' ? 'CONFIRM-REPLAY' : '';
  const canConfirmIncomingAction = requiredIncomingKeyword !== '' && incomingConfirmText.trim().toUpperCase() === requiredIncomingKeyword;

  const executeIncomingAction = async () => {
    if (!incomingAction) return;

    setIncomingActionError(null);
    try {
      if (incomingAction.type === 'replay') {
        setReplayingRowId(incomingAction.rowId);
        await replayMut.mutateAsync(incomingAction.rowId);
        toast.success('Message rejoué');
      } else {
        setDeletingRowId(incomingAction.rowId);
        await deleteMut.mutateAsync(incomingAction.rowId);
        toast.success('Message supprimé');
      }
      refetch();
      closeIncomingAction();
    } catch (e: any) {
      setIncomingActionError(e?.message || 'Opération impossible');
    } finally {
      setReplayingRowId(null);
      setDeletingRowId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Ingestion Lab"
        description="Operations superadmin pour diagnostic ingestion, mapping et reprise historique"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Actualiser
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Beaker className="w-4 h-4" /> Sandbox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">Gateway</Label>
              <Input className="h-8 text-xs" value={sandboxGateway} onChange={(e) => setSandboxGateway(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Topic</Label>
              <Input className="h-8 text-xs" value={sandboxTopic} onChange={(e) => setSandboxTopic(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Modbus addr</Label>
                <Input className="h-8 text-xs" value={sandboxModbus} onChange={(e) => setSandboxModbus(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">DevEUI</Label>
                <Input className="h-8 text-xs" value={sandboxDevEui} onChange={(e) => setSandboxDevEui(e.target.value)} />
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={handleInjectSandbox} disabled={injecting}>
              {injecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Injecter un message test
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Wrench className="w-4 h-4" /> Reparation ingestion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-2 border rounded-md p-2">
              <Label className="text-xs">Gateway cible</Label>
              <Select value={selectedGateway} onValueChange={setSelectedGateway}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choisir un gateway" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GATEWAYS}>Tous les gateways</SelectItem>
                  {gateways.map((g) => (
                    <SelectItem key={g.gateway_id} value={g.gateway_id}>
                      {g.gateway_id} {g.terrain_name ? `• ${g.terrain_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGatewayRow ? (
                <div className="text-[11px] text-muted-foreground">
                  Terrain: {selectedGatewayRow.terrain_name || '—'} ({selectedTerrainId || 'non mappe'})
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">Aucune passerelle sélectionnée</div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleProvisionGateway}
                disabled={selectedGateway === ALL_GATEWAYS || provisionGatewayMut.isPending}
              >
                {provisionGatewayMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Auto-provisionner ce gateway
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleReconcile}
              disabled={reconcileMut.isPending}
            >
              {reconcileMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Reconcile mapping incoming
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleProcessUnmapped}
              disabled={processingUnmapped}
            >
              {processingUnmapped ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Reprocess unmapped
            </Button>
            <div className="border rounded-md p-2 space-y-2">
              <Label className="text-xs">Process historique (guide)</Label>
              <Select value={selectedDevice} onValueChange={setSelectedDevice} disabled={selectedGateway === ALL_GATEWAYS || devicesLoading}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choisir un device detecte" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEVICE}>Selection manuelle</SelectItem>
                  {gatewayDevices.map((d) => (
                    <SelectItem key={d.device_key} value={d.device_key}>
                      {d.device_key} {d.mapped ? '• mapped' : '• unmapped'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDevice === NO_DEVICE && (
                <>
                  <Input
                    className="h-8 text-xs"
                    placeholder="terrain_id (fallback manuel)"
                    value={manualTerrainId}
                    onChange={(e) => setManualTerrainId(e.target.value)}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="device_key (fallback manuel)"
                    value={manualDeviceKey}
                    onChange={(e) => setManualDeviceKey(e.target.value)}
                  />
                </>
              )}
              <Button size="sm" className="w-full" onClick={handleProcessHistorical} disabled={processingHistorical}>
                {processingHistorical ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Traiter historique device
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Logs techniques</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={handleLoadLogs} disabled={loadingLogs}>
              {loadingLogs ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Charger cleanup + scheduler
            </Button>
            <div className="text-xs text-muted-foreground">
              Affiche les derniers logs backend de maintenance pour debogage rapide.
            </div>
            <Badge variant="outline">cleanup: {cleanupLogs.length}</Badge>
            <Badge variant="outline" className="ml-2">scheduler: {schedulerLogs.length}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Incoming messages recents ({paginatedIncomingRows.length}/{filteredIncomingRows.length} affiches, total source {rows.length})
            {selectedGateway !== ALL_GATEWAYS ? ` • filtre gateway ${selectedGateway}` : ''}
          </CardTitle>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-2">
            <Select value={incomingStatusFilter} onValueChange={setIncomingStatusFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="mapped">mapped</SelectItem>
                <SelectItem value="unmapped">unmapped</SelectItem>
                <SelectItem value="ignored">ignored</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 text-xs"
              value={incomingDeviceFilter}
              onChange={(e) => setIncomingDeviceFilter(e.target.value)}
              placeholder="Filtre device_key"
            />
            <Input
              className="h-8 text-xs"
              type="date"
              value={incomingFrom}
              onChange={(e) => setIncomingFrom(e.target.value)}
            />
            <Input
              className="h-8 text-xs"
              type="date"
              value={incomingTo}
              onChange={(e) => setIncomingTo(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : filteredIncomingRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Aucun message entrant</div>
          ) : (
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="data-table text-xs w-full">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="bg-muted/50">
                    <th className="py-2 px-2">Heure</th>
                    <th className="py-2 px-2">Gateway</th>
                    <th className="py-2 px-2">Device</th>
                    <th className="py-2 px-2">Statut</th>
                    <th className="py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedIncomingRows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-1.5 px-2 whitespace-nowrap">{fmtDate(r.received_at)}</td>
                      <td className="py-1.5 px-2">{String(r.gateway_id ?? '—')}</td>
                      <td className="py-1.5 px-2 font-mono text-xs">{String(r.device_key ?? '—')}</td>
                      <td className="py-1.5 px-2"><Badge variant="outline">{String(r.status ?? '—')}</Badge></td>
                      <td className="py-1.5 px-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => openIncomingAction({
                              type: 'replay',
                              rowId: String(r.id),
                              gatewayId: String(r.gateway_id ?? '—'),
                              deviceKey: String(r.device_key ?? '—'),
                              receivedAt: String(r.received_at ?? ''),
                            })}
                            disabled={replayingRowId === String(r.id) || deletingRowId === String(r.id)}
                          >
                            {replayingRowId === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Replay
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => openIncomingAction({
                              type: 'delete',
                              rowId: String(r.id),
                              gatewayId: String(r.gateway_id ?? '—'),
                              deviceKey: String(r.device_key ?? '—'),
                              receivedAt: String(r.received_at ?? ''),
                            })}
                            disabled={replayingRowId === String(r.id) || deletingRowId === String(r.id)}
                          >
                            {deletingRowId === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Supprimer
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && filteredIncomingRows.length > 0 && (
            <div className="flex items-center justify-between gap-2 mt-3 text-xs">
              <span className="text-muted-foreground">
                Page {incomingPage}/{totalIncomingPages} • {paginatedIncomingRows.length} lignes sur {filteredIncomingRows.length} filtrées
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setIncomingPage((p) => Math.max(1, p - 1))}
                  disabled={incomingPage <= 1}
                >
                  Précédent
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setIncomingPage((p) => Math.min(totalIncomingPages, p + 1))}
                  disabled={incomingPage >= totalIncomingPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dumps logs</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="cleanup" className="w-full">
            <TabsList>
              <TabsTrigger value="cleanup">cleanup.log</TabsTrigger>
              <TabsTrigger value="scheduler">scheduler.log</TabsTrigger>
            </TabsList>
            <TabsContent value="cleanup" className="mt-3">
              <pre className="text-xs p-3 rounded-md bg-muted/40 max-h-[260px] overflow-auto whitespace-pre-wrap">{cleanupLogs.join('\n') || 'Aucune entrée chargée'}</pre>
            </TabsContent>
            <TabsContent value="scheduler" className="mt-3">
              <pre className="text-xs p-3 rounded-md bg-muted/40 max-h-[260px] overflow-auto whitespace-pre-wrap">{schedulerLogs.join('\n') || 'Aucune entrée chargée'}</pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={!!incomingAction} onOpenChange={(open) => { if (!open) closeIncomingAction(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              {incomingAction?.type === 'delete' ? 'Confirmer la suppression' : 'Confirmer le replay'}
            </DialogTitle>
            <DialogDescription>
              {incomingAction?.type === 'delete'
                ? 'Cette action supprime définitivement le message incoming sélectionné.'
                : 'Cette action rejoue le message vers le pipeline d\'ingestion.'}
            </DialogDescription>
          </DialogHeader>

          {incomingAction && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Message ID</span>
                <span className="font-mono">{incomingAction.rowId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gateway</span>
                <span className="font-medium">{incomingAction.gatewayId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Device</span>
                <span className="font-mono text-xs">{incomingAction.deviceKey}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Heure</span>
                <span className="font-medium">{fmtDate(incomingAction.receivedAt)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              Tapez <strong>{requiredIncomingKeyword}</strong> pour confirmer
            </Label>
            <Input
              value={incomingConfirmText}
              onChange={(e) => setIncomingConfirmText(e.target.value)}
              placeholder={requiredIncomingKeyword}
            />
            <p className="text-[11px] text-muted-foreground">
              Format attendu: <strong>{requiredIncomingKeyword}</strong>
            </p>
            {incomingActionError && <p className="text-xs text-red-600">{incomingActionError}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeIncomingAction} disabled={!!replayingRowId || !!deletingRowId}>Annuler</Button>
            <Button
              variant={incomingAction?.type === 'delete' ? 'destructive' : 'default'}
              onClick={executeIncomingAction}
              disabled={!canConfirmIncomingAction || !!replayingRowId || !!deletingRowId}
            >
              {(!!replayingRowId || !!deletingRowId) && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
