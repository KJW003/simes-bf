# Catalogue des widgets V1 (SIMES UI)

## Portée
Ce document décrit tous les widgets disponibles dans la bibliothèque V1 (dashboard). Les widgets sont réutilisables sur les pages qui exposent un canvas de widgets (ex: Dashboard, détails de zone, etc.).

## Architecture – Widget Engine

### Type system (`src/types/widget-engine.ts`)
- **EnergySourceCategory**: `GRID | PV | BATTERY | GENSET | LOAD | UNKNOWN`
- **DataSourceType**: `POINT | ZONE_AGG | TERRAIN_AGG | CATEGORY_AGG`
- **MetricKey**: `P | Q | S | Energy | PF | THD | V | I | Freq | VUnbal | IUnbal`
- **WidgetConfig**: Combinaison de `scopeType`, `dataSource`, `metrics[]`, `timeRange`, `display`
- **WidgetDefinition**: id, title, category, configSchema, resolver, renderer

### Registry (`src/lib/widget-registry.ts`)
Chaque widget est enregistré avec :
1. Un **configSchema** décrivant les sources et métriques supportées.
2. Un **resolver** qui, à partir de la config et du contexte (terrainId, etc.), produit un `ResolvedWidgetData` (KPIs, séries, méta).
3. Un **renderer** (stub pour V1 – le rendu se fait en inline dans `WidgetBoard`).

### ConfigureWidgetModal (`src/components/widgets/ConfigureWidgetModal.tsx`)
Dialogue de configuration accessible via icône engrenage ou clic droit → Configurer :
- Sélection du type de source (Point / Zone agrégé / Terrain agrégé / Catégorie)
- Sélection de la référence contextuelle (point, zone, terrain ou catégorie)
- Multi-sélection de métriques avec checkboxes
- Mode multi-métrique : Onglets ou Small Multiples
- Plage de temps par défaut (si supporté par le widget)

### WidgetBoard (`src/components/widgets/WidgetBoard.tsx`)
- Chaque instance a un `instanceId` unique + `WidgetConfig` persisté.
- La config est sauvée dans localStorage (clé versionnée par utilisateur).
- Le resolver est appelé à chaque render pour produire les données à afficher.
- Layout par défaut construit depuis les defaultConfig des définitions du registre.

## Règles communes
- Tailles: `sm`, `md`, `lg` (impacte la densité et l'affichage de certains éléments).
- États: `ready`, `loading`, `partial`, `error`, `offline`.
- Actions disponibles sur un widget: déplacer (drag), redimensionner, épingler, masquer, configurer, ouvrir en détail, plein écran.
- Stockage: layout + config sauvegardé par utilisateur (localStorage, clé versionnée).

## Widgets disponibles

### 1) Energy Quality Summary
Catégorie: `core`

Objectif
- Synthèse qualité énergie sur un périmètre donné (site/terrain/zone/point).

Sources supportées
- `POINT`, `ZONE_AGG`, `TERRAIN_AGG`, `CATEGORY_AGG`

Métriques
- `P`, `Energy`, `PF`, `THD` (multi-métrique supporté)

Affichage
- 4 KPI: Puissance, Énergie, PF moyen, THD max.
- Sparklines de puissance (si taille ≠ `sm`).
- Highlight si PF faible (< 0.85) ou THD élevé (> 10).

Interactions
- Sélecteur de période dans le widget: `1D / 7D / 1M / 3M / 6M / 1Y`.
- Configurable via ConfigureWidgetModal.

Où l'utiliser
- Dashboard (layout par défaut).
- Page zone (`ZonePage`).
- Page point (`PointDetails`).

---

### 2) Courbe de charge live
Catégorie: `core`

Objectif
- Visualiser la puissance instantanée en temps réel.

Sources supportées
- `POINT`, `ZONE_AGG`, `TERRAIN_AGG`, `CATEGORY_AGG`

Métriques
- `P`, `Q`, `S`, `V`, `I`, `PF`, `THD` (multi-métrique supporté)

Affichage
- Courbe ligne (recharts), grille légère, tooltip.
- Données proviennent du resolver (séries calculées depuis les points).

Interactions
- Tooltip au survol.
- Configurable via ConfigureWidgetModal.

---

### 3) Coût estimé
Catégorie: `core`

Objectif
- Suivi du coût journalier et de la trajectoire budgétaire mensuelle.

Sources supportées
- `TERRAIN_AGG`

Métriques
- `Energy`

Affichage
- KPI coût (calculé depuis énergie × tarif estimé) + barre de progression budget.

Interactions
- Lecture seule.

---

### 4) Diagnostics & recommandations
Catégorie: `insight`

Objectif
- Mettre en avant les points d'attention principaux (audit rapide).

Sources supportées
- `TERRAIN_AGG`, `ZONE_AGG`

Métriques
- `PF`, `THD`

Affichage
- Liste courte priorisée avec badges (PF bas, THD élevé).
- Données issues du resolver (scan automatique des points).

Interactions
- Lecture seule. Les détails se voient via la page Audit/Anomalies.

---

### 5) Alertes actives
Catégorie: `risk`

Objectif
- Résumé des alertes/anomalies en cours.

Sources supportées
- `TERRAIN_AGG`, `ZONE_AGG`

Affichage
- Liste courte avec badge de sévérité.
- Données issues du resolver (agrégation des alarmes actives).

Interactions
- Lecture seule. Les détails se voient via la page Anomalies.

---

### 6) Prévision consommation
Catégorie: `core`

Objectif
- Visualiser une projection simple (P50/P90) pour la consommation.

Sources supportées
- `TERRAIN_AGG`

Métriques
- `Energy`

Affichage
- Bande de confiance (P90) + courbe P50.

Interactions
- Tooltip au survol.
- Plage de temps configurable (widget-managed).

## Navigation – Pages de détail

### ZonePage (`/terrain/:terrainId/zones/:zoneId`)
- Breadcrumb : Terrain > Zone
- KPIs zone (puissance, PF, THD, nombre de points)
- Widget EnergyQualitySummary intégré
- Liste des points avec badges catégorie énergie → clic navigue vers PointDetails

### PointDetails (`/points/:pointId`)
- Breadcrumb : Terrain > Zone > Point
- 5 KPIs (P, Energy, PF, THD, Freq)
- Infos device (rawDeviceId, gateway, type)
- Widget EnergyQualitySummary intégré
- Graphiques par phase (P, V, I, PF, kWh)
- Onglets : Harmoniques / Qualité / Alarmes
- Sélecteur de plage de temps

### DataMonitor (refactoré)
- Grille de zones par terrain (navigation-first)
- Clic zone → `/terrain/:terrainId/zones/:zoneId`
- Clic badge point → `/points/:pointId`
- Tooltip rapide au survol d'un point

## Layout par défaut (Dashboard)
- `Energy Quality Summary` (md)
- `Courbe de charge live` (lg)
- `Coût estimé` (md)
- `Alertes actives` (md, état partiel)
- `Diagnostics & recommandations` (md)
- `Prévision consommation` (md)
