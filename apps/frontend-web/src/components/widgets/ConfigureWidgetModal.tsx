// ============================================================
// Configure Widget Modal
// When adding or editing a widget's config: pick data source,
// metrics, multi-metric mode, and save.
// ============================================================

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type {
  WidgetConfig,
  DataSourceType,
  MetricKey,
  MultiMetricMode,
  TimeRangeValue,
  ScopeType,
} from '@/types/widget-engine';
import {
  METRIC_LABELS,
  METRIC_SUB_COLUMNS,
  ENERGY_SOURCE_LABELS,
  type EnergySourceCategory,
  type WidgetConfigSchema,
} from '@/types/widget-engine';
import { useAppContext } from '@/contexts/AppContext';

interface ConfigureWidgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetTitle: string;
  configSchema: WidgetConfigSchema;
  initialConfig?: Partial<WidgetConfig>;
  onSave: (config: WidgetConfig) => void;
  /** Real points from overview API */
  points?: Array<Record<string, unknown>>;
  /** Real zones from overview API */
  zones?: Array<Record<string, unknown>>;
}

const DATA_SOURCE_LABELS: Record<DataSourceType, string> = {
  POINT: 'Point de mesure',
  ZONE_AGG: 'Zone (agrégé)',
  TERRAIN_AGG: 'Terrain (agrégé)',
  CATEGORY_AGG: 'Catégorie source',
};

const SCOPE_LABELS: Record<ScopeType, string> = {
  ORG: 'Organisation',
  SITE: 'Site',
  TERRAIN: 'Terrain',
  ZONE: 'Zone',
  POINT: 'Point',
  CATEGORY: 'Catégorie',
};

const CATEGORY_KEYS: EnergySourceCategory[] = ['LOAD', 'GRID', 'PV', 'GENSET', 'BATTERY'];

const CATEGORY_DESCRIPTIONS: Record<EnergySourceCategory, string> = {
  LOAD: 'Charges uniquement (consommation)',
  GRID: 'Réseau électrique (import/export)',
  PV: 'Production solaire',
  GENSET: 'Groupe électrogène',
  BATTERY: 'Stockage batterie',
  UNKNOWN: 'Non identifié',
};

const TIME_RANGE_OPTIONS: { key: TimeRangeValue; label: string }[] = [
  { key: '1D', label: '1 jour' },
  { key: '7D', label: '7 jours' },
  { key: '1M', label: '1 mois' },
  { key: '3M', label: '3 mois' },
  { key: '6M', label: '6 mois' },
  { key: '1Y', label: '1 an' },
];

