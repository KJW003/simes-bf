# Widget Engine – Architecture V1

## Overview

The SIMES widget engine turns **WidgetDefinition** (registry) + **WidgetConfig** (user choices) into **ResolvedWidgetData** that inline renderers consume. Everything is config-driven: changing `config.metrics` or `config.dataSource` immediately re-resolves data and re-renders.

## Key types (`src/types/widget-engine.ts`)

| Type | Purpose |
|------|---------|
| `WidgetDefinition` | Immutable registry entry: id, title, icon, resolver function, configSchema, supportedSizes |
| `WidgetConfig` | Per-instance user config: `dataSource`, `metrics[]`, `display.multiMetricMode`, `timeRange` |
| `WidgetLayoutItem` | Persisted layout slot: instanceId, definitionId, size, pinned, config |
| `ResolvedWidgetData` | Output of resolver: `{ kpis, series, availableMetrics, meta }` |
| `MetricKey` | Union of all metric identifiers: `P`, `Q`, `S`, `V`, `I`, `PF`, `THD`, `Freq`, `Energy` |
| `WidgetResolverContext` | Ambient context passed to all resolvers: `{ terrainId }` |

## Data flow

```
WidgetDefinition.resolver(config, ctx) → ResolvedWidgetData
                                            ├── kpis: Record<string, number>
                                            ├── series: Record<MetricKey, {ts,value}[]>
                                            ├── availableMetrics: MetricKey[]
                                            └── meta: Record<string, unknown>
```

1. **WidgetBoard** renders each `WidgetLayoutItem`.
2. Per widget card, a `useMemo` calls `def.resolver(item.config, resolverCtx)`.
3. The resulting `ResolvedWidgetData` is passed to `renderWidgetContent()`.
4. For `energy-quality-summary` and `live-load`, the `MultiMetricWidget` component handles TABS / SMALL_MULTIPLES display mode.

## Registry (`src/lib/widget-registry.ts`)

Six definitions in V1:

| ID | Category | Default metrics |
|----|----------|-----------------|
| `energy-quality-summary` | quality | P, PF, THD, Energy |
| `live-load` | load | P |
| `cost-energy` | cost | Energy |
| `diagnostics` | diagnostics | – |
| `active-alerts` | alerts | – |
| `forecast` | forecast | P |

### Resolver helpers

- `resolvePoints(config, ctx)` – returns point IDs for POINT / ZONE_AGG / TERRAIN_AGG / CATEGORY_AGG source types.
- `resolveSeriesForConfig(config, ctx)` – resolves time series per metric, aggregating when needed.

## MultiMetricWidget behaviour

- **TABS mode** (default): shows a KPI strip for all metrics, a tab bar, and the active metric's chart. Tab clicks use `stopPropagation()` + `preventDefault()` to avoid dragging/card-click conflicts.
- **SMALL_MULTIPLES mode**: when size is `lg`, displays a grid of small charts for each metric simultaneously.
- **Reset on config change**: `activeTab` resets to 0 when the metrics array changes (tracked via `metricsKey` string comparison).
- **No data placeholder**: if `data.length === 0` for a metric, a dashed bordered box with "Aucune donnée disponible" is shown.

## Layout persistence

- Storage key: `simes_widget_layout_v4_<userId>` (version bumped on schema changes).
- Saved to `localStorage` on every layout mutation.
- "Réinitialiser" clears stored layout and rebuilds default.
- Dragging reorders items; pinning sorts pinned items first.

## Adding a new widget type

1. Add a `WidgetDefinition` to `widget-registry.ts` with:
   - Unique `id`
   - `resolver(config, ctx) → ResolvedWidgetData`
   - `configSchema` with `defaultConfig` and `metricOptions`
2. Add a `case` in `renderWidgetContent()` in WidgetBoard.
3. The widget will automatically appear in the library dialog.
