# SIMES-BF — Architecture complète

## 1. Vue d'ensemble

SIMES (**Système Intelligent de Monitoring Énergétique au Sahel**) est une plateforme de supervision énergétique multi-sites déployée au Burkina Faso. Elle collecte les télémesures de compteurs Acrel triphasés via des passerelles LoRa Milesight, les stocke dans des bases de données time-series, et fournit un tableau de bord temps réel pour les opérateurs.

### Stack technologique

| Couche | Technologie |
|--------|------------|
| **Frontend** | React 18.3 · Vite 5.4 · TypeScript 5.8 · TailwindCSS · Recharts · TanStack Query v5 |
| **API** | Node.js · Express 5.2 · Zod · JWT HS256 |
| **Ingestion** | Node.js · Express 5.2 · BullMQ |
| **Workers** | Node.js · BullMQ · Cron |
| **ML** | Python · FastAPI · LightGBM 4.5 · scikit-learn 1.6 |
| **Base relationnelle** | PostgreSQL 16 |
| **Base time-series** | TimescaleDB (PostgreSQL 16) |
| **Cache & Files d'attente** | Redis 7 |
| **Stockage objet** | MinIO |
| **Reverse proxy** | Traefik v2.11 |
| **Orchestration** | Docker Compose |

---

## 2. Architecture des conteneurs

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRAEFIK v2.11 (:80, :8080)                   │
│  PathPrefix(/)  →  frontend-web:80      (priority 1)               │
│  PathPrefix(/api) → api-core:3000       (priority 10, strip /api)  │
│  PathPrefix(/ingest) → ingestion:3001   (priority 10, strip /ingest) │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ réseau: simes-edge
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
┌────▼─────┐    ┌──────────▼──────────┐    ┌─────▼──────────┐
│ frontend │    │     api-core        │    │  ingestion     │
│  (React) │    │  (Express :3000)    │    │  (Express :3001)│
│  256 MB  │    │    512 MB / 1 CPU   │    │  384 MB        │
└──────────┘    └────────┬────────────┘    └───────┬────────┘
                         │ réseau: simes-internal          │
        ┌────────────────┼────────────────┬────────────────┤
        │                │                │                │
   ┌────▼──────┐  ┌──────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
   │  core-db  │  │telemetry-db │  │   redis     │  │   minio    │
   │ PG 16     │  │ Timescale   │  │ 7-alpine    │  │   latest   │
   │  1 GB     │  │  2 GB / 2CPU│  │  256 MB     │  │            │
   └───────────┘  └─────────────┘  └──────┬──────┘  └────────────┘
                                          │
                  ┌───────────────────┬────┘
                  │                   │
           ┌──────▼──────┐    ┌──────▼──────┐
           │ worker-jobs  │    │ ml-service   │
           │ (BullMQ)     │    │ (FastAPI)    │
           │  384 MB      │    │  1GB / 1CPU  │
           └──────────────┘    └──────────────┘
```

### Réseaux Docker

| Réseau | Rôle |
|--------|------|
| `simes-edge` | Services exposés par Traefik (frontend, api-core, ingestion) |
| `simes-internal` | Communication inter-services (bases de données, Redis, workers, ML) |

### Volumes persistants

| Volume | Service | Données |
|--------|---------|---------|
| `core_db_data` | core-db | Données référentielles (organisations, sites, terrains, utilisateurs) |
| `telemetry_db_data` | telemetry-db | Données time-series (lectures Acrel, agrégations) |
| `redis_data` | redis | Cache et files d'attente BullMQ |
| `minio_data` | minio | Stockage fichiers (exports, rapports) |
| `ml_models_data` | ml-service | Modèles LightGBM entraînés |
| `pgadmin_data` | pgadmin | Configuration pgAdmin |

---

## 3. Base de données — core-db (PostgreSQL 16)

Contient les données référentielles et métier.

### Schéma

```
organizations
  └── sites
       └── terrains
            ├── zones
            │    └── measurement_points
            ├── terrain_contracts (→ tariff_plans)
            └── (telemetry via terrain_id FK dans telemetry-db)

