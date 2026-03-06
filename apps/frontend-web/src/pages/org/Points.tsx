import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Activity, ExternalLink, Loader2, Eye, AlertTriangle,
} from 'lucide-react';
import { useTerrainOverview, useReadings } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';
const fmtDT = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Points() {
  const { selectedTerrainId, selectedTerrain } = useAppContext();
  const { data, isLoading, isError } = useTerrainOverview(selectedTerrainId);
  const [filter, setFilter] = useState<string>('_all');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  // Fetch recent readings for the selected point
  const readingsFrom = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const { data: pointReadings } = useReadings(
    selectedPointId ? selectedTerrainId : null,
    selectedPointId ? { point_id: selectedPointId, from: readingsFrom, limit: 50 } : undefined,
  );

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description="Sélectionnez un terrain"
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un terrain dans la barre supérieure pour voir les points.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description={selectedTerrain?.name ?? 'Terrain'}
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card>
          <CardContent className="py-6 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Points de mesure"
          description={selectedTerrain?.name ?? 'Terrain'}
          breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
        />
        <Card className="border-red-200 bg-red-50/30">
          <CardContent className="py-6 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <span className="text-sm text-red-700">Erreur lors du chargement des points</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const points = (data?.points ?? []) as Array<Record<string, unknown>>;
  const zones = (data?.zones ?? []) as Array<Record<string, unknown>>;
  const categories = [...new Set(points.map(p => String((p as any).measure_category ?? 'autre')))];
  const filteredPoints = filter === '_all' ? points : points.filter(p => String((p as any).measure_category) === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Points de mesure"
        description={selectedTerrain?.name ?? 'Terrain'}
        breadcrumbs={[{ label: 'Accueil', href: '/' }, { label: 'Points' }]}
      />

      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Affichage {filteredPoints.length} / {points.length} points
        </h3>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Filtrer par catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Toutes les catégories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Grid of point cards */}
      {filteredPoints.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun point de mesure trouvé.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredPoints.map(p => {
            const r = (p as any).readings as Record<string, unknown> | null;
            const lastSeen = (p as any).lastSeen as string | null;
            const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;
            const stale = minutesAgo != null && minutesAgo > 30;
            const alarm = r?.alarm_state != null ? Number(r.alarm_state) : 0;
            const pf = r?.power_factor_total != null ? Number(r.power_factor_total) : null;
            const zoneName = zones.find(z => String(z.id) === String((p as any).zone_id))?.name as string | undefined;

            return (
              <Card
                key={String(p.id)}
                className={cn(
                  'transition-all hover:shadow-md cursor-pointer',
                  alarm > 0 && 'border-red-300 bg-red-50/30',
                  stale && !alarm && 'border-amber-200 bg-amber-50/20',
                )}
                onClick={() => !alarm && !stale ? null : null}
              >
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        alarm > 0 ? 'bg-red-500 animate-pulse' : (r && !stale) ? 'bg-emerald-500' : stale ? 'bg-amber-400' : 'bg-gray-300'
                      )} />
                      <CardTitle className="text-sm font-medium truncate">{String(p.name)}</CardTitle>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setSelectedPointId(String(p.id)); }}>
                      <Eye className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1">{String((p as any).measure_category ?? '—')}</Badge>
                    {zoneName && <span className="text-[10px] text-muted-foreground">Zone: {zoneName}</span>}
                    {minutesAgo != null && <span className={cn('text-[10px]', stale && 'text-amber-600 font-medium')}>il y a {minutesAgo} min</span>}
                  </div>
                </CardHeader>

                {r && (
                  <CardContent className="px-4 pb-3 pt-1">
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">P</span>
                        <span className="mono font-medium">{fmt(r.active_power_total, 1)} W</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Va / Vb / Vc</span>
                        <span className="mono font-medium">{fmt(r.voltage_a, 0)} / {fmt(r.voltage_b, 0)} / {fmt(r.voltage_c, 0)} V</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ia / Ib / Ic</span>
                        <span className="mono font-medium">{fmt(r.current_a, 1)} / {fmt(r.current_b, 1)} / {fmt(r.current_c, 1)} A</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PF</span>
                        <span className={cn('mono font-medium', pf != null && pf < 0.85 && 'text-amber-600')}>{fmt(r.power_factor_total, 3)}</span>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <PointDetailModal
        point={selectedPointId ? filteredPoints.find(p => String(p.id) === selectedPointId) ?? null : null}
        readings={(pointReadings as any)?.readings ?? []}
        zones={zones}
        onClose={() => setSelectedPointId(null)}
      />
    </div>
  );
}

function PointDetailModal({
  point,
  readings,
  zones,
  onClose,
}: {
  point: Record<string, unknown> | null;
  readings: Array<Record<string, unknown>>;
  zones: Array<Record<string, unknown>>;
  onClose: () => void;
}) {
  if (!point) return null;

  const r = (point as any).readings as Record<string, unknown> | null;
  const zoneName = zones.find(z => String(z.id) === String((point as any).zone_id))?.name as string | undefined;
  const lastSeen = (point as any).lastSeen as string | null;
  const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : null;

  const fields: Array<{ label: string; value: string; unit?: string; warn?: boolean }> = r ? [
    { label: 'P totale', value: fmt(r.active_power_total, 1), unit: 'W' },
    { label: 'Q totale', value: fmt(r.reactive_power_total, 1), unit: 'var' },
    { label: 'S totale', value: fmt(r.apparent_power_total, 1), unit: 'VA' },
    { label: 'P phase A', value: fmt(r.active_power_a, 1), unit: 'W' },
    { label: 'P phase B', value: fmt(r.active_power_b, 1), unit: 'W' },
    { label: 'P phase C', value: fmt(r.active_power_c, 1), unit: 'W' },
    { label: 'Tension A', value: fmt(r.voltage_a, 1), unit: 'V' },
    { label: 'Tension B', value: fmt(r.voltage_b, 1), unit: 'V' },
    { label: 'Tension C', value: fmt(r.voltage_c, 1), unit: 'V' },
    { label: 'Courant A', value: fmt(r.current_a, 2), unit: 'A' },
    { label: 'Courant B', value: fmt(r.current_b, 2), unit: 'A' },
    { label: 'Courant C', value: fmt(r.current_c, 2), unit: 'A' },
    { label: 'Facteur de puissance', value: fmt(r.power_factor_total, 3), warn: r.power_factor_total != null && Number(r.power_factor_total) < 0.85 },
    { label: 'THD courant A', value: fmt(r.thdi_a, 1), unit: '%' },
    { label: 'THD courant B', value: fmt(r.thdi_b, 1), unit: '%' },
    { label: 'THD courant C', value: fmt(r.thdi_c, 1), unit: '%' },
    { label: 'Énergie import', value: fmt(r.energy_import, 1), unit: 'kWh' },
    { label: 'Énergie export', value: fmt(r.energy_export, 1), unit: 'kWh' },
  ] : [];

  const histCols = ['time', 'active_power_total', 'voltage_a', 'voltage_b', 'voltage_c', 'current_a', 'current_b', 'current_c', 'power_factor_total', 'energy_import'] as const;
  const histLabels: Record<string, string> = {
    time: 'Heure', active_power_total: 'P (W)', voltage_a: 'Va', voltage_b: 'Vb', voltage_c: 'Vc',
    current_a: 'Ia', current_b: 'Ib', current_c: 'Ic', power_factor_total: 'PF', energy_import: 'E imp',
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            {String(point.name)}
            <Badge variant="outline" className="text-[10px] ml-2">{String((point as any).measure_category ?? '—')}</Badge>
            {zoneName && <span className="text-sm text-muted-foreground font-normal">— Zone: {zoneName}</span>}
          </DialogTitle>
          <DialogDescription className="sr-only">Détail du point de mesure</DialogDescription>
        </DialogHeader>

        {/* Metadata */}
        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
          {minutesAgo != null && <span>Dernière donnée: il y a {minutesAgo} min</span>}
          {(point as any).device && <span>Appareil: {String((point as any).device)}</span>}
          {(point as any).modbus_addr != null && <span>Modbus: {String((point as any).modbus_addr)}</span>}
        </div>

        {/* Current values grid */}
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-2">
          {fields.filter(f => f.value !== '—').map(f => (
            <div key={f.label} className="rounded-lg border p-2">
              <div className="text-[10px] text-muted-foreground">{f.label}</div>
              <div className={cn('text-sm font-semibold mono', f.warn && 'text-amber-600')}>
                {f.value} {f.unit && <span className="text-[10px] text-muted-foreground font-normal">{f.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Previous packets table */}
        <div className="mt-4">
          <h4 className="text-sm font-semibold mb-2">Paquets récents ({readings.length})</h4>
          {readings.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">Aucun paquet disponible</div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto border rounded-md">
              <table className="text-xs w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    {histCols.map(c => <th key={c} className="px-2 py-1.5 text-left font-medium">{histLabels[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {readings.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/20">
                      {histCols.map(c => (
                        <td key={c} className="px-2 py-1 mono">
                          {c === 'time' ? fmtDT(String(row[c])) : fmt(row[c], c === 'power_factor_total' ? 3 : c === 'active_power_total' || c === 'energy_import' ? 1 : 1)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Link to point detail page */}
        <div className="flex justify-end mt-2">
          <Link to={`/points/${String(point.id)}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="w-3 h-3 mr-1" /> Voir page complète
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
