import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Map, Radio, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLatestReadings } from '@/hooks/useApi';

/** Format a numeric value for display, handling nulls */
const fmt = (v: any, decimals = 2) => v != null && v !== '' ? Number(v).toFixed(decimals) : '—';
const fmtInt = (v: any) => v != null && v !== '' ? Math.round(Number(v)).toString() : '—';

function LiveReadingsPanel({ terrainId }: { terrainId: string }) {
  const { data, isLoading, isError } = useLatestReadings(terrainId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground animate-pulse">
          Chargement des lectures temps réel...
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.count === 0) return null;

  const toMinutesAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          Lectures temps réel ({data.count} points)
        </CardTitle>
        <Badge variant="outline" className="text-[10px] badge-ok">API Live</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="data-table text-xs w-full">
            <thead>
              <tr className="bg-muted/50">
                <th className="py-2 px-2"></th>
                <th className="py-2 px-2">Point</th>
                <th className="py-2 px-2">Catégorie</th>
                <th className="py-2 px-2 text-right">P (kW)</th>
                <th className="py-2 px-2 text-right">Q (kVAR)</th>
                <th className="py-2 px-2 text-right">S (kVA)</th>
                <th className="py-2 px-2 text-right">PF</th>
                <th className="py-2 px-2 text-right">Va (V)</th>
                <th className="py-2 px-2 text-right">Vb (V)</th>
                <th className="py-2 px-2 text-right">Vc (V)</th>
                <th className="py-2 px-2 text-right">Ia (A)</th>
                <th className="py-2 px-2 text-right">Ib (A)</th>
                <th className="py-2 px-2 text-right">Ic (A)</th>
                <th className="py-2 px-2 text-right">E imp (kWh)</th>
                <th className="py-2 px-2 text-right">E exp (kWh)</th>
                <th className="py-2 px-2 text-right">Dernière vue</th>
              </tr>
            </thead>
            <tbody>
              {data.readings.map((r: any) => {
                const isExpanded = expanded === r.point_id;
                return (
                  <React.Fragment key={r.point_id}>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="py-1.5 px-2">
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setExpanded(isExpanded ? null : r.point_id)}>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </Button>
                      </td>
                      <td className="py-1.5 px-2 font-medium">{r.point?.name ?? r.point_id.slice(0, 8)}</td>
                      <td className="py-1.5 px-2"><Badge variant="outline" className="text-[9px]">{r.point?.measure_category ?? '-'}</Badge></td>
                      <td className="py-1.5 px-2 text-right mono font-medium">{fmt(r.active_power_total)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.reactive_power_total)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.apparent_power_total)}</td>
                      <td className={cn('py-1.5 px-2 text-right mono', r.power_factor_total != null && Number(r.power_factor_total) < 0.85 && 'text-severity-warning font-medium')}>
                        {fmt(r.power_factor_total)}
                      </td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.voltage_a, 1)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.voltage_b, 1)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.voltage_c, 1)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.current_a)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.current_b)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.current_c)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.energy_import, 1)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmt(r.energy_export, 1)}</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{toMinutesAgo(r.time)} min</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={17} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1">Puissances détaillées</div>
                            <div>Pa: <span className="mono">{fmt(r.active_power_a)} kW</span></div>
                            <div>Pb: <span className="mono">{fmt(r.active_power_b)} kW</span></div>
                            <div>Pc: <span className="mono">{fmt(r.active_power_c)} kW</span></div>
                            <div>P total: <span className="mono font-medium">{fmt(r.active_power_total)} kW</span></div>
                            <div>Qa: <span className="mono">{fmt(r.reactive_power_a)} kVAR</span></div>
                            <div>Qb: <span className="mono">{fmt(r.reactive_power_b)} kVAR</span></div>
                            <div>Qc: <span className="mono">{fmt(r.reactive_power_c)} kVAR</span></div>
                            <div>Q total: <span className="mono">{fmt(r.reactive_power_total)} kVAR</span></div>
                            <div>Sa: <span className="mono">{fmt(r.apparent_power_a)} kVA</span></div>
                            <div>Sb: <span className="mono">{fmt(r.apparent_power_b)} kVA</span></div>
                            <div>Sc: <span className="mono">{fmt(r.apparent_power_c)} kVA</span></div>
                            <div>S total: <span className="mono">{fmt(r.apparent_power_total)} kVA</span></div>

                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Tensions</div>
                            <div>Va: <span className="mono">{fmt(r.voltage_a, 1)} V</span></div>
                            <div>Vb: <span className="mono">{fmt(r.voltage_b, 1)} V</span></div>
                            <div>Vc: <span className="mono">{fmt(r.voltage_c, 1)} V</span></div>
                            <div>Vab: <span className="mono">{fmt(r.voltage_ab, 1)} V</span></div>
                            <div>Vbc: <span className="mono">{fmt(r.voltage_bc, 1)} V</span></div>
                            <div>Vca: <span className="mono">{fmt(r.voltage_ca, 1)} V</span></div>
                            {r.voltage_unbalance != null && <div>Déséq. V: <span className="mono">{fmt(r.voltage_unbalance, 1)} %</span></div>}

                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Courants</div>
                            <div>Ia: <span className="mono">{fmt(r.current_a)} A</span></div>
                            <div>Ib: <span className="mono">{fmt(r.current_b)} A</span></div>
                            <div>Ic: <span className="mono">{fmt(r.current_c)} A</span></div>
                            {r.current_sum != null && <div>I somme: <span className="mono">{fmt(r.current_sum)} A</span></div>}
                            {r.aftercurrent != null && <div>I résiduel: <span className="mono">{fmt(r.aftercurrent)} mA</span></div>}
                            {r.current_unbalance != null && <div>Déséq. I: <span className="mono">{fmt(r.current_unbalance, 1)} %</span></div>}

                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Facteurs de puissance</div>
                            <div>PFa: <span className="mono">{fmt(r.power_factor_a)}</span></div>
                            <div>PFb: <span className="mono">{fmt(r.power_factor_b)}</span></div>
                            <div>PFc: <span className="mono">{fmt(r.power_factor_c)}</span></div>
                            <div>PF total: <span className={cn("mono font-medium", r.power_factor_total != null && Number(r.power_factor_total) < 0.85 && "text-severity-warning")}>{fmt(r.power_factor_total)}</span></div>

                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Énergies</div>
                            <div>Import totale: <span className="mono">{fmt(r.energy_import, 1)} kWh</span></div>
                            <div>Export totale: <span className="mono">{fmt(r.energy_export, 1)} kWh</span></div>
                            <div>Énergie totale: <span className="mono">{fmt(r.energy_total, 1)} kWh</span></div>
                            {r.reactive_energy_import != null && <div>Q import: <span className="mono">{fmt(r.reactive_energy_import, 1)} kVARh</span></div>}
                            {r.reactive_energy_export != null && <div>Q export: <span className="mono">{fmt(r.reactive_energy_export, 1)} kVARh</span></div>}

                            {(r.energy_spike != null || r.energy_peak != null || r.energy_flat != null || r.energy_valley != null) && (
                              <>
                                <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Tranches SONABEL</div>
                                {r.energy_spike != null && <div>Pointe: <span className="mono">{fmt(r.energy_spike, 1)} kWh</span></div>}
                                {r.energy_peak != null && <div>Heures pleines: <span className="mono">{fmt(r.energy_peak, 1)} kWh</span></div>}
                                {r.energy_flat != null && <div>Heures creuses: <span className="mono">{fmt(r.energy_flat, 1)} kWh</span></div>}
                                {r.energy_valley != null && <div>Nuit: <span className="mono">{fmt(r.energy_valley, 1)} kWh</span></div>}
                              </>
                            )}

                            {(r.thdu_a != null || r.thdi_a != null) && (
                              <>
                                <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Harmoniques (THD)</div>
                                {r.thdu_a != null && <div>THDu A: <span className="mono">{fmt(r.thdu_a, 1)} %</span></div>}
                                {r.thdu_b != null && <div>THDu B: <span className="mono">{fmt(r.thdu_b, 1)} %</span></div>}
                                {r.thdu_c != null && <div>THDu C: <span className="mono">{fmt(r.thdu_c, 1)} %</span></div>}
                                {r.thdi_a != null && <div>THDi A: <span className="mono">{fmt(r.thdi_a, 1)} %</span></div>}
                                {r.thdi_b != null && <div>THDi B: <span className="mono">{fmt(r.thdi_b, 1)} %</span></div>}
                                {r.thdi_c != null && <div>THDi C: <span className="mono">{fmt(r.thdi_c, 1)} %</span></div>}
                              </>
                            )}

                            {(r.temp_a != null || r.temp_b != null || r.temp_c != null || r.temp_n != null) && (
                              <>
                                <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Températures</div>
                                {r.temp_a != null && <div>Temp A: <span className="mono">{fmt(r.temp_a, 1)} °C</span></div>}
                                {r.temp_b != null && <div>Temp B: <span className="mono">{fmt(r.temp_b, 1)} °C</span></div>}
                                {r.temp_c != null && <div>Temp C: <span className="mono">{fmt(r.temp_c, 1)} °C</span></div>}
                                {r.temp_n != null && <div>Temp N: <span className="mono">{fmt(r.temp_n, 1)} °C</span></div>}
                              </>
                            )}

                            <div className="font-medium text-muted-foreground col-span-full border-b pb-1 mb-1 mt-2">Radio / Transmission</div>
                            {r.rssi_lora != null && <div>RSSI LoRa: <span className="mono">{fmtInt(r.rssi_lora)} dBm</span></div>}
                            {r.rssi_gateway != null && <div>RSSI GW: <span className="mono">{fmtInt(r.rssi_gateway)} dBm</span></div>}
                            {r.point?.modbus_addr != null && <div>Modbus Addr: <span className="mono">{r.point.modbus_addr}</span></div>}
                            {r.point?.device && <div>Appareil: <span className="mono">{r.point.device}</span></div>}
                            {r.point?.ct_ratio != null && Number(r.point.ct_ratio) !== 1 && (
                              <div>Ratio TC: <span className="mono font-medium">{r.point.ct_ratio}</span></div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DataMonitor() {
  const { selectedTerrain } = useAppContext();

  return (
    <div className="space-y-6">
      <PageHeader
        title={"Terrain - " + (selectedTerrain?.name ?? 'Non selectionne')}
        description={"Concentrateur " + (selectedTerrain?.gatewayId ?? '-')}
      />

      {selectedTerrain && <LiveReadingsPanel terrainId={selectedTerrain.id} />}

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Map className="w-4 h-4" />
            Plan du terrain (zones)
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 flex flex-col items-center text-center space-y-2">
          <Map className="w-6 h-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Vue zone necessite les endpoints GET /zones et GET /points par terrain.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}