users (org_id → organizations)
  roles: platform_super_admin | org_admin | operator | manager

incoming_messages          # Messages IoT bruts (fifo debug)
gateway_registry           # Passerelles LoRa Milesight
device_registry            # Compteurs Acrel mappés

runs / job_results         # Historique des jobs (facture, export…)

tariff_plans               # Grilles tarifaires SONABEL
  seeds: D1, D2, D3, E1, E2, E3, G

incidents / audit_logs     # Incidents détectés, journal d'audit
user_settings              # Préférences utilisateur (JSON)
schema_migrations          # Suivi des migrations
```

### Tables principales

| Table | Rôle | Clé primaire |
|-------|------|-------------|
| `organizations` | Sociétés clientes | UUID |
| `sites` | Sites physiques | UUID |
| `terrains` | Périmètres de mesure | UUID |
| `zones` | Zones logiques dans un terrain | UUID |
| `measurement_points` | Points de mesure (compteurs) | UUID |
| `users` | Utilisateurs avec rôles | UUID |
| `tariff_plans` | Grilles tarifaires SONABEL | UUID |
| `terrain_contracts` | Lien terrain ↔ tarif + puissance souscrite | UUID |
| `gateway_registry` | Passerelles LoRa | `gateway_id` TEXT |
| `device_registry` | Compteurs Acrel | `dev_eui` TEXT |
| `runs` | Executions de jobs | UUID |
| `job_results` | Résultats de jobs (facture, etc.) | UUID |
| `incidents` | Incidents détectés | UUID |
| `audit_logs` | Journal d'audit | UUID |
| `user_settings` | Préférences utilisateur | UUID |

### Enum `measure_category`

```
LOAD | GRID | PV | BATTERY | GENSET | UNKNOWN
```

### Enum `user_role`

```
platform_super_admin | org_admin | operator | manager
```

---

## 4. Base de données — telemetry-db (TimescaleDB)

Contient les données de télémétrie time-series.

### Tables

#### `acrel_readings` (hypertable)
Table principale des lectures brutes. Clé : `(point_id, time)`.

**60+ colonnes** organisées par catégorie :

| Catégorie | Colonnes |
|-----------|----------|
| Tensions (V) | `voltage_a`, `voltage_b`, `voltage_c`, `voltage_ab`, `voltage_bc`, `voltage_ca` |
| Courants (A) | `current_a`, `current_b`, `current_c`, `current_sum`, `aftercurrent` |
| Puissance active (kW) | `active_power_a/b/c/total` |
| Puissance réactive (kVar) | `reactive_power_a/b/c/total` |
| Puissance apparente (kVA) | `apparent_power_a/b/c/total` |
| Facteur de puissance | `power_factor_a/b/c/total` |
| Fréquence & déséquilibre | `frequency`, `voltage_unbalance`, `current_unbalance` |
| Énergie globale (kWh) | `energy_total`, `energy_import`, `energy_export` |
| Énergie par phase | `energy_total_a/b/c`, `energy_import_a/b/c`, `energy_export_a/b/c` |
| Tranches SONABEL | `energy_spike`, `energy_peak`, `energy_flat`, `energy_valley` |
| THD (%) | `thdu_a/b/c`, `thdi_a/b/c` |
| Températures | `temp_a/b/c/n` |
| E/S digitales | `di_state`, `do1_state`, `do2_state`, `alarm_state` |
| Signal LoRa | `rssi_lora`, `rssi_gateway`, `snr_gateway`, `f_cnt` |

#### `acrel_agg_15m`
Agrégation 15 minutes. Clé : `(point_id, bucket_start)`.

| Colonne | Description |
|---------|-------------|
| `samples_count` | Nombre de lectures dans le bucket |
| `active_power_avg` | Moyenne puissance active |
| `active_power_max` | Max puissance active |
| `voltage_a_avg` | Moyenne tension phase A |
| `energy_import_delta` | Delta énergie importée |
| `energy_export_delta` | Delta énergie exportée |
| `energy_total_delta` | Delta énergie totale |

#### `acrel_agg_daily`
Agrégation journalière. Même structure que `acrel_agg_15m` mais clé `(point_id, day)`.

#### `power_peaks`
Pics de puissance journaliers par point.

| Colonne | Type | Description |
|---------|------|-------------|
| `terrain_id` | UUID | Terrain |
| `point_id` | UUID | Point de mesure |
| `peak_date` | DATE | Jour |
| `max_power` | DOUBLE | Puissance maximale (kW) |
| `peak_time` | TIMESTAMPTZ | Horodatage du pic |

#### `ml_predictions`
Prédictions ML pour comparaison.

| Colonne | Description |
|---------|-------------|
| `terrain_id` | Terrain prédit |
| `predicted_day` | Jour prédit |
| `predicted_kwh` | Énergie prédite |
| `lower_bound` / `upper_bound` | Intervalles de confiance (P10/P90) |
| `actual_kwh` | Énergie réelle (rempli a posteriori) |
| `error_pct` | Erreur relative |

#### `energy_anomalies`
Anomalies détectées par le ML.

| Colonne | Description |
|---------|-------------|
| `anomaly_type` | `residual`, `isolation_forest`, `threshold` |
| `severity` | `low`, `medium`, `high`, `critical` |
| `score` | Score d'anomalie |
| `expected_kwh` / `actual_kwh` | Valeurs attendues vs réelles |
| `deviation_pct` | Pourcentage d'écart |

---

## 5. Migrations

Les migrations sont numérotées `NNN_<target>_<description>.sql` et stockées dans `infra/db/migrations/`.

Le routage vers la bonne base de données est déterminé par le nom du fichier :
- Fichiers contenant `telemetry` ou `agg` → exécutés sur **telemetry-db**
- Tous les autres → exécutés sur **core-db**

### Liste des migrations

| # | Fichier | Base cible | Description |
|---|---------|-----------|-------------|
| 001 | `001_core_job_results.sql` | core | Table `job_results` |
| 002 | `002_telemetry_acrel_agg.sql` | telemetry | Tables `acrel_agg_15m` et `acrel_agg_daily` |
| 003 | `003_core_tariffs.sql` | core | Table `tariff_plans` et `terrain_contracts` |
| 004 | `004_core_tariffs_seed_202310.sql` | core | Seed données tarifaires SONABEL |
| 005 | `005_core_incoming_and_mapping.sql` | core | Tables `incoming_messages`, `gateway_registry`, `device_registry` |
| 006 | `006_core_users.sql` | core | Table `users` avec rôles |
| 007 | `007_core_incidents_and_logs.sql` | core | Tables `incidents` et `audit_logs` |
| 008 | `008_user_settings.sql` | core | Table `user_settings` |
| 009 | `009_agg_indexes.sql` | telemetry | Index supplémentaires sur agrégations |
| 010 | `010_telemetry_energy_total_delta.sql` | telemetry | Colonne `energy_total_delta`, table `ml_predictions` |
| 011 | `011_telemetry_power_peaks.sql` | telemetry | Table `power_peaks` |
| 012 | `012_telemetry_energy_anomalies.sql` | telemetry | Table `energy_anomalies` |

### Système de migrations (`migrate.js`)

```
Fonctionnement :
1. Crée la table `schema_migrations` si absente
2. Lit les fichiers SQL dans migrations/
3. Filtre par cible (core ou telemetry) via le nom de fichier
4. Compare avec les migrations déjà appliquées (via filename + checksum SHA-256)
5. Applique dans une transaction avec ROLLBACK en cas d'erreur
```

---

## 6. Service — api-core (Express 5.2)

Port interne : `3000` — Exposé via Traefik sur `/api`

### Middleware chain

```
helmet() → CORS → rate-limit (200 req/min) → JSON parser → JWT auth → Zod validation → routes
```

### Authentification

- JWT HS256, expiration 24h
- Mot de passe : bcrypt (salt 12)
- 5 tentatives max avant verrouillage
- Admin par défaut : `admin@simes.bf` / `admin1234`

### Routes principales (~60+ endpoints)

#### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/auth/login` | Connexion |
| POST | `/auth/register` | Inscription |
| GET | `/auth/me` | Profil courant |
| PUT | `/auth/password` | Changer mot de passe |

