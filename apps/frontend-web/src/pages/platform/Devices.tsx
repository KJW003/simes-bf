import React, { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Cpu, Search, AlertTriangle, RefreshCw, Radio } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGateways, useGatewayDevices } from '@/hooks/useApi';

export default function Devices() {
  const [search, setSearch] = useState('');
  const [selectedGw, setSelectedGw] = useState<string>('');

  const { data: gwData, isLoading: loadingGw } = useGateways();
  const gateways = ((gwData?.gateways ?? []) as Array<Record<string, unknown>>);
  const mappedGateways = gateways.filter(g => !!g.terrain_id);

  const { data: devData, isLoading: loadingDevs, refetch: refetchDevs } = useGatewayDevices(selectedGw || null);
  const devices = ((devData?.devices ?? []) as Array<Record<string, unknown>>);

  const total = devices.length;
  const mapped = devices.filter(d => d.mapped).length;
  const unmapped = total - mapped;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return devices;
    return devices.filter(d =>
      String(d.device_key ?? '').toLowerCase().includes(q) ||
      String(d.dev_eui ?? '').toLowerCase().includes(q) ||
      String(d.modbus_addr ?? '').includes(q)
    );
  }, [devices, search]);

  return (
    <div className="space-y-6">
      <PageHeader title="Appareils" description="Tous les appareils découverts par concentrateur" />

      {/* Gateway selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Concentrateur</label>
          <Select value={selectedGw} onValueChange={setSelectedGw}>
            <SelectTrigger className="w-72"><SelectValue placeholder={loadingGw ? 'Chargement…' : 'Choisir un concentrateur'} /></SelectTrigger>
            <SelectContent>
              {mappedGateways.map(gw => {
                const id = String(gw.gateway_id ?? '');
                return <SelectItem key={id} value={id}>{id} — {String(gw.terrain_name ?? '?')}</SelectItem>;
              })}
              {gateways.filter(g => !g.terrain_id).map(gw => {
                const id = String(gw.gateway_id ?? '');
                return <SelectItem key={id} value={id}>{id} (non mappé)</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        {selectedGw && (
          <Button variant="outline" size="sm" className="mt-5" onClick={() => refetchDevs()}>
            <RefreshCw className="w-4 h-4 mr-2" />Rafraîchir
          </Button>
        )}
      </div>

      {selectedGw && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-stagger-children">
            <KpiCard label="Total appareils" value={total} icon={<Cpu className="w-4 h-4" />} />
            <KpiCard label="Non mappés" value={unmapped} icon={<AlertTriangle className="w-4 h-4" />} variant={unmapped > 0 ? 'warning' : 'default'} />
            <KpiCard label="Mappés" value={mapped} icon={<Cpu className="w-4 h-4" />} variant="success" />
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher device key, Modbus, DevEUI…"
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingDevs ? (
                <div className="p-6 text-sm text-muted-foreground animate-pulse">Chargement des appareils…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {devices.length === 0 ? 'Aucun appareil découvert pour ce concentrateur.' : 'Aucun résultat pour la recherche.'}
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <th>Device Key</th>
                      <th>Modbus</th>
                      <th>DevEUI</th>
                      <th className="text-center">Messages</th>
                      <th>Première vue</th>
                      <th>Dernière vue</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(d => {
                      const dk = String(d.device_key ?? '');
                      return (
                        <tr key={dk}>
                          <td className="mono text-xs font-medium">{dk}</td>
                          <td className="text-sm">{d.modbus_addr != null ? String(d.modbus_addr) : '—'}</td>
                          <td className="mono text-xs">{d.dev_eui ? String(d.dev_eui) : '—'}</td>
                          <td className="text-sm text-center">{String(d.msg_count ?? '—')}</td>
                          <td className="text-xs text-muted-foreground">{d.first_seen ? new Date(String(d.first_seen)).toLocaleString('fr-FR') : '—'}</td>
                          <td className="text-xs text-muted-foreground">{d.last_seen ? new Date(String(d.last_seen)).toLocaleString('fr-FR') : '—'}</td>
                          <td>
                            <Badge variant="outline" className={cn('text-[10px]', d.mapped ? 'badge-ok' : 'badge-warning')}>
                              {d.mapped ? '✓ Mappé' : 'Non mappé'}
                            </Badge>
                            {d.point_id && <div className="text-[9px] text-muted-foreground mt-0.5 font-mono">→ {String(d.point_id).slice(0, 8)}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!selectedGw && !loadingGw && (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Radio className="w-10 h-10 text-muted-foreground mx-auto" />
            <div className="text-sm text-muted-foreground">
              {gateways.length === 0
                ? 'Aucun concentrateur détecté. Les appareils apparaissent après la première réception de données.'
                : 'Sélectionnez un concentrateur pour voir ses appareils.'}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
