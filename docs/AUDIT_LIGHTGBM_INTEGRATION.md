# Audit : Intégration LightGBM pour les Prévisions Énergétiques

**Date** : Janvier 2025  
**Système** : SIMES-BF — Plateforme de monitoring énergétique  

---

## 1. Résumé exécutif

L'intégration de LightGBM pour la prévision de consommation énergétique est **faisable et recommandée**. L'infrastructure existante (TimescaleDB, BullMQ, Minio, Docker) couvre 80 % des briques nécessaires. Le principal effort concerne la création d'un micro-service Python et l'enrichissement du pipeline de features.

| Critère | État actuel | Prêt ? |
|---------|------------|--------|
| Données historiques (15 min / jour) | `acrel_agg_15m`, `acrel_agg_daily` — hypertables TimescaleDB | ✅ |
| Volume de métriques | 50+ colonnes brutes par lecture (puissance, tension, énergie, THD…) | ✅ |
| Infrastructure de jobs | BullMQ + Redis + scheduler cron + table `runs` | ✅ |
| Stockage de modèles | Minio (S3-compatible) + table `job_results` | ✅ |
| ML runtime | **Aucun** — pas de Python, pas de bibliothèque ML | ❌ |
| Features calendaires | **Absentes** — pas de jours fériés, saisons, météo | ⚠️ |
| Frontend prévisions | Page `Forecasts.tsx` existante (régression linéaire/moyenne mobile) | ✅ |

---

## 2. État des lieux

### 2.1 Données disponibles

**Pipeline actuel** :
```
Capteur Acrel → Gateway Milesight (LoRa) → ingestion-service
→ acrel_readings (brut, ~50 colonnes)
→ acrel_agg_15m (agrégation 15 min : avg, max, delta énergie)
→ acrel_agg_daily (agrégation jour)
```

**Colonnes clés pour le ML** :
- `active_power_avg`, `active_power_max` — cible principale
- `energy_import_delta`, `energy_export_delta` — cible secondaire (kWh)
- `voltage_a_avg` — feature corrélée
- `samples_count` — indicateur de qualité

**Points forts** :
- Index optimisé `(point_id, time DESC)` → extraction rapide
- Agrégation automatique (worker telemetry) → données déjà nettoyées
- Classification tarifaire (HP/HPT/HC) → feature gratuite

**Points faibles** :
- Profondeur historique à vérifier (le schéma ne fixe pas de rétention)
- Pas de données météo (température, ensoleillement)
- Pas de données calendaires (jours fériés BF, Ramadan, saisons)

### 2.2 Prévision actuelle (Forecasts.tsx)

Le frontend calcule **côté client** une prévision naïve :
1. Groupement des lectures par jour → moyenne de puissance active
2. Régression linéaire (tendance)
3. Bandes de confiance statistiques ± 1.5σ

**Limites** :
- Fenêtre glissante de 3 jours (pas adaptative)
- Aucune saisonnalité (jour semaine, mois, saison)
- Intervalle de confiance purement gaussien
- Pas de features exogènes

### 2.3 Infrastructure worker

Le scheduler BullMQ gère déjà 3 queues (`telemetry`, `ai`, `reports`) avec :
- Jobs répétitifs cron (2 min, 5 min, 15 min)
- Suivi d'exécution (table `runs` : queued → running → success/failed)
- Stockage de résultats (table `job_results` → Minio)

La queue `ai` existe mais ne contient actuellement qu'un job de calcul de facturation (`computeFacture`).

---

## 3. Architecture proposée

### 3.1 Option A — Micro-service Python (recommandée)

```
┌──────────────────────────────────────────────────┐
│                Docker Compose                     │
│                                                   │
│  ┌─────────┐   ┌───────────┐   ┌──────────────┐ │
│  │ worker  │──▶│ ml-service │──▶│   Minio      │ │
│  │ (Node)  │   │ (FastAPI)  │   │ (modèles)    │ │
│  └────┬────┘   └─────┬─────┘   └──────────────┘ │
│       │              │                            │
│  ┌────▼────┐   ┌─────▼──────┐                    │
│  │  Redis  │   │TimescaleDB │                    │
│  │(BullMQ) │   │(télémétrie)│                    │
│  └─────────┘   └────────────┘                    │
│                                                   │
│  ┌──────────┐   ┌────────────┐                   │
│  │ api-core │◀──│  frontend  │                   │
│  │(Express) │   │  (React)   │                   │
│  └──────────┘   └────────────┘                   │
└──────────────────────────────────────────────────┘
```

**`apps/ml-service/`** (nouveau) :
- **Runtime** : Python 3.11 + FastAPI + uvicorn
- **Dépendances** : `lightgbm`, `pandas`, `numpy`, `scikit-learn`, `joblib`, `psycopg2`
- **Endpoints** :
  - `POST /train` — entraîne un modèle par terrain
  - `POST /predict` — prévision J+1 à J+7
  - `GET /models/{terrain_id}/status` — version, MAPE, date d'entraînement
- **Image Docker** : ~400 Mo (Python slim + lightgbm)