#### Référentiel
| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/organizations` | Organisations |
| GET/POST | `/sites` | Sites |
| GET/POST/PUT/DELETE | `/terrains` | Terrains |
| GET/POST/PUT/DELETE | `/terrains/:id/zones` | Zones |
| GET/POST/PUT/DELETE | `/terrains/:id/zones/:zid/points` | Points de mesure |

#### Télémétrie
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/terrains/:id/overview` | Vue d'ensemble terrain + dernières lectures |
| GET | `/terrains/:id/readings` | Lectures brutes (filtrables, paginées max 50 000) |
| GET | `/terrains/:id/readings/latest` | Dernière lecture par point |
| GET | `/terrains/:id/chart-data` | Données agrégées 15m ou daily |
| GET | `/terrains/:id/dashboard` | KPIs temps réel |
| GET | `/terrains/:id/power-peaks` | Pics de puissance historiques |
| POST | `/terrains/:id/power-peaks/compute` | Calcul des pics (appelé par worker) |
| GET | `/terrains/:id/stats` | Statistiques du terrain |

#### Exports
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/terrains/:id/export` | Export CSV d'un point de mesure |
| GET | `/terrains/:id/export-terrain` | Export CSV de tous les points |

#### Tarifs
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/tariffs` | Liste des plans tarifaires |
| PUT | `/terrains/:id/contract` | Associer tarif à un terrain |

