# SIMES-BF — Architecture Complète

## 1. Introduction

**SIMES-BF** — *Système Intelligent de Management Énergétique et de prédimensionnement Solaire* — est une plateforme de **surveillance énergétique, d'analyse des consommations électriques et de prédimensionnement de systèmes photovoltaïques** déployée au Burkina Faso.

### Objectifs

- Collecter les télémesures de **compteurs Acrel triphasés ADW3000** via des **passerelles LoRa Milesight UG67**
- Stocker les données dans des bases **time-series optimisées**
- Fournir un **tableau de bord temps réel** pour les opérateurs
- Intégrer des **modèles ML** (LightGBM) pour les prédictions énergétiques et détection d'anomalies
- Supporter le **prédimensionnement de systèmes solaires** basé sur les courbes de charge réelles

### Stack technologique

| Couche | Technologie |
|--------|------------|
| **Frontend** | React 18.3 · Vite 5.4 · TypeScript · TailwindCSS · Recharts · TanStack Query v5 |
| **API** | Node.js · Express 5.2 · Zod · JWT HS256 |
| **Ingestion** | Node.js · Express 5.2 · Event-driven |
| **Edge (Gateway)** | Node-RED (sur UG67) · Batching · Retry queue |
| **Workers** | Node.js · BullMQ · Cron |
| **ML** | Python · FastAPI · LightGBM 4.5 · scikit-learn |
| **Relationnelle** | PostgreSQL 16 |
| **Time-series** | TimescaleDB (PostgreSQL 16) |
| **Cache & Queue** | Redis 7 |
| **Stockage objet** | MinIO |
| **Reverse proxy** | Traefik v2.11 |
| **Orchestration** | Docker Compose |

---

# 2. Architecture Globale du Système

## Diagramme d'architecture générale

```mermaid
flowchart LR
    ACREL["📊 Analyseur Acrel<br/>ADW3000"]
    
    UG67["🛰️ Gateway LoRaWAN<br/>Milesight UG67<br/>+ Node-RED"]
    
    subgraph edge["Edge Computing"]
        NR["Node-RED<br/>Normalize + Batch"]
    end
    
    subgraph cloud["Cloud SIMES-BF"]
        Traefik["⚙️ Reverse Proxy<br/>Traefik"]
        
        subgraph services["Services Exposés"]
            UI["🎨 Frontend<br/>React + Nginx"]
            API["🔌 API Core<br/>Express 3000"]
            Ingest["📥 Ingestion<br/>Express 3001"]
        end
        
        subgraph internal["Réseau Interne"]
            Workers["⚙️ Workers<br/>BullMQ + Redis"]
            MLService["🤖 ML Service<br/>FastAPI"]
        end
        
        subgraph databases["Données"]
            CoreDB["🗄️ Core DB<br/>PostgreSQL"]
            TelemetryDB["📈 Telemetry DB<br/>TimescaleDB"]
            Redis["🔴 Redis<br/>Cache & Queue"]
            MinIO["📦 MinIO<br/>Stockage"]
        end
    end
    
    User["👤 Utilisateur"]
    
    ACREL -->|LoRaWAN| UG67
    UG67 -->|Uplinks| NR
    NR -->|HTTP Batch| Ingest
    
    User -->|HTTP| Traefik
    Traefik -->|/| UI
    Traefik -->|/api| API
    Traefik -->|/ingest| Ingest
    
    API --> CoreDB
    API --> TelemetryDB
    Ingest --> TelemetryDB
    Ingest --> Redis
    
    Redis --> Workers
    Workers --> CoreDB
    Workers --> MinIO
    Workers --> MLService
    
    MLService --> TelemetryDB
    MLService --> CoreDB
    
    UI -.->|Query| API
```

---

# 3. Architecture Microservices

## Vue logique des services

```mermaid
flowchart TB
    subgraph gateway["EDGE LAYER (UG67 Gateway)"]
        NR["Node-RED Pipeline<br/>- Normalize<br/>- Merge State<br/>- Batch Builder<br/>- Retry Queue"]
    end
    
    subgraph frontend["API LAYER"]
        Traefik["Traefik<br/>(Routing)"]
        UI["Frontend<br/>(React)"]
        API["API Core<br/>(Express)"]
        Ingest["Ingestion Service<br/>(Express)"]
    end
    
    subgraph processing["PROCESSING LAYER"]
        Workers["Worker Jobs<br/>(BullMQ)<br/>- Telemetry<br/>- AI<br/>- Reports"]
        MLService["ML Service<br/>(FastAPI)<br/>- Forecast<br/>- Anomalies"]
    end
    
    subgraph storage["STORAGE LAYER"]
        CoreDB["Core DB<br/>(PostgreSQL)<br/>Référentiel"]
        TelemetryDB["Telemetry DB<br/>(TimescaleDB)<br/>Séries temporelles"]
        Redis["Redis<br/>Cache & Queues"]
        MinIO["MinIO<br/>Fichiers"]
    end
    
    NR -->|POST /ingest/milesight| Ingest
    
    Traefik -.->|routing| UI
    Traefik -.->|routing| API
    Traefik -.->|routing| Ingest
    
    UI -.->|fetch| API
    API --> CoreDB
    API --> TelemetryDB
    
    Ingest --> TelemetryDB
    Ingest --> Redis
    
    Redis --> Workers
    Workers --> CoreDB
    Workers --> TelemetryDB
    Workers --> MinIO
    Workers --> MLService
    
    MLService --> TelemetryDB
    MLService --> CoreDB
```

---

# 4. Architecture Déploiement Docker

## Conteneurs et réseaux

```mermaid
flowchart TB
    subgraph host["Docker Host"]
        subgraph edge_net["Réseau: simes-edge<br/>(Publique)"]
            Traefik["traefik:80/8080"]
            UI["frontend:80"]
            API["api-core:3000"]
            Ingest["ingestion:3001"]
        end
        
        subgraph internal_net["Réseau: simes-internal<br/>(Privé)"]
            Workers["worker-jobs"]
            MLService["ml-service:8000"]
            CoreDB["core-db:5432"]
            TelemetryDB["telemetry-db:5432"]
            Redis["redis:6379"]
            MinIO["minio:9000"]
            pgAdmin["pgadmin:5050"]
        end
    end
    
    User["Utilisateur<br/>Internet"]
    
    User -->|HTTP| Traefik
    
    Traefik -->|simes-edge| UI
    Traefik -->|simes-edge| API
    Traefik -->|simes-edge| Ingest
    
    API -->|simes-internal| CoreDB
    API -->|simes-internal| TelemetryDB
    
    Ingest -->|simes-internal| TelemetryDB
    Ingest -->|simes-internal| Redis
    
    Redis -->|simes-internal| Workers
    Workers -->|simes-internal| CoreDB
    Workers -->|simes-internal| TelemetryDB
    Workers -->|simes-internal| MinIO
    Workers -->|simes-internal| MLService
    
    MLService -->|simes-internal| TelemetryDB
    MLService -->|simes-internal| CoreDB
```

### Volumes persistants

| Volume | Service | Données |
|--------|---------|---------|
| `core_db_data` | core-db | Référentiel (organisations, sites, terrains, users) |
| `telemetry_db_data` | telemetry-db | Time-series (lectures, agrégations, prédictions) |
| `redis_data` | redis | Cache + files BullMQ |
| `minio_data` | minio | Exports, rapports, fichiers |
| `ml_models_data` | ml-service | Modèles LightGBM entraînés |
| `pgadmin_data` | pgadmin | Configuration |

---

# 5. Composants Détaillés

## 5.1 Reverse Proxy — Traefik

**Rôle** : Point d'entrée unique, routage HTTP, SSL/TLS (optionnel)

**Configuration** :
```
Service : traefik (image: traefik:v2.11)
Ports : 80 (HTTP), 8080 (Dashboard)
Réseau : simes-edge

Routes :
  PathPrefix(/)       → frontend-web:80        (priority 1)
  PathPrefix(/api)    → api-core:3000          (priority 10, strip /api)
  PathPrefix(/ingest) → ingestion-service:3001 (priority 10, strip /ingest)
```

**Justification** : 
- ✅ Intégration native Docker (auto-découverte services)
- ✅ Configuration dynamique (vs nginx complexe)
- ✅ Moderne et maintenable

---

## 5.2 Interface Web (Frontend)

**Rôle** : Tableau de bord temps réel, visualisation, exports

**Technologies** :
- React 18.3
- Vite 5.4
- TypeScript 5.8
- TailwindCSS
- Recharts (graphiques)
- TanStack Query v5 (gestion état serveur)

**Structure** :
```
src/
├── App.tsx              # Router principal
├── contexts/            # Auth + Terrain + Appbridge
├── hooks/               # useApi() wrapper React Query
├── lib/                 # widget-registry (18 widgets)
├── components/
│   ├── widgets/         # Dashboard widgets
│   ├── ui/              # shadcn/ui components
├── pages/               # 24 pages lazy-loaded
└── types/               # TypeScript types
```

**24 Pages** :
- 15 pages organisation (dashboard, zones, données, facture, solaire, anomalies, etc.)
- 9 pages plateforme admin (NOC, incidents, tenants, gateways, devices, pipeline, logs, purge)

**Rendering** : Nginx sert fichiers statiques (build Vite)

---

## 5.3 API Core (Express 5.2)

**Port** : 3000 (interne) — Exposé via Traefik `/api`

**Rôle** : Cœur logique, accès données, gestion métier

**Stack** :
- Node.js + Express 5.2
- PostgreSQL 16 (core-db)
- TimescaleDB (telemetry-db)

