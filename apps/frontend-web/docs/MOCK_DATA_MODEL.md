# Mock Data Model – V1

## Overview

`src/lib/mock-data.ts` is the single source of truth for all mock entities and time series used throughout the SIMES UI. It uses a seeded PRNG for deterministic generation.

## Entity hierarchy

```
Organisation (org_1 "ISGE")
  └── Site (site_1 "Campus Principal")
       └── Terrain (terrain_1 "Bâtiment Énergie")
            ├── Gateway: "Milesight-ISGE-01"
            ├── Zone: zone_admin "Administration"
            │    └── Points: point_grid (GRID), point_eclairage (LOAD)
            ├── Zone: zone_tp "Salles de TP"
            │    └── Points: point_clim (LOAD), point_prises (LOAD)
            └── Zone: zone_serveur "Salle Serveur"
                 └── Points: point_serveur (LOAD), point_pv (PV),
                              point_battery (BATTERY), point_unknown (UNKNOWN)
```

## Measurement points (`mockMeasurementPoints`)

| ID | Name | Category | Zone |
|----|------|----------|------|
| point_grid | Compteur Général | GRID | Administration |
| point_serveur | Onduleur Serveur | LOAD | Salle Serveur |
| point_clim | Climatisation TP | LOAD | Salles de TP |
| point_eclairage | Éclairage Admin | LOAD | Administration |
| point_prises | Prises TP | LOAD | Salles de TP |
| point_pv | Panneaux PV | PV | Salle Serveur |
| point_battery | Batterie Li-Ion | BATTERY | Salle Serveur |
| point_unknown | Capteur inconnu | UNKNOWN | Salle Serveur |

Each point has:
- `metrics`: `totalActivePower`, `averagePowerFactor`, `phaseA/B/C` (V, I, P, Q, S, PF, THD, harmonics)
- `status`: ok / warning / critical / offline
- `dataQuality`: excellent / good / fair / poor
- `lastSeen`: ISO timestamp

## Time series generation

`generateTimeSeries(pointId, metric, points = 1440)` produces 24h of 1-minute resolution data.

Profiles:
- **PV**: solar bell curve, zero at night
- **BATTERY**: charge/discharge daily cycle
- **LOAD (all others)**: baseload + daily usage pattern with random noise

## Aggregation functions

| Function | Signature | Logic |
|----------|-----------|-------|
| `aggregateZone(zoneId, metric)` | `→ {ts, value}[]` | Sum all zone point series for power metrics; average for PF/THD/V/Freq |
| `aggregateTerrain(terrainId, metric)` | `→ {ts, value}[]` | Sum/avg across all terrain points |
| `aggregateCategory(terrainId, category, metric)` | `→ {ts, value}[]` | Filter by category then sum/avg |
| `aggregatePointSet(pointIds[], metric)` | `→ {ts, value}[]` | Arbitrary point set aggregation |
| `aggregatePointSeries(seriesArray)` | Low-level sum helper |

### Sum vs Average rule

Summed: `P`, `Q`, `S`, `Energy`, `I`
Averaged: `PF`, `V`, `THD`, `Freq`

## Helper exports

- `getPointsByTerrainId(id)` → points within terrain
- `getPointsByZoneId(id)` → points within zone
- `getZonesByTerrainId(id)` → zones within terrain
- `getZonePointIds(zoneId)` → point ID array for a zone
- `getPointSeries(pointId, metric)` → raw time series
- `mockPvAudit` → PV audit data (used by Solaire page)

## Design rules

1. **Points are atomic** — only points produce measurements.
2. **Zones are organizational** — they group points but do not measure.
3. **Aggregation is always explicit** — computed from contained points, labeled as such.
4. **Deterministic** — seeded PRNG ensures same data on every load.