#### Administration
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/admin/incoming` | Messages IoT bruts |
| GET/PUT | `/admin/gateways` | Passerelles LoRa |
| PUT | `/admin/gateways/:id/map` | Mapper passerelle → terrain |
| PUT | `/admin/devices/:eui/map` | Mapper compteur → point |
| DELETE | `/admin/gateways/:id` | Supprimer passerelle |
| GET | `/admin/users` | Liste utilisateurs |
| PUT | `/admin/users/:id/role` | Changer rôle |
| POST | `/admin/purge-readings` | Purger lectures anciennes |

#### Jobs & Résultats
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/jobs/facture` | Lancer calcul de facture |
| POST | `/jobs/:type` | Lancer job générique |
| GET | `/runs` | Historique des exécutions |
| GET | `/results/:type` | Résultat d'un job |

#### AI / ML
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/ai/train/:terrainId` | Entraîner modèle forecast |
| POST | `/ai/train-all` | Entraîner tous les terrains |
| GET | `/ai/forecast/:terrainId` | Prédictions |
| GET | `/ai/anomalies/:terrainId` | Anomalies détectées |

#### Incidents & Audit
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/incidents` | Liste incidents |
| POST | `/incidents` | Créer incident |
| PUT | `/incidents/:id` | Mettre à jour incident |
| GET | `/incidents/stats` | Statistiques incidents |
| GET | `/audit-logs` | Journal d'audit |

---

## 7. Service — ingestion-service (Express 5.2)

Port interne : `3001` — Exposé via Traefik sur `/ingest`

Pipeline de traitement des données IoT :

```
Webhook Milesight
    │
    ▼
POST /milesight (payload UG67 encodé)
    │
    ├─ 1. Normalisation UG67 (extraction JSON du payload base64)
    ├─ 2. Lookup passerelle (gateway_registry dans core-db)
    ├─ 3. Résolution device (device_registry → measurement_point)
    ├─ 4. Mapping des champs Acrel (acrel-field-map.js)
    ├─ 5. Upsert dans acrel_readings (telemetry-db)
    └─ 6. Publication job BullMQ (queue: telemetry)
```