**Middleware chain** :
```
helmet() 
  → CORS 
  → Rate-limit (200 req/min) 
  → JSON parser 
  → JWT auth 
  → Zod validation 
  → routes
```

**Authentification** :
- JWT HS256, 24h expiration
- Bcrypt (salt 12)
- 5 tentatives max avant verrouillage
- Admin par défaut : `admin@simes.bf` / `admin1234`

**60+ endpoints** organisés par module :

| Module | Routes | Exemple |
|--------|--------|---------|
| Auth | 4 | POST /auth/login, GET /auth/me |
| Référentiel | 15 | GET/POST /organizations, /sites, /terrains |
| Télémétrie | 10 | GET /terrains/:id/overview, /readings, /chart-data |
| Exports | 2 | GET /terrains/:id/export |
| Tarifs | 2 | GET /tariffs, PUT /terrains/:id/contract |
| Admin | 10 | GET /admin/gateways, PUT /admin/devices/:eui/map |
| Jobs | 4 | POST /jobs/facture, GET /runs |
| AI/ML | 4 | POST /ai/train, GET /ai/forecast, /ai/anomalies |
| Incidents | 4 | GET/POST /incidents, /incidents/stats |

---

## 5.4 Service d'Ingestion (Express 5.2)

**Port** : 3001 (interne) — Exposé via Traefik `/ingest`

**Rôle** : Normalisation, validation, insertion télémétrie

**Pipeline** :
```
1. POST /milesight (service interne) ou /ingest/milesight (exposé Traefik, depuis Node-RED)
2. Décodage UG67/Node-RED payload
3. Lookup passerelle (gateway_registry)
4. Lookup compteur (device_registry → measurement_point)
5. Mapping champs Acrel → colonnes telemetry-db
6. Validation Zod
7. INSERT acrel_readings (upsert par point + timestamp)
8. Publish job BullMQ (queue: telemetry)
```

**Routes** :
```
POST /milesight              # Webhook Milesight direct
POST /ingest/milesight      # Endpoint public via Traefik pour Node-RED
POST /acrel                 # Ingestion directe (debug)
POST /acrel/batch           # Ingestion batch direct
```

**Mapping des champs** (ADW3000Codec.js) :
```
"Ua"   → voltage_a
"Ub"   → voltage_b
"Uc"   → voltage_c
"Ia"   → current_a
"P"    → active_power_total
"Ep+"  → energy_import
... (60+ champs Acrel)
```

---

## 5.5 Node-RED (Sur UG67 Gateway)

**Exécution** : Directement sur la **passerelle Milesight UG67** (edge computing)

**Rôle** : Edge processing, normalisation, batching, résilience réseau

### Pipeline Node-RED

```
LoRaWAN Uplinks (depuis compteurs Acrel)
    ↓
1. Normalize      → Standardiser format (devEUI, ts, radio, data)
    ↓
2. Merge State    → Fusionner paquets multi-fragmentés
    ↓
3. Batch Builder  → Tous les 10 min : réunir tous les compteurs
    ↓
4. HTTP Sender    → POST /ingest/milesight vers backend
    ↓
5. Retry Queue    → Si erreur : queue locale, retry toutes les 60 sec
```

### État et résilience

```javascript
// Stockage local (volatil)
flow.set("states", {...});   // État courant des compteurs
flow.set("queue", [...]);    // Queue de retry

// Limites acceptées :
// - RTO ~10 min (données non envoyées avant redémarrage)
// - Donn. jamais perdues (restent sur compteur Acrel)
// - Amélioration future : persister en SQLite
```

### Batching & fusion

```
Compteur A envoie :
  10:00:00 → {Ua, Ub, Uc}
  10:00:05 → {Ia, Ib, Ic}
  10:00:10 → {P, E}

Merge :
  state[A].data = {Ua, Ub, Uc, Ia, Ib, Ic, P, E}

10:10:00 → Batch 1 envoyé avec snapshot complet

Si un paquet arrive 10:10:05 (trop tard) :
  → Inclus dans Batch 2 (10:20:00) ✓ Pas de perte
```

### Avantages edge vs direct webhook

| Métrique | Direct webhook | Node-RED batching |
|----------|---|---|
| Messages/jour | 60 compteurs × ~1440 = 86,400 | ~144 batches | 💰 **600x réduction** |
| Bande passante | Élevée | Très faible |
| Buffering réseau | Non | Oui (queue locale) |
| Overhead HTTP | Max | Min |

---

## 5.6 Workers — Traitements Asynchrones (BullMQ)

**Rôle** : Exécuter les jobs lourds asynchrones

**Technologie** : BullMQ + Redis

**3 files d'attente** :

### Queue: telemetry
Jobs d'agrégation et nettoyage :
- Calcul delta énergie (lecture − précédente)
- Upsert acrel_agg_15m (agrégation 15 min)
- Upsert acrel_agg_daily (agrégation journalière)
- Détection lacunes données
- Nettoyage messages non mappés

### Queue: ai
Jobs ML :
- Entraînement modèles LightGBM
- Détection anomalies (residual + IsolationForest)
- Génération prédictions

### Queue: reports
Jobs rapports/exports :
- Calcul factures SONABEL
- Exports CSV
- Génération rapports énergie

### Jobs planifiés (Cron)

| Cron | Job | Description |
|------|-----|-------------|
| `*/2 * * * *` | cleanup_unmapped | Nettoyer messages non mappés |
| `*/5 * * * *` | check_stale_devices | Détecter compteurs silencieux |
| `*/15 * * * *` | check_aggregation_gaps | Vérifier trous agrégation |
| `*/10 * * * *` | queue_health | Santé files d'attente |
| `*/10 * * * *` | pipeline_heartbeat | Heartbeat pipeline |
| `0 2 * * *` | compute_power_peaks | Picks puissance quotidiens |
| `0 3 * * *` | retrain_forecasts | Ré-entraînement ML |
| `0 4 * * *` | detect_anomalies | Détection anomalies |

### Job exemple: Facture SONABEL

```
1. Charger contrat terrain (tarif + puissance souscrite)
2. Récupérer agr_daily sur période (mois)
3. Classifier par tranche SONABEL :
   - Pointe : 17h-22h semaine (tarif élevé)
   - Pleine : 07h-17h semaine (tarif moyen)
   - Creuse : 22h-07h + weekend (tarif faible)
   - Valley : optionnel selon plan
4. Appliquer barème progressif (DFS, D2S, D3S, E1, E2, E3, G)
5. Calculer pénalités factor power (cos φ < 0.9)
6. Stocker résultat dans job_results
```

---

## 5.7 ML Service (FastAPI + LightGBM)

**Port** : 8000 (réseau interne uniquement)

**Rôle** : Prédictions énergétiques, détection anomalies

### Prévisions énergétiques

**Modèle** : LightGBM GBDT + modèles quantile (P10, P90)

**Features engineering** :
```
Input : 365 jours d'agrégation daily
├─ day_of_week (0-6)
├─ month (1-12)
├─ lag_1d, lag_7d, lag_14d (énergie passée)
├─ rolling_avg_7d, rolling_avg_30d
└─ rolling_std_7d

Pipeline :
├─ Train/test split (80/20)
├─ LightGBM GBDT (n_estimators=100)
├─ Modèles quantile P10 & P90 (intervalles confiance)
└─ Sauvegarde modèle (.pkl) dans `/data/models/`
```

### Détection d'anomalies

**Deux méthodes combinées** :

1. **Résiduelle** : 
   - Écart prédiction vs réel > 2σ
   - Seuils adaptatifs, sévérité par z-score

2. **IsolationForest** :
   - contamination=0.1
   - 100 estimators

**Output** : Table `energy_anomalies` (severity: low|medium|high|critical)

### Endpoints

```
POST   /train                    # Entraîner modèle terrain
POST   /train-all               # Entraîner tous les terrains
GET    /predict/?terrain_id=X   # Prédictions
GET    /predictions/{terrain_id} # Historique prédictions
POST   /anomalies/detect/:id    # Lancer détection anomalies
GET    /anomalies/{terrain_id}  # Récupérer anomalies
GET    /health                  # Santé service
```

---

# 6. Bases de Données

## 6.1 Core Database (PostgreSQL 16)

**Rôle** : Données référentielles et métier

### Schéma principal

```
organizations
  └── sites
       └── terrains
            ├── zones
            │    └── measurement_points
            ├── terrain_contracts (→ tariff_plans)
            └── power_peaks (via worker)

users (org_id → organizations)
  roles: platform_super_admin | org_admin | operator | manager

gateway_registry               # Passerelles LoRaWAN (UG67)
device_registry               # Compteurs Acrel (linked → points)

tariff_plans                  # Grilles tarifaires SONABEL
  seeds: D1, D2, D3, E1, E2, E3, G + tarification par tranche

runs / job_results            # Historique jobs (facture, exports)

incidents / audit_logs        # Incidents détectés + audit trail
users.settings               # Préférences utilisateur (JSONB, ajouté par migration)

incoming_messages             # Messages IoT bruts (FIFO debug)
schema_migrations             # Suivi migrations
```

### Tables critiques

| Table | Clé | Taille estimée | TTL |
|-------|-----|---|---|
| organizations | UUID | 10 rows | ∞ |
| sites | UUID | 50 rows | ∞ |
| terrains | UUID | 200 rows | ∞ |
| measurement_points | UUID | 6,000 points | ∞ |
| users | UUID | 500 rows | ∞ |
| job_results | UUID | 10M rows/an | 2 ans |
| audit_logs | UUID | 100M rows/an | 3 ans |
| incoming_messages | UUID | FIFO, 10K buffer | 7 jours |

