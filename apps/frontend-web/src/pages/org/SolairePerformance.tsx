import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sun, Zap, AlertTriangle, TrendingUp, Calculator, Gauge, Settings,
  ArrowRight, Clock, Cpu, BarChart3, Activity,
} from 'lucide-react';
import {
  usePvSystems, usePoints, useDashboard,
  usePvTerrainProduction, usePvSystemProduction,
} from '@/hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const fmt = (v: unknown, d = 2) => v != null && v !== '' ? Number(v).toFixed(d) : '—';

export default function SolairePerformance() {
  const { selectedTerrainId } = useAppContext();
  const { data: systems = [] } = usePvSystems(selectedTerrainId);
  const { data: points = [] } = usePoints(selectedTerrainId);
  const { data: dashData } = useDashboard(selectedTerrainId);

  const [days, setDays] = useState(30);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);

  // Terrain-level production
  const { data: terrainProd, isLoading: terrainLoading } = usePvTerrainProduction(selectedTerrainId, days);
  // Per-system production (when a system is selected)
  const { data: systemProd, isLoading: systemLoading } = usePvSystemProduction(selectedSystemId, days);

  // Filter PV points
  const pvPoints = useMemo(
    () => points.filter(p => p.measure_category === 'PV'),
    [points]
  );

  // Group by system
  const systemsWithPoints = useMemo(
    () => systems.map(sys => ({
      ...sys,
      points: pvPoints.filter(p => p.pv_system_id === sys.id),
    })).filter(s => s.points.length > 0),
    [systems, pvPoints]
  );

  // Unassigned PV points
  const unassignedPvPoints = useMemo(
    () => pvPoints.filter(p => !p.pv_system_id),
    [pvPoints]
  );

  // Global PV power (from all PV points)
  const totalPvPowerNow = useMemo(
    () => pvPoints.reduce((s, p) => s + (p.readings?.active_power_total || 0), 0),
    [pvPoints]
  );

  // Chart data formatting
  const terrainChartData = useMemo(
    () => (terrainProd?.data || []).map(d => ({
      day: new Date(d.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      total_kwh: Number(d.total_kwh.toFixed(1)),
      export_kwh: Number(d.export_kwh.toFixed(1)),
    })),
    [terrainProd]
  );

  const systemChartData = useMemo(
    () => (systemProd?.data || []).map(d => ({
      day: new Date(d.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      total_kwh: Number(d.total_kwh.toFixed(1)),
      export_kwh: Number(d.export_kwh.toFixed(1)),
      peak_power_kw: Number(d.peak_power_kw.toFixed(2)),
    })),
    [systemProd]
  );

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance Solaire" description="Suivi des installations PV réelles" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Sélectionnez un terrain.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Performance Solaire"
        description="Suivi des performances réelles des systèmes et points PV"
        actions={
          <div className="flex items-center gap-2">
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 jours</SelectItem>
                <SelectItem value="30">30 jours</SelectItem>
                <SelectItem value="90">90 jours</SelectItem>
                <SelectItem value="365">365 jours</SelectItem>
              </SelectContent>
            </Select>
            <Link to="/org/predimensionnement">
              <Button variant="outline" size="sm">
                <Calculator className="w-4 h-4 mr-1" />
                Prédimensionnement
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>
        }
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Points PV détectés"
          value={String(pvPoints.length)}
          icon={<Cpu className="w-4 h-4" />}
        />
        <KpiCard
          label="Systèmes configurés"
          value={String(systemsWithPoints.length)}
          icon={<Sun className="w-4 h-4 text-amber-500" />}
        />
        <KpiCard
          label="Puissance PV actuelle"
          value={fmt(totalPvPowerNow, 1)}
          unit="kW"
          icon={<Zap className="w-4 h-4 text-yellow-500" />}
        />
        <KpiCard
          label={`Production (${days}j)`}
          value={terrainProd ? fmt(terrainProd.summary.total_production_kwh, 1) : '—'}
          unit="kWh"
          icon={<TrendingUp className="w-4 h-4 text-green-500" />}
        />
      </div>

      {/* Terrain Production Summary */}
      {terrainProd && terrainProd.summary.total_production_kwh > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Capacité installée"
            value={terrainProd.total_capacity_kwc ? fmt(terrainProd.total_capacity_kwc, 1) : '—'}
            unit="kWc"
            icon={<Sun className="w-4 h-4" />}
          />
          <KpiCard
            label="Moy. journalière"
            value={fmt(terrainProd.summary.avg_daily_kwh, 1)}
            unit="kWh/j"
            icon={<Activity className="w-4 h-4" />}
          />
          <KpiCard
            label="Rendement spécifique"
            value={terrainProd.summary.specific_yield != null ? fmt(terrainProd.summary.specific_yield, 1) : '—'}
            unit="kWh/kWc"
            icon={<Gauge className="w-4 h-4" />}
          />
          <KpiCard
            label="Jours avec données"
            value={String(terrainProd.days_with_data)}
            unit={`/ ${days}`}
            icon={<BarChart3 className="w-4 h-4" />}
          />
        </div>
      )}

      {/* Terrain Production Chart */}
      {terrainChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-500" />
              Production PV — Terrain ({days} jours)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={terrainChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit=" kWh" />
                <Tooltip />
                <Legend />
                <Bar dataKey="total_kwh" name="Production totale" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="export_kwh" name="Export" fill="#10b981" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-System Drill-Down */}
      {systemsWithPoints.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-500" />
                Détail par Système
              </CardTitle>
              <Select
                value={selectedSystemId || ''}
                onValueChange={v => setSelectedSystemId(v || null)}
              >
                <SelectTrigger className="w-[220px] h-8 text-xs">
                  <SelectValue placeholder="Sélectionner un système" />
                </SelectTrigger>
                <SelectContent>
                  {systemsWithPoints.map(sys => (
                    <SelectItem key={sys.id} value={sys.id}>{sys.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {!selectedSystemId ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sélectionnez un système pour voir ses performances détaillées.
              </p>
            ) : systemLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Chargement...</p>
            ) : systemProd ? (
              <div className="space-y-4">
                {/* System KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">Production totale</p>
                    <p className="text-lg font-semibold">{fmt(systemProd.summary.total_production_kwh, 1)} <span className="text-xs font-normal">kWh</span></p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">Export</p>
                    <p className="text-lg font-semibold">{fmt(systemProd.summary.total_export_kwh, 1)} <span className="text-xs font-normal">kWh</span></p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">Puissance crête</p>
                    <p className="text-lg font-semibold">{fmt(systemProd.summary.peak_power_kw, 2)} <span className="text-xs font-normal">kW</span></p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">Ratio perf.</p>
                    <p className="text-lg font-semibold">
                      {systemProd.summary.performance_ratio != null ? `${systemProd.summary.performance_ratio}%` : '—'}
                    </p>
                  </div>
                </div>

                {/* System Chart */}
                {systemChartData.length > 0 && (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={systemChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} unit=" kWh" />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total_kwh" name="Production" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="export_kwh" name="Export" fill="#10b981" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Aucune donnée de production.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Systems Overview */}
      {systemsWithPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" />
              Systèmes PV ({systemsWithPoints.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemsWithPoints.map(sys => {
                const sysPower = sys.points.reduce((s, p) => s + (p.readings?.active_power_total || 0), 0);
                const sysCapacity = sys.installed_capacity_kwc || 0;
                const efficiency = sysCapacity > 0 ? ((sysPower / sysCapacity) * 100) : 0;

                return (
                  <div key={sys.id} className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/30 transition">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-medium">{sys.name}</p>
                        {sys.location && <Badge variant="outline" className="text-xs">{sys.location}</Badge>}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => setSelectedSystemId(sys.id)}
                        >
                          Voir détails
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs">Puissance</p>
                          <p className="font-medium">{fmt(sysPower, 2)} kW</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Capacité</p>
                          <p className="font-medium">{sys.installed_capacity_kwc || '—'} kWc</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Efficacité</p>
                          <p className="font-medium">{fmt(efficiency, 1)}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Points</p>
                          <p className="font-medium">{sys.points.length}</p>
                        </div>
                      </div>

                      {sys.expected_tilt_degrees && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Inclinaison: {sys.expected_tilt_degrees}° {sys.expected_orientation || ''}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* PV Points Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="w-4 h-4" />
            Points de Mesure PV ({pvPoints.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pvPoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun point PV détecté sur ce terrain.</p>
          ) : (
            <div className="space-y-3">
              {pvPoints.map(pt => {
                const system = systems.find(s => s.id === pt.pv_system_id);
                const power = pt.readings?.active_power_total || 0;

                return (
                  <div key={pt.id} className="flex items-start justify-between p-3 border rounded">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{pt.name}</p>
                        {system && <Badge variant="secondary" className="text-xs">{system.name}</Badge>}
                        {!system && <Badge variant="outline" className="text-xs">Non assigné</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{pt.device}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{fmt(power, 2)} kW</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        Actuel
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status & Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">État & Alertes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pvPoints.length === 0 ? (
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-900">Aucun point PV détecté</p>
                  <p className="text-xs text-amber-800">Configurer des points de mesure avec la catégorie "PV" pour débuter le suivi.</p>
                </div>
              </div>
            ) : (
              <>
                {unassignedPvPoints.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                    <Zap className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-blue-900">{unassignedPvPoints.length} point(s) PV non assigné(s)</p>
                      <p className="text-xs text-blue-800">Assignez ces points à un système dans l'Administration pour un suivi structuré.</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded text-sm">
                  <TrendingUp className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-green-900">Suivi des performances actif</p>
                    <p className="text-xs text-green-800">Données de production en temps réel et historiques disponibles.</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Informations
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-900">
          <p className="mb-2">Ce module affiche les <strong>performances réelles</strong> mesurées par vos points PV.</p>
          <p className="mb-2">Pour dimensionner une nouvelle installation solaire, utilisez le module <strong>Prédimensionnement</strong> qui propose 4 méthodes de calcul.</p>
          <p>Pour un suivi plus détaillé, assignez vos points PV à des systèmes dans l'Administration.</p>
        </CardContent>
      </Card>
    </div>
  );
}