### Routes

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/milesight` | Point d'entrée principal (webhooks Milesight) |
| POST | `/acrel` | Ingestion directe Acrel (test) |
| POST | `/acrel/batch` | Ingestion batch |

### Mapping des champs

Le fichier `acrel-field-map.js` contient la correspondance entre les noms de champs du codec Milesight/Acrel et les colonnes de la table `acrel_readings`. Exemple :

```
"Ua"  → voltage_a
"Ub"  → voltage_b
"Ia"  → current_a
"P"   → active_power_total
"Ep+" → energy_import
```

---

## 8. Service — worker-jobs (BullMQ)

Traite les jobs asynchrones via 3 files d'attente Redis.

### Files d'attente

| Queue | Rôle |
|-------|------|
| `telemetry` | Agrégation, détection lacunes, nettoyage |
| `ai` | Entraînement ML, détection anomalies |
| `reports` | Factures, exports |

### Jobs planifiés (Cron)

| Cron | Job | Description |
|------|-----|-------------|
| `*/2 * * * *` | `cleanup_unmapped` | Nettoyer les messages non mappés |
| `*/5 * * * *` | `check_stale_devices` | Détecter les compteurs silencieux |
| `*/15 * * * *` | `check_aggregation_gaps` | Vérifier les trous d'agrégation |
| `*/10 * * * *` | `queue_health` | Santé des files Redis |
| `*/10 * * * *` | `pipeline_heartbeat` | Heartbeat du pipeline |
| `0 2 * * *` | `compute_power_peaks` | Calcul des pics de puissance quotidiens |
| `0 3 * * *` | `retrain_forecasts` | Ré-entraînement des modèles ML |
| `0 4 * * *` | `detect_anomalies` | Détection d'anomalies ML |

### Job `telemetry.worker.js` — Agrégation

```
Réception d'un nouveau reading
    │
    ├─ Calcul delta énergie (lecture courante - précédente)
    ├─ Upsert acrel_agg_15m (bucket 15 minutes)
    └─ Upsert acrel_agg_daily (bucket journalier)
```

### Job `facture` — Calcul de facture SONABEL

```
1. Charger contrat terrain (tarif + puissance souscrite)
2. Récupérer agrégation journalière sur la période
3. Classifier par tranche horaire SONABEL :
   - Pointe : 17h-22h semaine
   - Pleine : 07h-17h semaine
   - Creuse : 22h-07h + weekend
4. Appliquer barème tarifaire progressif
5. Calculer pénalités cos(φ)
6. Stocker résultat dans job_results
```

---

## 9. Service — ml-service (FastAPI + LightGBM)

Port interne : `8000` — Accessible uniquement sur le réseau interne.

### Prévisions énergétiques

**Modèle** : LightGBM GBDT + modèles quantile (P10, P90)

**Features** :
| Feature | Description |
|---------|-------------|
| `day_of_week` | Jour de la semaine (0-6) |
| `month` | Mois (1-12) |
| `lag_1d` | Énergie J-1 |
| `lag_7d` | Énergie J-7 |
| `lag_14d` | Énergie J-14 |
| `rolling_avg_7d` | Moyenne mobile 7 jours |
| `rolling_avg_30d` | Moyenne mobile 30 jours |
| `rolling_std_7d` | Écart-type mobile 7 jours |

**Pipeline** :
```
365 jours d'agrégation daily
    → Feature engineering
    → Train/test split (80/20)
    → LightGBM GBDT (n_estimators=100)
    → Modèles quantile P10 & P90
    → Sauvegarde modèle (.pkl) dans /data/models/