---

## 6.2 Telemetry Database (TimescaleDB) — Réalité Implémentée

**Rôle** : Stockage time-series optimisé (60+ GB/an avec compression 60-70%)

**Extensions** : TimescaleDB (hypertable chunking automatique, compression)

### Hypertables et Agrégations

#### `acrel_readings` — Raw time-series
**Clé** : (point_id, time) | **Hypertable** : partitionnée par time

**60+ colonnes réelles** (schema-telemetry.sql) :

| Catégorie | Colonnes |
|-----------|----------|
| **Tensions (V)** | voltage_a, voltage_b, voltage_c, voltage_ab, voltage_bc, voltage_ca |
| **Courants (A)** | current_a, current_b, current_c, current_sum, aftercurrent |
| **Puissance active (kW)** | active_power_a, active_power_b, active_power_c, active_power_total |
| **Puissance réactive (kVar)** | reactive_power_a, reactive_power_b, reactive_power_c, reactive_power_total |
| **Puissance apparente (kVA)** | apparent_power_a, apparent_power_b, apparent_power_c, apparent_power_total |
| **Facteur puissance** | power_factor_a, power_factor_b, power_factor_c, power_factor_total |
| **Fréquence** | frequency, voltage_unbalance, current_unbalance |
| **Énergie totale (kWh)** | energy_total, energy_import, energy_export, reactive_energy_import, reactive_energy_export |
| **Énergie par phase** | energy_total_a/b/c, energy_import_a/b/c, energy_export_a/b/c |
| **Tranches SONABEL** | energy_spike, energy_peak, energy_flat, energy_valley |
| **THD (%)** | thdu_a, thdu_b, thdu_c, thdi_a, thdi_b, thdi_c |
| **Température (°C)** | temp_a, temp_b, temp_c, temp_n |
| **I/O digitales** | di_state, do1_state, do2_state, alarm_state (bitmask BIGINT) |
| **Signal LoRa** | rssi_lora, rssi_gateway, snr_gateway, f_cnt |
| **Brut** | raw (JSONB — payload d'origine Milesight) |

**Métadonnées organisationnelles** :
- org_id, site_id, terrain_id, point_id (UUID) — pour jointures rapides
- time (TIMESTAMPTZ) — clé d'agrégation

**Index** :
```sql
CREATE INDEX acrel_point_time_idx ON acrel_readings (point_id, time DESC);
CREATE INDEX acrel_terrain_point_time_idx ON acrel_readings (terrain_id, point_id, time DESC);
CREATE UNIQUE INDEX ux_acrel_readings_point_time ON acrel_readings (point_id, time);
-- Pour DISTINCT ON queries (dernière lecture par point)
```

#### `acrel_agg_15m` — Agrégation 15 minutes

| Colonne | Type | Rôle | Source |
|---------|------|------|--------|
| bucket_start | TIMESTAMPTZ | Clé (15min bucket) | time_bucket('15 min', time) |
| org_id, site_id, terrain_id, point_id | UUID | Jointure rapide | FK |
| samples_count | INT | Nombre lectures dans le bucket | COUNT(*) |
| active_power_avg | DOUBLE | Puissance moyenne (kW) | AVG(active_power_total) |
| active_power_max | DOUBLE | Puissance max (kW) | MAX(active_power_total) |
| voltage_a_avg | DOUBLE | Tension phase A moyenne (V) | AVG(voltage_a) |
| energy_import_delta | DOUBLE | ∆ énergie importée (kWh) | MAX(energy_import) - MIN(energy_import) |
| energy_export_delta | DOUBLE | ∆ énergie exportée (kWh) | MAX(energy_export) - MIN(energy_export) |
| energy_total_delta | DOUBLE | ∆ énergie totale (kWh) | MAX(energy_total) - MIN(energy_total) |
| reactive_energy_import_delta | DOUBLE | ∆ énergie réactive (kVar·h) | **Billing V2 NEW** |
| power_factor_avg | DOUBLE | Facteur puissance moyen | **Billing V2 NEW** |

**Clé primaire** : (point_id, bucket_start)

#### `acrel_agg_daily` — Agrégation journalière

Même structure que `acrel_agg_15m` mais :
- **Clé** : (point_id, day) 
- **Granularité** : 1 jour
- **Rôle** : Dashboard KPIs, calculs facture

#### `power_peaks`
**Pics de puissance quotidiens** (calculés par cron 0 2 * * *) :

| Colonne | Type | Description |
|---------|------|---|
| terrain_id | UUID | Terrain |
| point_id | UUID | Point de mesure |
| peak_date | DATE | Jour |
| max_power | DOUBLE | Puissance max (kW) |
| peak_time | TIMESTAMPTZ | Horodatage du pic |

#### `ml_predictions`
**Prédictions ML** (insérées par ai.worker via ml-service) :

| Colonne | Type | Description |
|---------|------|---|
| terrain_id | UUID | Terrain prédit |
| predicted_day | DATE | Jour prédit |
| predicted_kwh | DOUBLE | Énergie prédite (kWh) |
| lower_bound | DOUBLE | Percentile P10 (confiance 10%) |
| upper_bound | DOUBLE | Percentile P90 (confiance 90%) |
| actual_kwh | DOUBLE | Énergie réelle (rempli après J+1) → NULL si futur |
| error_pct | DOUBLE | Erreur relative (%) = 100×(actual-predicted)/actual |
| model_version | TEXT | Identifiant modèle LightGBM |
| created_at | TIMESTAMPTZ | Timestamp génération |

#### `energy_anomalies`
**Anomalies détectées** (insérées par ai.worker) :

| Colonne | Type | Description |
|---------|------|---|
| terrain_id | UUID | Terrain |
| anomaly_date | DATE | Date détection |
| anomaly_type | TEXT | `residual` (écart 2σ) \| `isolation_forest` \| `threshold` |
| severity | TEXT | `low` \| `medium` \| `high` \| `critical` |
| score | DOUBLE | Score anomalie [0, 1] |
| expected_kwh | DOUBLE | Valeur attendue (prédiction) |
| actual_kwh | DOUBLE | Valeur réelle (observée) |
| deviation_pct | DOUBLE | Écart (%) = 100×(actual-expected)/expected |
| created_at | TIMESTAMPTZ | Timestamp détection |

### Compression & Retention

**TimescaleDB Continuous Aggregates** (optionnel, futur) :
```sql
SELECT add_continuous_aggregate_policy('acrel_agg_15m',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);
```

**Compression** (auto par TimescaleDB) :
- Données > 7 jours compressées automatiquement
- Ratio typique : 70% réduction (15 GB → 4.5 GB)

**Retention** (optionnel) :
- acrel_readings : conservé 2-3 ans (compressé après 7j)
- Agrégations : conservées indéfiniment (faible volume)
- ml_predictions : conservées 5 ans (audit)

---

## 6.3 Migrations

**Système** : Migration files dans `infra/db/migrations/` numérotées `NNN_<target>_<description>.sql`

**Routage automatique** :
- Fichiers contenant **telemetry** ou **agg** → exécutés sur **telemetry-db**
- Tous autres → exécutés sur **core-db**

### Liste des migrations (18 fichiers)

| # | Fichier | Target | Description |
|---|---------|--------|-------------|
| 001 | 001_core_job_results.sql | core | Table `job_results` (historique jobs) |
| 002 | 002_telemetry_acrel_agg.sql | telemetry | Hypertables `acrel_agg_15m`, `acrel_agg_daily` |
| 003 | 003_core_tariffs.sql | core | Tables `tariff_plans`, `terrain_contracts` |
| 004 | 004_core_tariffs_seed_202310.sql | core | Seed données SONABEL (D1-D3, E1-E3, G) |
| 005 | 005_core_incoming_and_mapping.sql | core | Tables `incoming_messages`, `gateway_registry`, `device_registry` |
| 006 | 006_core_users.sql | core | Table `users` avec rôles RBAC |
| 007 | 007_core_incidents_and_logs.sql | core | Tables `incidents`, `audit_logs` |
| 008 | 008_user_settings.sql | core | Colonne `users.settings` (JSONB préférences) |
| 009 | 009_agg_indexes.sql | telemetry | Index sur acrel_agg_15m, acrel_agg_daily |
| 010 | 010_telemetry_energy_total_delta.sql | telemetry | Colonne `energy_total_delta`, table `ml_predictions` |
| 011 | 011_telemetry_power_peaks.sql | telemetry | Table `power_peaks` |
| 012 | 012_telemetry_energy_anomalies.sql | telemetry | Table `energy_anomalies` |
| 013 | 013_backfill_agg_from_readings.sql | telemetry | Backfill agrégations depuis raw readings |
| 014 | 014_telemetry_trash_tables.sql | telemetry | Tables trash + `purge_batches` |
| 015a | 015a_telemetry_billing_v2_agg_columns.sql | telemetry | Colonnes billing V2 sur agg |
| 015b | 015b_core_billing_v2_tariff_columns.sql | core | Colonnes billing V2 sur tarifs/contrats |
| 015 | 015_anomaly_analysis_state.sql | telemetry | État d'analyse anomalies (legacy) |
| 016 | 016_telemetry_energy_anomalies_dedupe.sql | telemetry | Déduplication + index unique anomalies |
| 017 | 017_anomaly_analysis_state.sql | telemetry | État d'analyse anomalies (version récente) |
| 018 | 018_backfill_daily_agg.sql | telemetry | Backfill daily aggregates |

**Note d'audit**:
- Le runner `migrate.js` route les migrations par nom de fichier (`telemetry` / `agg`).
- Les objets métiers `incidents`, `audit_logs`, `ml_predictions`, `energy_anomalies`, `power_peaks` proviennent des migrations (pas du `schema-*.sql` de base).

**Exécution** (via `migrate.js`) :
```bash
node migrate.js --db core      # Exécute migrations core uniquement
node migrate.js --db telemetry # Exécute migrations telemetry uniquement
node migrate.js                # Exécute tout
```

---

# 7. Flux de Données — Bout à Bout

## Pipeline complet

```mermaid
flowchart LR
    ACREL["📊 Compteur Acrel<br/>ADW3000"]
    
    UG67["🛰️ UG67 Gateway"]
    
    NRED["Node-RED<br/>- Normalize<br/>- Merge<br/>- Batch"]
    
    INGEST["Ingestion<br/>Express<br/>POST /ingest/milesight"]
    
    TELDB["Telemetry DB<br/>acrel_readings"]
    
    REDIS["Redis<br/>BullMQ Queues"]
    
    WORKER_TEL["Worker: Telemetry<br/>- Calc delta<br/>- Agg 15m<br/>- Agg daily"]
    
    WORKER_AI["Worker: AI<br/>- Train<br/>- Forecast<br/>- Anomalies"]
    
    MLSVC["ML Service<br/>LightGBM"]
    
    COREDB["Core DB<br/>référentiel"]
    
    API["API Core<br/>Express<br/>60+ endpoints"]
    
    UI["Frontend<br/>React<br/>24 pages"]
    
    USER["👤 Utilisateur"]
    
    ACREL -->|LoRaWAN| UG67
    UG67 -->|Uplinks| NRED
    NRED -->|HTTP<br/>POST /ingest/milesight<br/>Toutes 10 min| INGEST
    
    INGEST -->|Normalise<br/>Valide| TELDB
    INGEST -->|Publish| REDIS
    
    REDIS -->|Pop| WORKER_TEL
    WORKER_TEL -->|Agg| TELDB
    
    REDIS -->|Pop| WORKER_AI
    WORKER_AI -->|Entraîne<br/>Prédit| MLSVC
    
    MLSVC -->|Write<br/>ml_predictions<br/>energy_anomalies| TELDB
    MLSVC -->|Write<br/>incidents| COREDB
    
    API -->|Read/Write| TELDB
    API -->|Read/Write| COREDB
    
    UI -->|Query| API
    USER -->|Interact| UI
```

### Latencies

| Étape | Latency |
|-------|---------|
| Compteur → UG67 (LoRa) | < 1 sec |
| UG67 → Batch queue (Node-RED) | ~10 min (batch window) |
| Batch → Backend (HTTP) | 1-5 sec (réseau) |
| Backend → Telemetry DB (upsert) | 100-500 ms (60 lectures) |
| Worker agg (15m) | 1-2 sec |
| Worker agg (daily) | 2-5 sec |
| ML forecast (batch) | 5-30 sec (entrainement) |
| API response (/overview) | 200-500 ms |
| Frontend render | 100-300 ms (React) |
| **Total (data → dashboard)** | **~15-20 min** (après batch) |

---

# 8. Architecture Decision Records (ADR)

## ADR-001 : Reverse Proxy — Traefik

### Contexte
Besoin d'un point d'entrée unique pour 3 services (Frontend, API, Ingestion-service) en permettant évolution future.

### Alternatives
- **Nginx** : Très performant, mais config manuelle complexe
- **HAProxy** : Très rapide, mais moins d'intégration Docker
- **Traefik** ✅ choisi: Auto-discovery Docker, config dynamique

### Décision
**Traefik v2.11**

### Justification
- ✅ Auto-découverte services Docker via labels
- ✅ Configuration dynamique (pas de restart needed)
- ✅ Meilleur support micro-services
- ✅ Dashboard intégré (:8080)

### Trade-offs
- ⚠️ Moins connu que nginx (support communauté légèrement moins riche)
- ⚠️ Un peu plus gourmand en ressources (négligeable)

---

## ADR-002 : Backend — Node.js + Express

### Contexte
API I/O intensive, besoin de rapidité de développement et large écosystème.

### Alternatives
- **Python (FastAPI)** : Excellent, mais moins adapté I/O synchrone
- **Java (Spring)** : Performant, mais lourd (startup, maintenance)
- **Node.js** ✅ choisi: Parfait pour APIs I/O

### Décision
**Node.js + Express 5.2**

### Justification
- ✅ Idéal pour APIs I/O intensives (async/await)
- ✅ Large écosystème npm
- ✅ Rapidité développement
- ✅ Même langage que Ingestion + Workers (unification)

### Trade-offs
- ⚠️ Single-threaded (CPU-intensive moins adapté)
- ⚠️ Moins type-safe (vs Java/TypeScript typed au runtime)

---

## ADR-003 : Telemetry DB — TimescaleDB vs InfluxDB

### Contexte
Stocker ~50 GB/an de données time-series (température, puissance, énergie) avec query complexes sur agrégations.

### Alternatives

| Critère | PostgreSQL | TimescaleDB | InfluxDB |
|---------|-----------|------------|----------|
| SQL | Standard | SQL complet | Propriétaire (InfluxQL/Flux) |
| Compression | Non | ✅ Intégrée | Basique |
| Agrégations | Via views | ✅ Intégrées (continuous agg) | Limitées |
| Join cross-table | ✅ | ✅ | Non |
| Infra | 1 instance | 1 instance | Cluster |
| Maintenance | Légère | Légère | Complexe cluster |

### Décision
**TimescaleDB (extension PostgreSQL 16)**

### Justification
- ✅ SQL standard (joins, aggregations complexes)
- ✅ Extension PostgreSQL (même instance que core-db = 1 seule BDD à maintenir)
- ✅ Compression automatique (réduction 60-70%)
- ✅ Support des continuous aggregates (activables si nécessaire)
- ✅ Queries complexes avec CTEs, window functions

### Trade-offs
- ⚠️ Moins orienté cloud-native que InfluxDB
- ⚠️ Clustering plus complexe que InfluxDB (mais not needed pour ce projet)

---

## ADR-004 : Queue System — BullMQ + Redis vs Kafka/RabbitMQ

### Contexte
Jobs asynchrones (agrégation, ML training, calcul factures). Besoin : fiabilité, redelivery, scheduling.

### Alternatives

| Critère | BullMQ+Redis | RabbitMQ | Kafka |
|---------|--------------|----------|-------|
| Langage natif | JavaScript | Erlang (CLI OK) | JVM (CLI OK) |
| Setup | 1 Redis instance | 1 broker + plugins | Cluster min 3 |
| Persistence | Redis persistence | ✅ Native | ✅ Native |
| Scheduling | ✅ Bull-specific | Via plugin | Non (Kafka Streams) |
| Monitoring | ✅ Bull UI | Plugins | Cluster tools |
| Ressources | Légères | Moyennes | Lourdes |
| Scaling | Horizontal (workers) | Horizontal | Native scaling |

### Décision
**BullMQ + Redis 7**

### Justification
- ✅ Minimal setup (juste Redis)
- ✅ Scheduling natif (Cron jobs facile)
- ✅ Integration seamless Node.js
- ✅ Suffisant pour ce débit (~86K events/jour)
- ✅ UI Bull intégrée (monitoring)

### Trade-offs (Limitations acceptées)
- ⚠️ Single Redis instance (no HA, need replication setup)
- ⚠️ Pas optimal pour très haut débit (Kafka meilleur > 1M events/sec)
- ⚠️ Persistence dépend Redis RDB/AOF (moins durable que Kafka commit log)

### Future scaling
Si débit dépasse 10M events/jour → migrate vers Kafka

---

## ADR-005 : Edge Computing — Node-RED sur UG67

### Contexte
60+ compteurs Acrel envoient multi-paquets LoRa. Envoyer 86K messages/jour au cloud = bande passante énorme.

### Alternatives

| Approche | Avantage | Inconvénient |
|----------|----------|------------|
| **Direct webhook** | Simple (aucun edge) | 86K appels HTTP/jour, pas buffering |
| **Kafka Gateway** | Durable, scalable | Complexe, heavy (UG67 limited) |
| **AWS Lambda** | Serverless, scaling auto | Latency, dépendance cloud, coûts |
| **Node-RED sur UG67** ✅ choisi | Batching local, buffering, fusion | État volatil, monitoring limité |
| **Custom Node.js edge app** | Contrôle total | Maintenance edge, logs difficiles |

### Décision
**Node-RED sur UG67**

### Justification
- ✅ Batching 10 min = **~600x réduction messages** (86K → 144 batches/jour)
- ✅ Fusion multi-paquets = snapshots cohérents
- ✅ Queue locale = buffering si réseau down
- ✅ Low-code (moins de bugs que custom code)
- ✅ UG67 CPU + RAM suffisant

### Trade-offs (Limitations acceptées fin du projet)
- ⚠️ État en mémoire volatil (redémarrage = perte < 10 min données)
- ⚠️ Monitoring zéro (improvement future via healthcheck endpoint)
- ⚠️ No HA (single gateway instance)

### Futures améliorations
- [ ] Persister queue en SQLite local (backup)
- [ ] Healthcheck HTTP endpoint
- [ ] Prometheus metrics export
- [ ] Multi-gateway HA setup

---

## ADR-006 : ML — LightGBM vs XGBoost

### Contexte
Prédictions énergétiques et détection anomalies sur séries temporelles. Données : 365 jours, ~4 features par jour.

### Alternatives

| Critère | LightGBM | XGBoost | Sklearn RF |
|---------|----------|---------|-----------|
| Speed training | ✅ Très rapide | Moyen | Rapide |
| Catégoriques | ✅ Native | Non | Non |
| Memory | ✅ ~10x moins | Lourd | Léger |
| GPU support | ✅ Oui | Oui | Non |
| Quantile regression | ✅ Oui | Non-standard | Non |
| Production | ✅ pickle simple | Complexe | Simple |

### Décision
**LightGBM GBDT + modèles quantile (P10, P90)**

### Justification
- ✅ Training très rapide (daily retraining feasible)
- ✅ Quantile regression native (intervalles confiance P10/P90 facile)
- ✅ Léger (déploiement simple)
- ✅ Python sklearn compatible

### Trade-offs
- ⚠️ XGBoost légèrement plus robuste sur petits datasets (mais 365 jours = OK)
- ⚠️ Deep learning mieux pour très long terme (12+ mois)

---

# 9. Sécurité

| Mesure | Implémentation | Commentaire |
|--------|---|---|
| **Authentification** | JWT HS256, 24h expiry | Forte; token dans localStorage (XSS risk mitigé via CSP) |
| **Hachage mots de passe** | bcrypt salt 12 | Strong |
| **Lockout** | 5 tentatives erronées | Rate limit additional recommended |
| **Autorisation** | RBAC 4 rôles (platform_super_admin, org_admin, operator, manager) | Middleware `verifyTerrainAccess` |
| **Isolation réseau** | Docker networks (simes-edge public, simes-internal private) | ✅ Services internes inaccessibles Internet |
| **Rate limiting** | 200 req/min par IP | Basique; considérer token bucketing |
| **Headers sécurité** | Helmet.js (CSP, HSTS, X-Frame, X-Content-Type) | Standard; CSP audit needed |
| **Input validation** | Zod schemas sur tous endpoints | Excellent |
| **SQL injection** | Parameterized queries (ORM) | ✅ Aucun risque concaténation |
| **CORS** | Configurable via .env | À durcir : actuellement permissif |
| **Secrets** | Variables d'environnement (AWS Secrets Manager optional) | ✅ Pas de secrets en code |
| **TLS/SSL** | Optional (Traefik support) | Recommended production |
| **Audit logs** | Table audit_logs (tous write operations) | ✅ Traçabilité complète |
| **Session timeout** | JWT expiry 24h | Acceptable; refresh token optional |
| **OWASP Top 10** | Partiellement couvert | A01 (broken auth), A03 (injection) → Good; A05 (access control) → marginal |

---

# 10. Monitoring & Observabilité

## 10.1 Healthchecks Automatisés

### Endpoints de santé

| Service | Endpoint | Fréquence | Utilisateur |
|---------|----------|-----------|------------|
| **api-core** | `GET /api/health` | Traefik 30s, deploy.sh continuous | Docker engine |
| **ingestion-service** | `GET /ingest/health` | Traefik 30s | Docker engine |
| **ml-service** | `GET /health` | Traefik 30s | Docker engine |
| **core-db** | `pg_isready` (SQL) | Docker Compose 30s | Docker engine |
| **telemetry-db** | `pg_isready` (SQL) | Docker Compose 30s | Docker engine |
| **redis** | `redis-cli ping` | Docker Compose 30s | Docker engine |
| **traefik** | `:8080/dashboard` | Always up | Manual |

### State monitoring

```bash
# Voir état services d'un coup
docker compose ps

# Voir logs réels
docker compose logs -f api-core
docker compose logs -f worker-jobs
```

---

## 10.2 Admin Platform — Monitoring & Repair

### Pages de Monitoring (accès applicatif)

#### **NOC Overview** (`/platform`)

**Vue synthétique de la plateforme** — KPIs et alertes majeures

**Affichage** :
- 📊 Sites actifs / historique
- 📈 Terrains avec activité
- 🟢 🟡 🔴 État pipeline (healthy/degraded/down)
- 📍 Gateways avec dernier heartbeat
- ⚠️ Incidents actifs (count par severity)

**Données sources** :
- `GET /api/orgs` (sites count)
- `GET /api/terrains` (list + last reading timestamp)
- `GET /api/health/pipeline` (component status)
- `GET /api/admin/gateways` (last_seen, status)
- `GET /api/incidents/stats` (by severity)

---

#### **Pipeline Health** (`/platform/pipeline`)

**Monitoring détaillé pipeline données** — Diagnostic opérationnel

**KPIs Affichés** :
```
┌─ Composants actifs     →  Count healthy / total composants
├─ En panne             →  Count down + error status
├─ Latence moyenne      →  Average latency_ms all components
├─ Jobs échoués          →  Count failed jobs across all queues
└─ Statut global         →  OK | Dégradé | Arrêt
```

**Composants monitorés** (data from `/api/health/pipeline`) :

| Composant | Checks | Latency | Detail |
|-----------|--------|---------|--------|
| **Core DB** | Connexion SQL | Query time | Timestamp de test |
| **Telemetry DB** | Connexion SQL | Query time | Timestamp de test |
| **Redis** | PING command | Redis latency | PONG / erreur |
| **Telemetry Throughput** | Comptage 1h + dernière lecture | n/a | readings_last_hour, latest |
| **Queue: telemetry** (BullMQ) | Job count | n/a | waiting/active/failed/completed |
| **Queue: ai** (BullMQ) | Job count | n/a | waiting/active/failed/completed |
| **Queue: reports** (BullMQ) | Job count | n/a | waiting/active/failed/completed |

**Status Codes** :
- `up` = Vert = Fonctionnel normal
- `degraded` = Orange = Ralentissement ou jobs échoués accumulés
- `down` / `error` = Rouge = Service non répondant

---

#### **Jobs Management** (`/platform/jobs`)

**Historique et gestion des jobs** — Lancer / Annuler / Canceler / Debugger

**Liste complète jobs** avec filtres :
- Statut : queued | processing | completed | failed | cancelled
- Type : facture | forecast | report | aggregation | anomaly
- Date de création, durée, erreur si applicable

**Actions disponibles** :
- 🔄 **Retry failed jobs** (by queue)
  - POST `/admin/pipeline/retry-failed-jobs`
  - Relance automatiquement jusqu'à 3 attempts
  - Logs historique tentatives

- 🗑️ **Flush (delete) failed jobs** (confirmation requise : type "CONFIRM-FLUSH-JOBS")
  - POST `/admin/pipeline/flush-failed-jobs`
  - **Attention** : irréversible
  - Idéal après diagnostique d'un bug now-fixed

- ❌ **Cancel individual job**
  - POST `/jobs/cancel/{jobId}`
  - Arrête processing immédiatement
  - Logs audit

---

#### **Incidents** (`/platform/incidents`)

**Incidents système et anomalies détectées** — Créer / Assigner / Résoudre

**Incident types** (auto-créés par système ou manuels) :
- `device_stale` : Compteur n'a pas envoyé data > 24h
- `aggregation_gap` : Lacune détectée dans agrégation
- `queue_overflow` : File d'attente accumule trop d'items
- `ml_anomaly` : Anomalie énergétique par ML
- `manual` : Créé manuellement par opérateur

**Champs** :
- Severity : `low` | `medium` | `high` | `critical`
- Status : `open` | `investigating` | `resolved` | `false_alarm`
- Assigné à : utilisateur responsable
- Résolu à : timestamp (si resolved)

**Actions** :
```
POST  /incidents                   # Create manual incident
PATCH /incidents/{id}              # Update status, severity, assigned_to
GET   /incidents
GET   /incidents/stats
```

---

#### **Logs (Audit Trail)** (`/platform/logs`)

**Trace de TOUS les write operations** — Sécurité & compliance

**Enregistré système** (dans `audit_logs` table) :
- User action : login, logout, data modification
- API endpoint : qui, quand, payload, response
- Admin operations : retry jobs, flush queue, repair aggregations
- Error : 500s, validation failures, timeouts

**Colonnes** :
- level, source, message, metadata (JSONB), user_id, created_at

**Filtres** :
- Par date range
- Par utilisateur
- Par event_type regex
- Par severity (warn, error, critical)

**Export** : non implémenté actuellement (consultation + filtres + stats)

---

#### **Devices & Gateways** (`/platform/devices`, `/platform/gateways`)

**Inventory et connectivity status** — Détecter devices silencieux

**Gateways** :
- gateway_id, model (UG67+), last_seen, status (up|down|degraded)
- Nombre de compteurs connectés par gateway
- Signal LoRa stats (RSSI, SNR trends)

**Devices (Compteurs)** :
- device (lora_dev_eui ou modbus_addr), linked_point, last_reading, status
- Filter : `status='stale'` (no data > 24h)

**Alert rule** :
- auto-create `device_stale` incident si status='stale'

---

#### **Ingestion Lab** (`/platform/ingestion`)

**Test et debug pipeline d'ingestion** — Raw data analysis

**Features** :
1. **Incoming messages view** (FIFO debug log) :
   - Raw JSONB payloads reçues par gateway
   - Parsed field mapping (Acrel field → DB column)
   - Status : processed | pending_map | error

2. **Manual processing** :
   - Upload CSV ou JSON de lectures
   - Validate via Zod schema
   - Insert into acrel_readings

3. **Mapping UI** :
   - Voir current field mappings (Acrel ADW3000 fields → DB)
   - Ajouter/modifier mappings
   - Test avec JSON sample

4. **Performance stats** :
   - Messages/sec ingested
   - Avg latency Batch → DB
   - Error rate %

---

### 10.3 Admin Operations (API endpoints)

Règle réelle: ces endpoints sont protégés par `requireAuth`, et les actions admin pipeline sont en `requireRole('platform_super_admin')`.

#### Health & Diagnostics

```
GET  /api/health/pipeline
  → { ok, components[], checked_at }

GET  /api/health/db
  → { ok, now }
```

#### Repair Actions

```
POST /api/admin/pipeline/repair-aggregations
     body: { from: '2024-01-01', to: '2024-03-17', point_id?, terrain_id?, site_id? }
     → Re-aggregate sur date range (après detecté corruption données)
  → Retour: { ok, message, job }

POST /api/admin/pipeline/retry-failed-jobs
     body: { queue?: 'telemetry' | 'ai' | 'reports', limit?: 100 }
  → Relancer jobs échoués
     → Response: { retried: N, total_failed: M }

POST /api/admin/pipeline/flush-failed-jobs
  body: { queue?: 'telemetry', limit?: number }
     → Supprimer définitivement failed jobs
     → ⚠️ Irréversible — use avec precaution
     → Response: { removed: N }

POST /api/admin/pipeline/reprocess-unmapped
  body: { limit?: number }
  → Enqueue cleanup des messages non mappés
```

#### Incident Management

```
POST /api/incidents
GET  /api/incidents?status=open&severity=high
PATCH /api/incidents/{id}        # Update status, assigné, etc

GET  /api/incidents/stats        # Summary (by severity, status)
```

#### Logs

```
GET  /api/logs?search=keyword&level=error&limit=100
     → Audit logs (filtrés, paginated)

GET  /api/logs/stats
  → { stats: [{ level, count }] }

POST /api/logs/ui
  → Enregistre actions UI côté frontend
```

---

## 10.4 Observabilité — État Actuel vs. Futur

### MVP (Actuel)

| Aspect | Capacité | Limitation |
|--------|----------|-----------|
| **Status checks** | Healthchecks par service (pg_isready, redis ping) | Pas de trending |
| **Queue monitoring** | Visible via `/api/health/pipeline` | Pas d'historique |
| **Logs** | Stdout Docker (docker logs, docker compose logs) | Pas de recherche, pas de alertes |
| **Audit Trail** | Complet (audit_logs table) | Pas d'interface visuelle |
| **Alerting** | Manual via logs | Pas d'automated alerts |
| **Metrics** | Aucun système centralisé | Pas de Prometheus / Grafana |

### Améliorations Recommandées 🛣️

| Priorité | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 🔴 Critique | **Prometheus + Grafana dashboards** | 2-3j | Visibilité globale temps-réel |
| 🔴 Critique | **Centralized logging (ELK/Loki)** | 1-2j | Recherche logs + alertes |
| 🔴 Critique | **Alert rules** (queue > 1000, DB latency > 500ms) | 1j | Proactive incident detection |
| 🟠 Important | **Automated backups** (PostgreSQL + MinIO) | 2-3j | Disaster recovery |
| 🟠 Important | **Dead letter queue** (jobs échoués > 3 times) | 1j | Prevent infinite retry loops |
| 🟡 Medium | **Performance profiling** (APM like New Relic) | 1-2j | Bottleneck identification |
| 🟡 Medium | **Synthetic monitoring** (k6 load tests) | 1-2j | SLA compliance |
| 🟡 Medium | **Distributed tracing** (Jaeger/Zipkin) | 1-2j | End-to-end request flow |

---

## 10.5 Limitations Opérationnelles Connues

### Single-Instance Deployment ⚠️

**Statut** : ✅ Intentionnel (MVP) · ⚠️ Non production-ready pour HA

| Service | Instances | Risk | Mitigation |
|---------|-----------|------|-----------|
| **api-core** | 1 | Downtime = API inaccessible | Deploy behind load balancer (Nginx/HAProxy) + 2-3 replicas |
| **worker-jobs** | 1 | Processing backlog if crashed | Auto-restart policy; distributed queues (Redis) |
| **ml-service** | 1 | Forecasts delayed if overloaded | Horizontal scaling via container orchestration |
| **ingestion-service** | 1 | Batch loss if crashed | Retry at Edge (Node-RED queue) |
| **Redis** | 1 | Complete data loss if corrupted | Redis Sentinel for HA; RDB/AOF persistence |

**Scaling Path** :
```
MVP (single) → Staging (2x replicas) → Production HA (3+ with LB + monitoring)
```

### Database Connection Pool Limits

**Current** : 20 connections max per pool (core-db, telemetry-db)

**Issue** :
- Single container api-core → 5-10 active connections = 50-100% exhaustion
- 2-3 instances → erreurs de connexion DB côté API (pool saturé)

**Fix required for scaling** :
```
Option A: PgBouncer (connection pooling proxy)
  └─ Sits between app + PostgreSQL
  └─ Multiplexes 1000+ app connections → 20 DB connections
  └─ 2-3 days implementation

Option B: Cloud-managed (AWS RDS/Aurora)
  └─ Auto-scaling connections
  └─ Built-in HA + backups
  └─ ~50% cost increase

Option C: Manual tuning (short-term)
  └─ Increase pool size to 30-50 (monitor memory)
  └─ Add connection.destroy() on idle timeout
  └─ Reduce keepAliveInitialDelayMillis
```

### ML Model State Volatility

**Current state** : In-memory cache only (no persistence between restarts)

**Scenario** :
- ml-service crashes at 2 AM
- Models reloaded from disk at restart → 1st prediction request hangs 5-30s (retraining)
- Dashboard timeout on /forecast endpoint

**Impact** : Low (rare crashes) but visible to end-users

**Fix** :
```
Option A: Pre-load models on startup (current: lazy-load)
  └─ 5-10s warmup time
  └─ Cost: RAM usage + E2E test for model init

Option B: Model versioning + S3 cache
  └─ Save trained .pkl to MinIO/S3
  └─ Load from cache if available
  └─ 2-3 days effort

Option C: Model server (e.g., BentoML, Seldon Core)
  └─ Dedicated model serving service
  └─ Auto-scaling + versioning
  └─ 3-5 days effort + new infra
```

### Request Body Size Limits

**Current** :
- api-core: 1 MB (express.json default)
- ingestion-service: 512 KB (custom limit)

**Issue** :
- Batch payloads > 512 KB rejected with 413 Payload Too Large
- Node-RED batching (10-min window) = ~60 compteurs × 60 readings ≈ 200-300 KB (OK for now)
- Future: 200+ compteurs + larger payload → risk of truncation

**Fix** :
```
Increase body limit to 2 MB (for Node-RED batches)
  └─ Memory impact: negligible (Express streams)
  └─ Deploy: Change in docker-compose env + rolling restart

Monitor actual payload sizes (via logs)
  └─ Add middleware logging content-length
```

### No Integrated Monitoring (Known MVP Gap)

**Current state** : MVP — Healthchecks only; logs stdout

**Gap vs. enterprise** :
- ❌ No Prometheus metrics
- ❌ No Grafana dashboards
- ❌ No centralized logging (ELK/Loki)
- ❌ No SLA tracking
- ❌ No performance trending

**Compensation** :
- ✅ `/api/health/pipeline` endpoint (manual checks)
- ✅ `audit_logs` table (full traceability)
- ✅ `docker-compose logs` (real-time debugging)

**Production readiness roadmap** :
```
Phase 1 (Month 1): Add Prometheus + Grafana
  └─ Key metrics: API latency, queue sizes, DB connections
  └─ Alert rules: High error rate, queue overflow

Phase 2 (Month 2): Centralized logging (Loki is minimal)
  └─ Query logs by timeline, labels, errors

Phase 3 (Month 3): Distributed tracing (Jaeger)
  └─ Trace requests end-to-end (frontend → API → DB → ML)
```

### Redis Single Point of Failure

**Current** : Single Redis instance (no replication/clustering)

**Risk** :
- All BullMQ jobs stored in Redis (telemetry, ai, reports)
- If Redis crashes → interruption de queue; récupération dépend de la persistance Redis
- No automatic failover

**Production fix** :
```
Option A: Redis Sentinel (HA + auto-failover)
  └─ Min 3 Sentinels + 2 Redis (primary + replica)
  └─ Automatic promotion on primary failure
  └─ 2-3 hours setup + operational complexity

Option B: Redis Cluster (distributed)
  └─ Sharding across multiple nodes
  └─ Higher complexity + version constraints
  └─ Better for 10B+ operations/sec

Current mitigation:
  ✅ Redis AOF enabled (`--appendonly yes`)
  ✅ Jobs re-enqueued on app restart (graceful shutdown handler)
```

### Limited CORS Security (Intentional for MVP)

**Current** .env :
```env
CORS_ORIGINS=*  # ⚠️ Too permissive for production
```

**Risk** :
- XSS attacks from any origin can call API
- CSRF tokens not enforced

**Fix for production** :
```env
CORS_ORIGINS=https://simes.bf,https://admin.simes.bf

# Add to api.ts middleware chain:
app.use(csrf())                              # CSRF protection
app.use(helmet.csp({...}))                   # Content Security Policy
app.disable('x-powered-by')                  # Hide Express fingerprint
```

### No per-Device Rate Limiting

**Current** : 100 req/min per IP on `/milesight` endpoint

**Issue** :
- Single gateway (UG67) = ~6 requests/min (batches every 10 min)
- If gateway misconfigured → could send rapid requests
- No request-based backpressure (queue FIFO only)

**Improvement** :
```
Per-device rate limiting (by dev_eui or gateway_id)
  └─ Prevent DDoS from faulty devices
  └─ Alert if device exceeds threshold (50 req/min)

Queue size backpressure
  └─ If ingestion queue > 10,000 items → respond 429 Too Many Requests
  └─ Signal to Edge (backpressure) to slow down upload
```

---

# 11. Déploiement & Infrastructure

## 11.1 Prérequis

```
- Docker Engine 20.10+
- Docker Compose 2.0+
- 8 GB RAM minimum (2GB telemetry-db seul)
- 100+ GB disk (telemetry-db growth ~50 GB/an avant compression)
- Bash shell (deploy.sh script)
```

## 11.2 Script de Déploiement (`deploy.sh`)

**Commandes**:
```bash
./deploy.sh                 # Full deploy: build + up + init DB (30-60 sec)
./deploy.sh --no-build      # Utiliser images Docker cachées (10-20 sec)
./deploy.sh --db-only       # Seulement init DB (containers déjà up)
./deploy.sh --repair-agg    # Re-aggregate 60 jours de données (après deploy)
./deploy.sh --check-pipeline # Vérifier health pipeline (après deploy)
```

**Process Automatisé** (voir deploy.sh ligne 1-250):

```bash
1. Vérifier .env présent (sinon copier .env.example)
   └─ Variables requises: CORE_DB_*, TELEMETRY_DB_*, REDIS_PASSWORD, JWT_SECRET

2. Docker cleanup
   ├─ docker compose down --remove-orphans  (arrêter vieux containers)
   ├─ docker network rm docker_edge docker_internal (nettôyer réseaux orphelins)
   └─ docker builder prune --all -f (nettoyer cache BuildKit corrompu)

3. Démarrer stack
   └─ docker compose up -d --force-recreate [--build]
       ├─ Télécharge images
       ├─ Build Dockerfiles (api-core, ingestion, worker, ml, frontend)
       └─ Lance 10 services en parallèle

4. Attendre bases de données healthy (30 retries × 2s = 60s max)
   ├─ docker exec core-db pg_isready -U $CORE_DB_USER
   └─ docker exec telemetry-db pg_isready -U $TELEMETRY_DB_USER

5. Appliquer schémas (idempotent)
   ├─ docker exec core-db psql < schema-core.sql
   │  └─ Crée 20+ tables (organizations, sites, terrains, zones, points, users, etc)
   └─ docker exec telemetry-db psql < schema-telemetry.sql
      └─ Crée hypertables TimescaleDB (acrel_readings, agg_15m, agg_daily, etc)

6. Attendre api-core running
   └─ docker inspect simes-api-core (15 retries × 2s)

7. Copier et exécuter migrations
   ├─ docker cp migrate.js + migrations/ → api-core
  ├─ node migrate.js --db core (applique les migrations core présentes)
   │  ├─ job_results, tariffs, users, incidents, settings, etc
   │  └─ enregistre checksums SHA-256 dans schema_migrations table
  └─ node migrate.js --db telemetry (applique les migrations telemetry/agg présentes)
      ├─ acrel_agg_15m, acrel_agg_daily, power_peaks, anomalies
      └─ Nettoie migrate.js après

8. Attendre api-core healthy (30 retries × 3s)
   └─ docker inspect simes-api-core --format='{{.State.Health.Status}}'
      └─ healthcheck: GET http://localhost:3000/health → 200

9. Vérifier services restants
   ├─ ingestion-service: running
   ├─ worker-jobs: running
   ├─ ml-service: running
   └─ frontend-web: running

10. Test API health
    └─ curl http://localhost/api/health (10 retries × 2s)

11. Post-deploy (optionnel)
    ├─ --repair-agg: POST /api/admin/pipeline/repair-aggregations
    │  └─ Re-aggregate 60 jours de télémétrie (si données corrompues)
    └─ --check-pipeline: Vérifier /api/health/pipeline
       └─ Queue sizes, worker status, last heartbeat
```

**Durée typique**:
- Première fois (build): 3-5 minutes
- Déploiements suivants (--no-build): 30-60 secondes
- Production: ~1-2 minutes selon état des images et de la machine

## 11.3 Configuration `.env` (Requise)

```env
# PostgreSQL - Core Database
CORE_DB_NAME=simes_core
CORE_DB_USER=simes
CORE_DB_PASSWORD=<strong-random-password>

# PostgreSQL - Telemetry Database (TimescaleDB)
TELEMETRY_DB_NAME=simes_telemetry
TELEMETRY_DB_USER=simes
TELEMETRY_DB_PASSWORD=<strong-random-password>

# Redis (cache + job queues)
REDIS_PASSWORD=<strong-random-password>

# MinIO (S3-compatible storage)
MINIO_ROOT_USER=simesadmin
MINIO_ROOT_PASSWORD=<strong-random-password>

# pgAdmin (database admin UI)
PGADMIN_EMAIL=admin@simes.bf
PGADMIN_PASSWORD=<strong-password>

# JWT Authentication
JWT_SECRET=<32-byte-hex-random>  # Generate: python3 -c "import secrets;print(secrets.token_hex(32))"

# System
TZ=Africa/Ouagadougou
NODE_ENV=production

# Optional: CORS, ML_SERVICE_URL, etc
```

## Configuration `.env` (required)

```env
# PostgreSQL
CORE_DB_NAME=simes_core
CORE_DB_USER=simes
CORE_DB_PASSWORD=[strong-password]

TELEMETRY_DB_NAME=simes_telemetry
TELEMETRY_DB_USER=simes
TELEMETRY_DB_PASSWORD=[strong-password]

# Redis
REDIS_PASSWORD=[strong-password]

# JWT
JWT_SECRET=[random-string-32]

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=[strong-password]

# pgAdmin
PGADMIN_EMAIL=admin@simes.bf
PGADMIN_PASSWORD=[strong-password]

# Système
TZ=Africa/Ouagadougou
NODE_ENV=production
```

---

# 12. Conclusion

**SIMES-BF** est une plateforme **modulaire, scalable et robuste** basée sur :

- ✅ **Microservices** découplés (API, Ingestion, Workers, ML)
- ✅ **Edge computing** intelligent (Node-RED sur gateway)
- ✅ **Bases de données spécialisées** (PostgreSQL + TimescaleDB)
- ✅ **Architecture orientée données** (télémétrie time-series)
- ✅ **Intelligence artificielle** intégrée (LightGBM)

Cette architecture permet :

1. **Collecte fiable** des données énergétiques (LoRaWAN → EdgeProcessing → Cloud)
2. **Stockage optimisé** (compression 60-70% TimescaleDB)
3. **Analyse temps-réel** (dashboards, KPIs, anomalies)
4. **Prédictions** basées sur 365 jours d'historique (ML forecasting)
5. **Évolution future** (nouveaux capteurs, modules IA, intégration météo)

## Prochaines étapes

| Priorité | Item | Effort |
|----------|------|--------|
| 🔴 Critique | Documentation API OpenAPI spec | 1-2 jours |
| 🔴 Critique | Threat model & penetration testing | 2-3 jours |
| 🟠 Important | Monitoring (Prometheus + Grafana) | 2-3 jours |
| 🟠 Important | Logging centralisé (ELK/Loki) | 1-2 jours |
| 🟡 Medium | C4 diagrams (Structurizr DSL) | 1 jour |
| 🟡 Medium | Test strategy & E2E tests (k6/Cypress) | 3-5 jours |
| 🟢 Nice | Node-RED persistence (SQLite backup) | 2-3 jours |

---

| 🟢 Nice | Node-RED persistence (SQLite backup) | 2-3 jours |

---

# Appendix B: Réalité vs. Documentation Théorique

## B.1 "Ce qui fonctionne bien" ✅

### Architecture & Design

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Microservices découpling** | ✅ Excellent | Each service has distinct responsibility; easy to restart independently |
| **Edge computing (Node-RED)** | ✅ Excellent | Batching reduces bandwidth 600x; local queue resilience proven |
| **Time-series optimization (TimescaleDB)** | ✅ très bon | Compression activée et index time-series en place |
| **JWT authentication** | ✅ très bon | Stateless, token-based, properly salted on password hashing |
| **RBAC (4 roles)** | ✅ très bon | Clear separation; terrain access middleware prevents cross-org leaks |
| **Input validation (Zod)** | ✅ Excellent | All endpoints validated at request entry; zero SQL injection risk |
| **Audit logging** | ✅ Excellent | Complete trail of user actions; used in incident investigation |
| **Graceful shutdown** | ✅ très bon | 10s timeout; DB connections properly drained on container stop |
| **Error handling middleware** | ✅ très bon | Global error handler; 500s logged with full stack |

### Infrastructure & Deployment

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Docker Compose orchestration** | ✅ très bon | Simple, reproducible; all services health-definable |
| **Traefik reverse proxy** | ✅ très bon | Auto-discovery; label-based routing; dashboard for debugging |
| **Automated deploy.sh** | ✅ très bon | Idempotent; can run 50+ times without corruption |
| **Database migrations (SHA-256)** | ✅ très bon | Schema version tracking; prevents duplicate runs |
| **Network isolation** | ✅ Excellent | simes-internal private; external services inaccessible from Internet |
| **Resource limits (docker-compose)** | ✅ très bon | Each service has defined CPU/RAM; prevents resource hogging |
| **Volume persistence** | ✅ très bon | PostgreSQL & Redis data survive container restarts |

### Frontend & UX

| Aspect | Status | Evidence |
|--------|--------|----------|
| **React + TanStack Query** | ✅ Excellent | 80+ hooks; smooth data sync; keepPreviousData prevents flicker |
| **Widget system** | ✅ très bon | 18 configurable widgets; resolver pattern lazy-loads data |
| **Layout persistence** | ✅ très bon | localStorage caching per user; 1s debounce sync to server |
| **Responsive design (TailwindCSS)** | ✅ très bon | Works on mobile (320px) to desktop (2560px) |
| **24 pages routing** | ✅ très bon | Protected routes; proper 404 handling; breadcrumb navigation |

### Data Processing

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Telemetry aggregation (15m + daily)** | ✅ Excellent | Flux d'agrégation actif via worker telemetry et tables dédiées |
| **ML forecasting (LightGBM)** | ✅ très bon | Prédictions + bornes P10/P90 persistées en base |
| **Anomaly detection (residual + IF)** | ✅ très bon | Détection implémentée et incidents exploitables côté plateforme |
| **Facture SONABEL calculation** | ✅ Excellent | Pipeline facture implémenté avec plans tarifaires et contrats |
| **BullMQ job queuing** | ✅ très bon | Queues telemetry/ai/reports actives avec retries et état failed |

---

## B.2 "Ce qui ne fonctionne pas" ou a des limites ⚠️

### Architecture Limitations

| Aspect | Limitation | Impact | Severity |
|--------|-----------|--------|----------|
| **Single instance (api-core)** | 1 instance only; container crash = API down | indisponibilité API jusqu'au redémarrage | 🔴 Critical for HA |
| **Single Redis** | No clustering; data loss risk | Job loss if Redis crashes | 🔴 Critical for HA |
| **Connection pool limits** | Max 20 conn/pool; exhausts with 2-3 instances | erreurs DB et dégradation API sous charge | 🟠 Important for scaling |
| **ML model cache (in-memory)** | Non-persistent; reloads on restart | latence accrue au premier appel après restart | 🟡 Medium annoyance |
| **No monitoring integration** | Healthchecks only; no Prometheus/Grafana | Blind spot on performance trends | 🟠 Important for ops |
| **CORS too permissive** | `CORS_ORIGINS=*` | XSS risk; should be hardened | 🟠 Important for prod |

### Functional Gaps

| Feature | Status | Impact |
|---------|--------|--------|
| **Distributed tracing** | ❌ Missing | Can't track request flow end-to-end |
| **Circuit breakers** | ❌ Missing | If external API fails, timeout cascades |
| **Caching layer (Redis apart from queues)** | ❌ Missing | Repeated API calls hit DB |
| **Rate limiting per-device** | ❌ Missing | Faulty gateway could spam ingestion |
| **Multi-language UI** | ⚠️ French only | Must recompile for other languages |
| **OAuth/SAML integration** | ❌ Missing | Must use JWT tokens; no SSO |
| **File exports (PDF reports)** | ⚠️ Partial | Can export CSV; PDF generation missing |

### Performance & Scalability

| Metric | Current | Bottleneck | Fix Effort |
|--------|---------|-----------|-----------|
| **Max concurrent users** | non benchmarké dans ce dépôt | API connection pool | 2-3 days (PgBouncer) |
| **Forecast latency** | dépend du volume et de l'état cache | ML training on demand | 2 days (caching) |
| **Dashboard load time** | variable selon endpoint | Data fetching multi-hooks | monitoring + profiling |
| **Telemetry DB query** | bonne réactivité observée en usage standard | Index tuning needed for gros volumes | 1 day (index review) |
| **Node-RED batch window** | 10 min | By design (reduces bandwidth) | Would break Edge model to reduce |

### Security Gaps (Non-Critical but Notable)

| Gap | Current | Risk | Fix |
|-----|---------|------|-----|
| **CORS hardening** | Origins=`*` | XSS risks | Tighten to exact domains |
| **CSRF protection** | Not implemented | Form-based attacks | Add csrf() middleware |
| **TLS/SSL** | Optional (Traefik support) | Man-in-the-middle over HTTP | Enable in production .env |
| **API Documentation** | Swagger.test.js file (not auto-generated) | Hard to maintain; stale docs | Generate via OpenAPI |
| **Penetration testing** | None done | Unknown vulnerabilities | Hire 3rd party (2-3 days) |

---

## B.3 Architecture Reality vs. Original Vision

### What Was Planned vs. What Got Built

| Component | Original Vision | Reality | Gap |
|-----------|-----------------|---------|-----|
| **Monitoring** | Prometheus + Grafana from day 1 | Health checks + admin endpoints | Functional but MVP |
| **Multi-instance scaling** | Load-balanced API (3+ instances) | Single instance MVP | Will need redesign for HA |
| **OAuth/AD integration** | LDAP/OAuth2 auth | JWT only (no SSO) | Acceptable for now |
| **Voice alerting** | SMS/Email/Voice notifications | Manual via logs + admin UI | Low priority |
| **Mobile app** | Native iOS/Android | Web-responsive only | Future phase |
| **Blockchain audit trail** | Immutable ledger | PostgreSQL audit_logs | Overkill; logs sufficient |
| **5-year data retention** | Hot storage all 5 years | Compression after 7 days; plan for archival | Need S3 archival strategy |

### Quality Assessment

| Dimension | Rating | Comments |
|-----------|--------|----------|
| **Code quality** | ⭐⭐⭐⭐ | Well-structured; consistent patterns; minimal tech debt |
| **Documentation** | ⭐⭐⭐ | Architecture docs exist; API not fully documented |
| **Test coverage** | ⭐⭐⭐ | Integration tests present; unit tests light |
| **Error handling** | ⭐⭐⭐⭐ | Global error handler; graceful failures |
| **Performance** | ⭐⭐⭐⭐ | Optimized for current scale; will need work for 10x |
| **Security** | ⭐⭐⭐ | Basics solid (RBAC, JWT, input validation); gaps on CORS, CSRF |
| **Observability** | ⭐⭐ | Healthchecks work; no integrated monitoring |
| **Scalability** | ⭐⭐ | Works single instance; hard to scale to HA |

---

## B.4 What Operations Team Needs to Know

### Daily Operations ✅

```
✅ Docker compose logs is your friend
   docker compose logs -f api-core
   docker compose logs -f worker-jobs

✅ Deployment is automated & safe
   ./deploy.sh --no-build  (< 1 min most of the time)

✅ Admin panel has built-in repair tools
   → Pipeline Health page shows all components
   → Can retry failed jobs, flush queues, re-aggregate data

✅ If one service crashes, auto-restart on 30s
   → Docker restart policy handles most outages

✅ Database backups happen daily (MinIO + PostgreSQL)
   → Restore from backup: ~5 min downtime
```

### Common Issues & Fixes 🔧

| Issue | Symptom | Root Cause | Fix |
|-------|---------|-----------|-----|
| **API returns 503** | `{"error": "DB connection pool exhausted"}` | Api-core under load | Restart api-core container |
| **Jobs stuck in Redis** | Pipeline Health shows queue > 1000 items | Worker-jobs crashed | `docker compose restart worker-jobs` |
| **Forecast predictions missing** | ML Service DOWN in health check | ml-service OOMKilled | Increase memory limit in docker-compose.yml |
| **Data gap in dashboard** | Last reading 2 hours old | Ingestion service crashed | Check Node-RED → api logs for errors |
| **Anomalies not detected** | No incidents in anomalies page | AI worker queue empty | Check ML model files exist in /data/models/ |

### Proactive Monitoring

```
Daily:
  □ Check /platform/pipeline health (should be all "up")
  □ Check queue sizes (should be < 100 in all queues)
  □ Check incident count (should be 0)

Weekly:
  □ Review audit_logs for errors (check /platform/logs)
  □ Verify database size growth (compare disk: du -sh /var/lib/docker/volumes/)
  □ Test deployment process on staging

Monthly:
  □ Run stress test (simulate 200 compteurs × max readings)
  □ Review OWASP Top 10 against codebase
  □ Plan monitoring upgrades (Prometheus ETA?)
```

---

# Appendix C: Glossaire

| Terme | Définition |
|--------|----------|
| **UG67** | Passerelle LoRaWAN Milesight (modèle) |
| **Acrel ADW3000** | Analyseur réseau triphasé (capteur principal) |
| **LoRaWAN** | Protocole IoT longue portée (point-to-multipoint) |
| **SONABEL** | Société tarifaire Burkina Faso (fournisseur électricité) |
| **Tranches tarifaires** | Spike (17-22h), Peak (7-17h), Flat (22-7h), Valley (opt) |
| **Time-series DB** | Base optimisée pour données séquentielles (temps + valeur) |
| **Hypertable** | Table TimescaleDB partitionnée automatiquement par temps |
| **Continuous Agg** | Agrégations time-series mises à jour automatiquement |
| **BullMQ** | Queue system Node.js basé sur Redis |
| **LightGBM** | Gradient Boosting Decision Tree (ML framework) |
| **P10/P90** | Percentiles 10% et 90% (intervalles confiance) |
| **THD** | Total Harmonic Distortion (%)  |
| **Power Factor** | cos(φ) — efficacité utilisation courant |
| **Delta énergie** | Différence énergie entre 2 lectures (lecture[t] - lecture[t-1]) |
| **RBAC** | Role-Based Access Control (autorisation) |
| **JWT** | JSON Web Token (authentification stateless) |
| **CSP** | Content Security Policy (sécurité HTTP header) |

---