**Avantages** :
- Écosystème ML Python natif (pandas, sklearn, lightgbm)
- Isolation du coût CPU de l'entraînement
- Scalable indépendamment (GPU futur possible)
- Communauté et documentation riches

**Inconvénients** :
- Nouvelle image Docker à maintenir
- Latence réseau interne supplémentaire (~5 ms)

### 3.2 Option B — LightGBM embarqué dans Node.js

Utilisation de `lightgbm` via le binding Node (`lightgbm` npm ou appel binaire).

**Avantages** : pas de nouveau service
**Inconvénients** : bindings Node immatures, pas de pandas pour le feature engineering, maintenance complexe.

**Verdict** : Option A recommandée.

---

## 4. Pipeline de données ML

### 4.1 Extraction des features

```sql
-- Vue matérialisée pour les features d'entraînement
CREATE MATERIALIZED VIEW ml_features_daily AS
SELECT
  day,
  point_id,
  terrain_id,
  -- Target
  energy_import_delta AS target_kwh,
  active_power_avg   AS target_kw_avg,
  active_power_max   AS target_kw_max,
  -- Features temporelles
  EXTRACT(DOW FROM day)        AS day_of_week,     -- 0=dim, 6=sam
  EXTRACT(MONTH FROM day)      AS month,
  EXTRACT(WEEK FROM day)       AS week_of_year,
  (EXTRACT(DOW FROM day) IN (0, 6))::int AS is_weekend,
  -- Features retardées (lags)
  LAG(energy_import_delta, 1)  OVER w AS lag_1d,
  LAG(energy_import_delta, 7)  OVER w AS lag_7d,
  LAG(energy_import_delta, 14) OVER w AS lag_14d,
  LAG(energy_import_delta, 30) OVER w AS lag_30d,
  -- Moyennes glissantes
  AVG(energy_import_delta)     OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_avg_7d,
  AVG(energy_import_delta)     OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_avg_30d,
  -- Statistiques glissantes
  STDDEV(energy_import_delta)  OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_std_7d,
  MAX(active_power_max)        OVER (PARTITION BY point_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_max_power_7d
FROM acrel_agg_daily
WINDOW w AS (PARTITION BY point_id ORDER BY day)
WHERE energy_import_delta IS NOT NULL
ORDER BY point_id, day;
```

### 4.2 Features recommandées

| Feature | Source | Priorité |
|---------|--------|----------|
| `energy_import_delta` (target) | `acrel_agg_daily` | Obligatoire |
| `day_of_week`, `month`, `is_weekend` | Calculé | Obligatoire |
| `lag_1d`, `lag_7d`, `lag_14d`, `lag_30d` | SQL Window | Obligatoire |
| `rolling_avg_7d`, `rolling_avg_30d` | SQL Window | Obligatoire |
| `rolling_std_7d` | SQL Window | Recommandé |
| `active_power_max` | `acrel_agg_daily` | Recommandé |
| Température extérieure | API météo (Open-Meteo) | Futur |
| Jours fériés Burkina Faso | Table calendrier | Futur |
| Tarification en cours (HP/HPT/HC) | `tariff_plans` | Optionnel |

### 4.3 Modèle LightGBM

```python
import lightgbm as lgb

params = {
    "objective": "regression",
    "metric": "mae",
    "boosting_type": "gbdt",
    "num_leaves": 31,
    "learning_rate": 0.05,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
}

# Entraînement avec validation croisée temporelle
train_data = lgb.Dataset(X_train, label=y_train)
valid_data = lgb.Dataset(X_valid, label=y_valid)

model = lgb.train(
    params,
    train_data,
    num_boost_round=500,
    valid_sets=[valid_data],
    callbacks=[lgb.early_stopping(50), lgb.log_evaluation(100)],
)

# Prévision avec intervalles de confiance (quantile regression)
params_lower = {**params, "objective": "quantile", "alpha": 0.05}
params_upper = {**params, "objective": "quantile", "alpha": 0.95}
model_lower = lgb.train(params_lower, train_data, num_boost_round=300)
model_upper = lgb.train(params_upper, train_data, num_boost_round=300)
```

**Pourquoi LightGBM plutôt que d'autres** :
- ✅ **vs ARIMA/SARIMA** : gère les features exogènes nativement, pas de stationnarité requise
- ✅ **vs Prophet** : plus rapide, meilleure performance sur les features structurées
- ✅ **vs Deep Learning** : pas besoin de GPU, entraînement en secondes, fonctionne bien avec <10K échantillons
- ✅ **vs XGBoost** : plus rapide, moins gourmand en mémoire, comparable en performance
- ⚠️ **Limitation** : ne capture pas les dépendances séquentielles longues (mais les lags compensent)

---

## 5. Intégration dans le système existant

### 5.1 Nouveaux endpoints API (api-core)

```javascript
// apps/api-core/src/modules/ai/ai.routes.js

// Déclencher un entraînement
POST /ai/train/:terrainId
→ Ajoute job "ai.train_lightgbm" dans la queue BullMQ
→ { runId: "uuid", status: "queued" }

// Obtenir une prévision
GET /ai/forecast/:terrainId?days=7&confidence=0.95
→ Appelle ml-service POST /predict
→ { forecast: [{day, predicted_kwh, lower, upper}], model: {version, mape, trained_at} }

// Statut du modèle
GET /ai/model/:terrainId
→ { terrain_id, version, mape, rmse, trained_at, features_used, samples_count }
```