```

### Détection d'anomalies

Deux méthodes combinées :

1. **Résiduelle** : écart prédiction vs réel > 2σ (seuils adaptatifs, sévérité par z-score)
2. **IsolationForest** : contamination=0.1, 100 estimators

### Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/train` | Entraîner modèle pour un terrain |
| POST | `/train-all` | Entraîner tous les terrains |
| GET | `/predict` | Prédire la consommation future |
| GET | `/predictions/{terrain_id}` | Historique des prédictions |
| POST | `/anomalies/detect/{terrain_id}` | Lancer détection d'anomalies |
| GET | `/anomalies/{terrain_id}` | Récupérer les anomalies |
| GET | `/health` | Santé du service |

---

## 10. Frontend — frontend-web (React 18.3 + TypeScript)

### Architecture

```
src/
├── App.tsx              # Router principal
├── main.tsx             # Point d'entrée (providers)
├── contexts/
│   ├── AppContext.tsx    # Contexte global (terrain sélectionné, stats)
│   └── AuthContext.tsx   # Authentification (JWT, user)
├── hooks/
│   ├── useApi.ts        # Hooks React Query (useTerrainOverview, useReadings, etc.)
│   ├── useAlarmEngine.ts # Moteur d'alarmes client-side
│   └── usePreferences.ts # Préférences (tarif, CO2, devise)
├── lib/
│   ├── api.ts           # Client HTTP (fetch wrapper + auth)
│   └── widget-registry.ts # Registre de 18 widgets
├── components/
│   ├── widgets/
│   │   ├── WidgetBoard.tsx        # Tableau de bord drag & drop
│   │   ├── dashboard-sections.tsx # Composants standalone (KPIs, courbes, etc.)
│   │   ├── SiteMapWidget.tsx      # Carte OpenStreetMap
│   │   └── ConfigureWidgetModal.tsx
│   └── ui/              # Composants shadcn/ui
├── pages/               # 24 pages (lazy-loaded)
└── types/               # Types TypeScript
```

### Provider Stack

```
ErrorBoundary
  └── QueryClientProvider (TanStack Query)
       └── AuthProvider (JWT token, user, login/logout)
            └── TerrainProvider (terrain sélectionné, stats)
                 └── AppBridge (ponts entre contextes)
                      └── <App /> (React Router)
```

### Pages (24)

#### Organisation (15)
| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Tableau de bord avec widgets |
| Zones & Points | `/zones` | Gestion zones et points de mesure |
| Qualité réseau | `/power-quality` | Analyse THD, facteur de puissance |
| Données | `/donnees` | Exploration des données brutes |
| Prévisions | `/forecasts` | Prévisions ML |
| Facture | `/invoice` | Calcul et affichage facture SONABEL |
| Solaire | `/solaire` | Performance PV |
| Prédimensionnement | `/predimensionnement` | Aide au dimensionnement |
| Audit énergétique | `/energy-audit` | Audit complet |
| Anomalies | `/anomalies` | Anomalies détectées |
| Exports | `/exports` | Export CSV |
| Administration | `/admin` | Gestion passerelles et compteurs |
| Zone | `/zones/:id` | Détail d'une zone |
| Point | `/points/:id` | Détail d'un point de mesure |
| Paramètres | `/settings` | Préférences utilisateur |

#### Plateforme (9)
| Page | Route | Description |
|------|-------|-------------|
| NOC | `/platform/noc` | Vue d'ensemble opérationnelle |
| Incidents | `/platform/incidents` | Gestion des incidents |
| Tenants | `/platform/tenants` | Gestion des organisations |
| Sites | `/platform/sites` | Gestion des sites |
| Passerelles | `/platform/gateways` | Passerelles LoRa |
| Compteurs | `/platform/devices` | Compteurs Acrel |
| Pipeline | `/platform/pipeline` | Santé du pipeline d'ingestion |
| Logs | `/platform/logs` | Journal d'audit |
| Purge | `/platform/purge` | Purge des données |

### Widget Engine (18 widgets)

Le moteur de widgets permet de composer le tableau de bord avec des widgets configurables, déplaçables et redimensionnables.

