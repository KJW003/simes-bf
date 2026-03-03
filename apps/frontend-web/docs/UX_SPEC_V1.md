# UX Spec V1 - SIMES UI (Surveillance + Audit)

## Scope and Principles
- V1 is surveillance, audit, forecasts, alerts, and diagnostics. No automatic control or load shedding.
- Multi-tenant structure: Organisation > Sites > Terrains (Concentrateur Milesight) > Zones.
- In V1, 1 ACREL meter = 1 Zone. Zones are the unit of audit and details.
- Solar audit is optional and gated by a configuration toggle.
- Base path is `/testUi/` for routing and assets.

## Roles and Access
- Platform Super Admin (NOC): platform-wide supervision, all orgs, concentrateurs, unmapped devices, pipeline health.
- Organization Admin: org settings, device mapping, user management, billing configuration, solar toggle.
- Organization Supervisor (Operator): monitoring, alerts/anomalies, audit and reports, no admin settings.

## Modèle de données (Sites - Terrains - Zones - Points)
Compréhension V1
- Organisation: entité cliente (multi-tenant).
- Site: lieu physique de l’organisation (usine, dépôt, bureau).
- Terrain: sous-ensemble d’un site, correspondant à un concentrateur Milesight (appelé “Concentrateur” en UI).
- Zone: unité logique de consommation à l’intérieur d’un terrain. En V1, 1 ACREL = 1 zone (règle clé).
- Point de mesure: mesures électriques (P, V, I, PF, kWh, THD, harmoniques) associées à la zone/ACREL.

Implications UX
- Navigation: Organisation → Site → Terrain → Zone → Détails mesures.
- Sur la vue Terrain, chaque zone correspond à un point ACREL (pas de regroupement multi-points en V1).
- Les indicateurs et alertes sont calculés au niveau zone et agrégés au niveau terrain/site.

## Global UX Requirements
- Dashboard is a widget canvas with per-user layout saved in localStorage.
- Widgets can be added, removed, resized, pinned, and reset to default.
- A single composite widget called "Energy Quality Summary" is available in the widget library and default layout.
- The time range selector inside the Energy Quality Summary drives only that widget's metrics.
- "Gateway" is renamed to "Concentrateur" across the UI.

## Widget Library (V1)
Energy Quality Summary
- Inputs: latest power (kW), energy (kWh), PF average, THD max.
- Time range: 1D, 7D, 1M, 3M, 6M, 1Y within the widget.
- Output: four KPIs and optional sparkline.

Courbe de charge live
- Inputs: real-time power series.
- Output: line chart of instantaneous power.

Coût estimé
- Inputs: daily cost, monthly budget progress.
- Output: cost KPI and progress bar.

Diagnostics & recommandations
- Inputs: top diagnostic signals (PF, THD, peaks, data quality).
- Output: ranked quick recommendations, no ROI.

Alertes actives
- Inputs: top anomalies/alerts list.
- Output: severity badges and short summaries.


Prévision consommation
- Inputs: P50/P90 forecast series.
- Output: confidence band and median line.

## Pages

### Login
What the user sees
- Standard SIMES login with email, password, remember me, and error handling.

Interactions
1. Login with credentials.
2. Lockout after failed attempts.
3. Redirect to last page after login.

### Dashboard (Org Mode)
What the user sees
- Page header with selected context (site or terrain).
- Widget canvas with default layout including Energy Quality Summary.

Interactions
1. Add widgets from the library.
2. Resize, drag, pin, remove widgets.
3. Save layout per user.
4. Reset to default layout.

Role differences
- Admin and Supervisor see the same widget system.

### Terrain View (Map/Plan) - `Data Monitor`
What the user sees
- Terrain header showing concentrateur status, last seen, data completeness, message rate.
- Zone tiles laid out as a schematic plan grid.
- Each zone tile shows power (kW), PF, THD max, and data quality.

Interactions
1. Search zones by name.
2. Click a zone tile to open Zone Details.
3. Refresh the view.

Détails des éléments
- En-tête terrain: statut du concentrateur, dernière communication, complétude des données 24h, taux de messages, taux d’erreur.
- Barre d’actions: recherche par zone, filtre de statut (OK/Warning/Critical), indicateur du nombre de zones visibles.
- Grille de zones: chaque tuile représente 1 zone = 1 ACREL (règle V1).
- Tuile zone: nom de zone, puissance actuelle (kW), PF, THD max, état (OK/Warning/Critical), qualité des données.
- Badge état: dérivé des seuils (PF bas, THD élevé, données manquantes).

