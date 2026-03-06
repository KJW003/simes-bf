# Dashboard Widget Engine — Integration

## Architecture

The dashboard integrates a lightweight widget system inspired by **Simes_Ui Widget Engine** but adapted to use actual API endpoints (`useReadings`, `useTerrainOverview`, etc.) instead of mock data.

### Key Principles

1. **Data-driven components** — each widget queries its own data via hooks
2. **Real-time** — 10-30s refresh intervals per useApi hook staleTime
3. **Composable** — add new widgets by creating a function component
4. **Responsive** — single column mobile → 2-3 column grid on larger screens
5. **Live over config** — focus on showing live data, minimal persistence

---

## Current Widgets (4 major)

### 1. LiveKPIs
**File**: Dashboard.tsx (lines ~30-60)

**Purpose**: Aggregate KPIs from `/terrains/:id/dashboard` endpoint

**Displays**:
- power_now_kw (instantaneous)
- energy_today.import_kwh
- points_count  
- last_update (age in minutes)

**Metrics**: Live aggregate power, daily energy, point count
**Data Source**: `useDashboard(terrainId)` w/ 15s refresh
**Size**: 2x2 grid (md:4 cols)

---

### 2. EnergyQualityWidget  
**File**: Dashboard.tsx (lines ~130-185)

**Purpose**: 24-hour quality diagnostics (PF, THD, Power, Energy)

**Displays**:
- PF moyen (average power factor, 24h)
- THD max (max total harmonic distortion)
- Puissance moy (average active power)
- Énergie imp (max cumulative imported energy)
- Sparkline: power trend by hour

**Metrics**: P, Energy, PF, THD calculated from historical readings
**Data Source**: `useReadings()` filtered to 24h window, no point filter = terrain aggregate
**Size**: 1/2 desktop, full mobile
**Interactions**: None (read-only)

**How to extend**:
- Add more time ranges (7D, 1M, 3M) via dropdown
- Switch to per-point via point selector
- Add export as CSV

---

### 3. QualityPointsWidget
**File**: Dashboard.tsx (lines ~187-243)

**Purpose**: Identify worst-performing points (PF, THD)  

**Displays**:
- Top 3 points with lowest PF
- Top 3 points with highest THD
- Badges with severity color

**Metrics**: Per-point latest readings (readings merged into points object)
**Data Source**: `useTerrainOverview(terrainId)` — per-point latest readings
**Size**: 1/2 desktop, full mobile
**Interactions**: None (read-only)

**How to extend**:
- Click point name → drill into PointDetails
- Expand to Top N (5, 10)
- Add voltage unbalance tracking

---

### 4. ActiveAlertsWidget
**File**: Dashboard.tsx (lines ~245-285)

**Purpose**: At-a-glance visibility into active point alarms

**Displays**:
- List of points where alarm_state ≠ 0
- Red card styling
- Quick link to point detail page
- "Aucune alarme" state with checkmark

**Metrics**: alarm_state (from readings)
**Data Source**: `useTerrainOverview()` → points with readings.alarm_state > 0
**Size**: Full width
**Interactions**: Click badge → Link to `/points/:pointId`

**How to extend**:
- Filter by alarm type (power, voltage, frequency, etc.)
- Add alarm count badge in LiveKPIs
- Sound notification on new alarm

---

### 5. PointWidgets (collapsable detail view)
**File**: Dashboard.tsx (lines ~287-450)

**Purpose**: Full per-point real-time view with all 12 parameters

**Displays** (per point):
- Status indicator (LED: green/amber/red)
- Name + category + zone
- 12 key metrics: P, Q, S, Va/b/c, Ia/b/c, PF, Freq, Energy
- Stale data warning (data > 30 min old)
- Alarm badge if active
- Dropdown to expand/collapse

**Metrics**: All voltage/current/power phases + frequency + energy
**Data Source**: `useTerrainOverview()` merge
**Size**: 3-column grid at xl breakpoint
**Interactions**:
- Expand/collapse card
- Filter by category (dropdown)
- Click → `/points/:pointId` for full detail

---

## Data Flow

```
Dashboard.tsx renders:
  ↓
  LiveKPIs: useDashboard() → 4 aggregate cards
  ↓
  EnergyQualityWidget: useReadings(…, 24h) → PF/THD/Power stats + sparkline
  ↓
  QualityPointsWidget: useTerrainOverview() → per-point latest, sort, top-3
  ↓
  ActiveAlertsWidget: useTerrainOverview() → filter alarm_state > 0
  ↓
  PointWidgets (if expanded): useTerrainOverview() → full per-point grid
```

All hooks configured with `staleTime: 10-30s` for continuous live updates.

---

## Adding a New Widget

1. **Create widget component** in Dashboard.tsx:
   ```typescript
   function MyNewWidget({ terrainId }: { terrainId: string }) {
     const { data, isLoading } = useMyDataHook(terrainId);
     // Process data, render
     return <Card>...</Card>;
   }
   ```

2. **Integrate into Dashboard render**:
   ```typescript
   <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
     <EnergyQualityWidget terrainId={selectedTerrainId} />
     <MyNewWidget terrainId={selectedTerrainId} />  {/* ← Add here */}
   </div>
   ```

3. **Recommended new widgets**:
   - **PowerFlowWidget** — import vs export energy (24h stacked bar)
   - **FrequencyStabilityWidget** — frequency drift trend (line chart)
   - **TemperatureWidget** — temp per sensor + trend (if available in readings)
   - **CostProjectionWidget** — cost today vs budget (if tariff data available)
   - **AnomaliesWidget** — summary of top issues (PF + THD + unbalance combined)

---

## Styling & Responsiveness

All widgets use:
- **Card component** from `@/components/ui/card`
- **TailwindCSS grid** with `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` pattern
- **Icons** from lucide-react
- **Charts** via Recharts line/bar/area

Standard colors:
- `text-primary` — PF/power metrics
- `text-amber-600` — warnings (PF < 0.85, THD > 8%)
- `text-red-500` — alarms
- `text-emerald-500` — OK status

---

## Known Limitations & TODOs

- [ ] No layout persistence (widgets always same order)
- [ ] No widget configuration dialog (Simes_Ui has this)
- [ ] No split-by-category aggregation (only terrain-wide)
- [ ] No forecast widget (would need separate API)
- [ ] No drill-down from widget to detail page (except via point link)
- [ ] No save-as-report capability

---

## References

- **Simes_Ui source**: ./Simes_Ui/src/lib/widget-registry.ts (6 widget definitions)
- **Types**: ./Simes_Ui/src/types/widget-engine.ts (WidgetDefinition, WidgetConfig, etc.)
- **Frontend-web API hooks**: ./apps/frontend-web/src/hooks/useApi.ts
- **Dashboard implementation**: ./apps/frontend-web/src/pages/org/Dashboard.tsx