#### Widgets enregistrés

| ID | Titre | Type |
|----|-------|------|
| `dashboard-kpis` | KPIs temps réel | Standalone |
| `dashboard-load-curve` | Courbe de charge | Standalone |
| `dashboard-map` | Carte du site | Standalone |
| `dashboard-alarms` | Alarmes actives | Standalone |
| `dashboard-alarm-config` | Config alarmes | Standalone |
| `dashboard-daily-cost` | Coût journalier | Standalone |
| `dashboard-carbon` | Empreinte carbone | Standalone |
| `dashboard-power-peaks` | Pics de puissance | Standalone |
| `dashboard-anomalies` | Anomalies ML | Standalone |
| `energy-quality-summary` | Qualité énergie | Configurable |
| `live-load` | Charge en direct | Configurable |
| `cost-energy` | Coût énergie | Configurable |
| `diagnostics` | Diagnostics | Configurable |
| `active-alerts` | Alertes actives | Configurable |
| `forecast` | Prévision | Configurable |
| `pv-production` | Production PV | Configurable |
| `pv-performance-ratio` | Performance PV | Configurable |
| `battery-state` | État batterie | Configurable |

#### Cycle de vie d'un widget

```
1. Définition (widget-registry.ts) → configSchema + resolver + renderer
2. Configuration (ConfigureWidgetModal) → métriques, scope, source, timeRange
3. Résolution (resolver) → transforme ctx (overview + readings) en ResolvedWidgetData
4. Rendu (WidgetBoard.tsx) → renderWidgetContent() + carte UI
```

#### Persistance du layout

- Stocké dans `localStorage` avec clé versionnée : `simes_widget_layout_v8_{userId}`
- Format : tableau de `WidgetLayoutItem` (id, instanceId, size, config, pinned)
- Layout par défaut reconstruit si absent ou invalide

### État applicatif

| Couche | Mécanisme | Données |
|--------|-----------|---------|
| Serveur | TanStack Query v5 | Readings, overview, chart-data, forecasts |
| Auth | Context + localStorage | JWT token, user profile |
| Terrain | Context | Terrain sélectionné, stats |
| Préférences | Context + localStorage | Tarif, CO2, devise, langue |
| Layout | localStorage | Position et configuration des widgets |

---

## 11. Flux de données — De bout en bout

```
Compteur Acrel
    │ (données brutes via LoRa)
    ▼
Passerelle Milesight UG67
    │ (webhook HTTP POST)
    ▼
POST /ingest/milesight
    │
    ├─ Normalisation UG67 (décodage base64 + codec)
    ├─ Lookup gateway_registry (core-db)
    ├─ Lookup device_registry → measurement_point
    ├─ Mapping champs Acrel → colonnes DB
    ├─ INSERT acrel_readings (telemetry-db)
    └─ Publish job BullMQ (queue: telemetry)
         │
         ▼
    Worker telemetry
         │
         ├─ Calcul delta énergie
         ├─ Upsert acrel_agg_15m
         └─ Upsert acrel_agg_daily
              │
              ▼ (chaque nuit)
    Workers planifiés
         │
         ├─ 02:00 — compute_power_peaks
         ├─ 03:00 — retrain_forecasts (→ ml-service)
         └─ 04:00 — detect_anomalies (→ ml-service)
              │
              ▼
    API Core ← requêtes frontend
         │
         ├─ /overview → dernières lectures + points
         ├─ /readings → données brutes
         ├─ /chart-data → agrégations 15m/daily
         ├─ /dashboard → KPIs temps réel
         ├─ /power-peaks → historique pics
         ├─ /ai/forecast → prédictions ML
         └─ /ai/anomalies → anomalies détectées
              │
              ▼
    Frontend React
         │
         └─ Widgets dashboard, graphiques, exports
```

---

## 12. Déploiement

### Script `deploy.sh`

Commande unique pour déployer la plateforme complète :