Interactions détaillées
1. Cliquer une tuile zone ouvre un panneau de détails à droite (Zone Details).
2. Survol d’une tuile affiche un résumé rapide (puissance + statut).
3. Recherche filtre la grille en temps réel.
4. Les statuts permettent de prioriser les zones à investiguer.

### Zone Details (ACREL Point)
What the user sees
- Zone header with raw device ID and status.
- Energy Quality Summary widget for the selected zone.
- Per-phase trend charts for P, V, I, PF, and kWh.
- THD and harmonics panel.
- Data quality: completeness and last seen.

Interactions
1. Time range selection (1D-1Y) for charts.
2. Switch between harmonic and data quality tabs.

### Power Quality
What the user sees
- PF, THD, and unbalance analytics with charts and rankings.

Interactions
1. Switch between PF, THD, and unbalance tabs.
2. Inspect ranking tables and phase charts.

### History
What the user sees
- Time range selectors and metric filters.
- Load curve, daily energy bars, heatmap of consumption (hour vs day).

Interactions
1. Change time range and metric.
2. Toggle comparison mode.
3. Export CSV.

### Forecasts
What the user sees
- P50/P90 energy forecasts and confidence bands.
- Risk periods and model quality indicators.

Interactions
1. Select terrain or site scope.
2. Inspect forecast chart and risk periods.

### Anomalies
What the user sees
- Summary of anomaly counts by severity.
- Filterable list of anomalies with details.
- Detailed panel with chart and recommended checks.

Interactions
1. Filter by type, severity, status.
2. Sort by severity, duration, or impact.
3. Review anomaly details and notes.

### Energy Audit
What the user sees
- Recommandations rapides basées sur des checks simples (pas de ROI, pas de score).

Interactions
1. Generate audit report.

### Billing (Simplified)
What the user sees
- Estimated bill from measured energy (tariff presets SONABEL Oct-2023).
- Tariff group (D/E/G) and plan (D1/D2/D3, E1/E2/E3, G) with peak/off-peak schedule.
- Warning about PF (cos φ) penalties (not computed in V1).

Interactions
1. Admin selects tariff group + plan and sets PS (Puissance Souscrite).
2. Admin can adjust hours/rates if needed; auto-filled from the SONABEL grid.
3. Supervisor sees the estimated bill only.

### Administration (Org Admin Only)
What the user sees
- Organization details.
- Solar system toggle.
- Device mapping workflow.
- User management.
- Billing configuration summary.

Interactions
1. Toggle solar system on/off.
2. Map raw device to terrain and zone.
3. Set meter type, CT/PT ratios.
4. View last readings after mapping.
5. Manage users and roles.

### PV Audit (Optional)
What the user sees
- PV performance KPIs and deviations.
- Optional battery tab if available.

Interactions
1. Inspect PV expected vs actual.
2. Review anomalies and recommendations.

### Reports
What the user sees
- Report library with status.
- Report builder with selectable sections.

Interactions
1. Create new report.
2. Select sections (PV section disabled if solar is off).
3. Download generated reports.

### Platform NOC (Super Admin)
What the user sees
- NOC overview with global KPIs.
- Orgs overview.
- Sites & terrains overview.
- Concentrateurs health list.
- Unmapped devices list.
- Pipeline health and logs.

Interactions
1. Navigate between NOC pages.
2. Filter lists and inspect incidents.
3. Track data completeness and concentrateur status.

## Role-Based Differences
- Super Admin uses NOC mode only, no org navigation elements.
- Org Admin can access Administration and Billing configuration.
- Org Supervisor can access monitoring, history, anomalies, audit, and reports.

## Assumptions
- Layout persistence is per user via localStorage until backend is available.
- Zone = ACREL meter, even if mock data still contains multiple points per zone.
- Tariff presets are based on SONABEL Oct-2023; K (taxes/fees) still to be confirmed.
- Harmonics data is shown if available in the point; otherwise panel still renders.

## What To Validate With The Team Next
1. Confirm SONABEL Oct-2023 tariff grid values and the K (taxes/fees) component.
2. Exact thresholds for PF and THD used in zone status logic.
3. Solar toggle persistence requirements per org vs per site.
4. Final list of widgets to keep in the default dashboard.
5. Whether battery audit should be visible in V1 or postponed.