export function ConfigureWidgetModal({
  open,
  onOpenChange,
  widgetTitle,
  configSchema,
  initialConfig,
  onSave,
  points: pointsProp,
  zones: zonesProp,
}: ConfigureWidgetModalProps) {
  const { selectedTerrainId } = useAppContext();

  // State
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>(
    initialConfig?.dataSource?.type ?? configSchema.allowedDataSources[0] ?? 'POINT'
  );
  const [refId, setRefId] = useState<string>(
    initialConfig?.dataSource?.refId ?? selectedTerrainId ?? ''
  );
  const [categoryFilter, setCategoryFilter] = useState<EnergySourceCategory | ''>(
    initialConfig?.dataSource?.categoryFilter ?? ''
  );
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(
    initialConfig?.metrics ?? configSchema.defaultConfig.metrics ?? []
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    initialConfig?.columns ?? []
  );
  const [multiMetricMode, setMultiMetricMode] = useState<MultiMetricMode>(
    initialConfig?.display?.multiMetricMode ?? 'TABS'
  );
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(
    initialConfig?.timeRange?.value ?? '1M'
  );

  // Derived options — use real points from overview API
  const terrainPoints = useMemo(
    () => (pointsProp ?? []).map(p => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? '—'),
      device: String(p.device ?? ''),
    })),
    [pointsProp]
  );

  const terrainZones = useMemo(
    () => (zonesProp ?? []).map(z => ({
      id: String(z.id ?? ''),
      name: String(z.name ?? '—'),
    })),
    [zonesProp]
  );

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetrics(prev => {
      if (prev.includes(metric)) {
        // Remove metric + its sub-columns
        const subCols = (METRIC_SUB_COLUMNS[metric] ?? []).map(s => s.col);
        setSelectedColumns(c => c.filter(col => !subCols.includes(col)));
        return prev.filter(m => m !== metric);
      }
      // Add metric + auto-select first sub-column
      const subs = METRIC_SUB_COLUMNS[metric] ?? [];
      if (subs.length === 1) {
        setSelectedColumns(c => [...c, subs[0].col]);
      }
      return [...prev, metric];
    });
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const handleSave = () => {
    const scopeType: ScopeType =
      dataSourceType === 'POINT'
        ? 'POINT'
        : dataSourceType === 'ZONE_AGG'
          ? 'ZONE'
          : dataSourceType === 'CATEGORY_AGG'
            ? 'CATEGORY'
            : 'TERRAIN';

    const config: WidgetConfig = {
      scopeType,
      dataSource: {
        type: dataSourceType,
        refId: refId || selectedTerrainId || '',
        ...(dataSourceType === 'CATEGORY_AGG' && categoryFilter
          ? { categoryFilter: categoryFilter as EnergySourceCategory }
          : {}),
      },
      metrics: selectedMetrics,
      columns: selectedColumns,
      timeRange: {
        mode: configSchema.hasTimeRange ? 'WIDGET_MANAGED' : 'FOLLOW_PAGE',
        value: timeRangeValue,
      },
      display: {
        viewMode: selectedMetrics.length > 1 ? 'MIXED' : 'CHART',
        multiMetricMode,
        primaryMetric: selectedMetrics[0],
      },
    };

    onSave(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurer : {widgetTitle}</DialogTitle>
          <DialogDescription className="sr-only">Configuration du widget</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Data Source Type */}
          <div className="space-y-2">
            <Label>Source de données</Label>
            <Select
              value={dataSourceType}
              onValueChange={(v) => {
                setDataSourceType(v as DataSourceType);
                setRefId('');
                setCategoryFilter('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {configSchema.allowedDataSources.map(ds => (
                  <SelectItem key={ds} value={ds}>
                    {DATA_SOURCE_LABELS[ds]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ref selector based on type */}
          {dataSourceType === 'POINT' && (
            <div className="space-y-2">
              <Label>Point de mesure</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un point" />
                </SelectTrigger>
                <SelectContent>
                  {terrainPoints.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.device})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {dataSourceType === 'CATEGORY_AGG' && (
            <div className="space-y-2">
              <Label>Catégorie source d'énergie</Label>
              <p className="text-xs text-muted-foreground">
                Choisir explicitement : Charges (LOAD) pour la conso, ou une source (Réseau, PV, Groupe, Batterie).
              </p>
              <Select
                value={categoryFilter || ''}
                onValueChange={(v) => setCategoryFilter(v as EnergySourceCategory)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une catégorie" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_KEYS.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      <div className="flex flex-col">
                        <span>{ENERGY_SOURCE_LABELS[cat]}</span>
                        <span className="text-[10px] text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Metrics multi-select */}
          {configSchema.supportedMetrics.length > 0 && (
            <div className="space-y-2">
              <Label>Métriques</Label>
              <div className="flex flex-wrap gap-2">
                {configSchema.supportedMetrics.map(metric => {
                  const active = selectedMetrics.includes(metric);
                  return (
                    <button
                      key={metric}
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent'
                      )}
                      onClick={() => toggleMetric(metric)}
                    >
                      <Checkbox
                        checked={active}
                        className="h-3.5 w-3.5 pointer-events-none"
                        tabIndex={-1}
                      />
                      {METRIC_LABELS[metric]}
                    </button>
                  );
                })}
              </div>
              {selectedMetrics.length === 0 && (
                <p className="text-xs text-severity-warning">Sélectionnez au moins une métrique.</p>
              )}
            </div>
          )}

          {/* Sub-metric column selection */}
          {selectedMetrics.length > 0 && (
            <div className="space-y-3">
              <Label>Colonnes spécifiques</Label>
              <p className="text-xs text-muted-foreground">
                Pour chaque métrique, choisissez les grandeurs exactes à afficher.
              </p>
              {selectedMetrics.map(metric => {
                const subs = METRIC_SUB_COLUMNS[metric] ?? [];
                if (subs.length <= 1) return null;
                return (
                  <div key={metric} className="space-y-1">
                    <div className="text-xs font-medium text-foreground">{METRIC_LABELS[metric]}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {subs.map(sub => {
                        const active = selectedColumns.includes(sub.col);
                        return (
                          <button
                            key={sub.col}
                            type="button"
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors',
                              active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-background text-muted-foreground hover:bg-accent'
                            )}
                            onClick={() => toggleColumn(sub.col)}
                          >
                            <Checkbox
                              checked={active}
                              className="h-3 w-3 pointer-events-none"
                              tabIndex={-1}
                            />
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {selectedColumns.length === 0 && selectedMetrics.some(m => (METRIC_SUB_COLUMNS[m]?.length ?? 0) > 1) && (
                <p className="text-xs text-severity-warning">Sélectionnez au moins une colonne spécifique.</p>
              )}
            </div>
          )}

          {/* Multi-metric mode */}
          {configSchema.supportsMultiMetric && selectedMetrics.length > 1 && (
            <div className="space-y-2">
              <Label>Affichage multi-métrique</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={multiMetricMode === 'TABS' ? 'default' : 'outline'}
                  onClick={() => setMultiMetricMode('TABS')}
                >
                  Onglets
                </Button>
                <Button
                  size="sm"
                  variant={multiMetricMode === 'SMALL_MULTIPLES' ? 'default' : 'outline'}
                  onClick={() => setMultiMetricMode('SMALL_MULTIPLES')}
                >
                  Small multiples
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {multiMetricMode === 'TABS'
                  ? 'Un graphique à la fois, navigation par onglets.'
                  : 'Tous les graphiques affichés côte à côte.'}
              </p>
            </div>
          )}

          {/* Time range (if widget-managed) */}
          {configSchema.hasTimeRange && (
            <div className="space-y-2">
              <Label>Plage de temps par défaut</Label>
              <div className="flex flex-wrap gap-1">
                {TIME_RANGE_OPTIONS.map(opt => (
                  <Button
                    key={opt.key}
                    size="sm"
                    variant={timeRangeValue === opt.key ? 'default' : 'ghost'}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTimeRangeValue(opt.key)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              (configSchema.supportedMetrics.length > 0 && selectedMetrics.length === 0) ||
              (dataSourceType === 'POINT' && !refId) ||
              (dataSourceType === 'CATEGORY_AGG' && !categoryFilter)
            }
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