```bash
./deploy.sh              # Build + démarrage + init DB
./deploy.sh --no-build   # Utilise images Docker cachées
./deploy.sh --db-only    # Uniquement init DB (conteneurs déjà lancés)
```

### Étapes du déploiement

```
1. Vérifier .env dans infra/docker/
2. docker compose down + nettoyage réseaux
3. docker compose up -d --build --force-recreate
4. Attendre core-db et telemetry-db (pg_isready)
5. Appliquer schema-core.sql via psql
6. Appliquer schema-telemetry.sql via psql
7. Attendre api-core (container running)
8. Copier migrate.js + migrations/ dans api-core
9. Exécuter migrations core-db (node migrate.js --db core)
10. Exécuter migrations telemetry-db (node migrate.js --db telemetry)
11. Attendre api-core healthcheck
12. Vérifier statut de tous les services
13. Vérifier réponse API (/api/health)
```

### Configuration requise (`.env`)

```env
# Bases de données
CORE_DB_NAME=simes_core
CORE_DB_USER=simes
CORE_DB_PASSWORD=...
TELEMETRY_DB_NAME=simes_telemetry
TELEMETRY_DB_USER=simes
TELEMETRY_DB_PASSWORD=...

# Redis
REDIS_PASSWORD=...

# Auth
JWT_SECRET=...

# MinIO
MINIO_ROOT_USER=...
MINIO_ROOT_PASSWORD=...

# pgAdmin
PGADMIN_EMAIL=...
PGADMIN_PASSWORD=...

# Système
TZ=Africa/Ouagadougou
```

---

## 13. Sécurité

| Mesure | Implémentation |
|--------|---------------|
| Authentification | JWT HS256, 24h expiry, bcrypt salt 12 |
| Autorisation | RBAC 4 rôles, middleware `verifyTerrainAccess` |
| Rate limiting | 200 req/min par IP |
| Headers sécurité | Helmet.js (CSP, HSTS, X-Frame, etc.) |
| CORS | Configuré via variable d'environnement |
| Timeout SQL | `statement_timeout = 15s` sur requêtes lourdes |
| Réseau | Services internes isolés (réseau `simes-internal`) |
| Secrets | Variables d'environnement uniquement (pas de secrets dans le code) |
| Lockout | 5 tentatives de connexion erronées → verrouillage |

---

## 14. Monitoring & Santé

| Endpoint | Service | Description |
|----------|---------|-------------|
| `/api/health` | api-core | Healthcheck HTTP |
| `/health` | ml-service | Healthcheck Python |
| Traefik Dashboard | `:8080/dashboard/` | État des routes et load balancers |
| pgAdmin | `:5050` | Administration des bases de données |

### Workers — Jobs de surveillance

| Job | Fréquence | Action |
|-----|-----------|--------|
| `queue_health` | 10 min | Vérifie la santé des files BullMQ |
| `pipeline_heartbeat` | 10 min | Heartbeat du pipeline d'ingestion |
| `check_stale_devices` | 5 min | Détecte les compteurs silencieux |
| `check_aggregation_gaps` | 15 min | Détecte les trous dans les agrégations |

---

## 15. Diagramme de séquence — Lecture d'un compteur

```
Acrel    Milesight    Ingestion    core-db    telemetry-db    Redis    Worker
  │         │            │           │            │            │         │
  │──data──►│            │           │            │            │         │
  │         │──POST /milesight──────►│           │            │         │
  │         │            │──lookup gateway──────►│            │         │
  │         │            │◄─────── gw info ──────│            │         │
  │         │            │──lookup device────────►│           │         │
  │         │            │◄─────── point info ───│            │         │
  │         │            │──INSERT reading──────────────────►│         │
  │         │            │──publish job──────────────────────►│        │
  │         │◄── 200 OK──│           │            │           │         │
  │         │            │           │            │           │──job──►│
  │         │            │           │            │           │         │──agg 15m──►│
  │         │            │           │            │           │         │──agg daily─►│
```