### 5.2 Worker jobs

```javascript
// scheduler.js — ajouter :
await aiQueue.add("ai.train_all_terrains", {}, {
  repeat: { pattern: "0 3 * * 0" }  // Tous les dimanches à 3h
});

// ai.worker.js — ajouter handler :
case "ai.train_lightgbm":
  // 1) Extraire features depuis TimescaleDB
  // 2) POST ml-service/train avec les données
  // 3) Stocker modèle dans Minio
  // 4) Mettre à jour job_results
  break;
```

### 5.3 Frontend (Forecasts.tsx)

Modifications nécessaires :
1. **Appel API** au lieu du calcul client : `api.get(`/ai/forecast/${terrainId}?days=${horizon}`)` 
2. **Fallback** : si le modèle ML n'existe pas encore, garder la régression linéaire actuelle
3. **Badge** : afficher `"Modèle : LightGBM (MAPE: 4.2%)"` au lieu de `"Moyenne mobile"`
4. **Nouvelle KPI** : "Confiance du modèle" (basée sur MAPE / couverture des intervalles)
5. **Bouton d'entraînement** : admin peut déclencher un ré-entraînement manuel

---

## 6. Baselines à comparer

Pour valider que LightGBM apporte une valeur ajoutée, comparer avec :

| Baseline | MAPE attendu | Implémentation |
|----------|-------------|----------------|
| Naïf saisonnier (même jour semaine précédente) | 15–25 % | SQL `LAG(7)` |
| Moyenne mobile 7 jours | 12–20 % | Déjà implémenté (Forecasts.tsx) |
| Régression linéaire | 10–18 % | Déjà implémenté (Forecasts.tsx) |
| ETS / Holt-Winters | 8–15 % | `statsmodels` Python |
| **LightGBM (features temporelles)** | **5–10 %** | Proposé |
| **LightGBM (+ météo + calendrier)** | **3–7 %** | Phase 2 |

---

## 7. Plan d'implémentation

### Phase 1 — Fondations (Priorité haute)

1. **Créer `apps/ml-service/`** : FastAPI + LightGBM + Dockerfile
2. **Créer la vue SQL** `ml_features_daily` (features + lags + rolling stats)
3. **Endpoint `/train`** : extraction, entraînement, sauvegarde dans Minio
4. **Endpoint `/predict`** : chargement modèle, prévision J+1 à J+7

### Phase 2 — Intégration système

5. **API routes** : `POST /ai/train/:terrainId`, `GET /ai/forecast/:terrainId`
6. **Worker job** : `ai.train_lightgbm` appelé par le scheduler (hebdomadaire)
7. **Frontend** : Forecasts.tsx appelle l'API au lieu du calcul client

### Phase 3 — Enrichissement (Futur)

8. **API météo** : intégrer Open-Meteo (gratuit, pas de clé API pour historique)
9. **Calendrier BF** : table des jours fériés du Burkina Faso
10. **Régression quantile** : intervalles de confiance 90 %/95 %
11. **Monitoring** : alerte si MAPE > seuil → incident automatique
12. **Multi-horizon** : modèles séparés pour intra-jour (15 min) et multi-jour

---

## 8. Estimation des ressources

| Composant | RAM | CPU | Stockage |
|-----------|-----|-----|----------|
| ml-service (idle) | 150 Mo | ~0 % | — |
| Entraînement (1 terrain, 1 an) | 300 Mo | 1 core, ~5 sec | — |
| Modèle sauvegardé | — | — | ~2 Mo / terrain |
| Image Docker | — | — | ~400 Mo |

**Coût serveur supplémentaire** : Négligeable sur l'infrastructure actuelle (le VPS héberge déjà 8+ conteneurs).

---

## 9. Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Historique < 6 mois | Modèle peu fiable | Fallback sur régression linéaire + warning UI |
| Données manquantes (gaps) | Features NaN | `check_aggregation_gaps` comble déjà les trous + imputation |
| Surentraînement | Prévisions faussement confiantes | Validation croisée temporelle stricte |
| Latence prévision | UX dégradée | Cache Redis (TTL 15 min) pour les prévisions |
| Maintenance Python | Charge opérationnelle | Image Docker slim, dépendances minimales |

---

## 10. Conclusion

**LightGBM est le choix optimal** pour SIMES-BF :
- Les données sont déjà structurées et agrégées (TimescaleDB)
- L'infrastructure de jobs (BullMQ + Minio) est prête pour le ML
- La page Forecasts.tsx est déjà scaffoldée pour des prévisions avec intervalles de confiance
- L'effort principal est la création du micro-service Python (~400 lignes de code)
- Le gain de précision attendu est de **2x à 4x** par rapport à la régression linéaire actuelle

**Recommandation** : Implémenter la Phase 1 en priorité pour avoir un modèle fonctionnel, puis enrichir avec les features météo et calendaires.
