# Plan de remédiation — SIMES-BF

> Backlog priorisé issu de l’audit code 2026-07. Compagnon de `PASSATION.md`.
> Effort : **XS** (1 ligne) · **S** · **M** · **L**. Chaque item = sa propre branche,
> son propre commit et une vérification adaptée.
> Les repères `fichier:ligne` datent de l’audit : les revérifier contre le code courant.

## Ordre d’exécution convenu

- **Préparation ops :** sécuriser le déploiement → automatiser les sauvegardes et la copie hors VPS → tester les branches existantes contre des bases restaurées.
- **Vague 0 (gains sûrs) :** AM-1 → P1-1 (active les tests de facturation) → W-1/W-2/W-3 (retirer les widgets fictifs) → W-5 + sous-titre de W-4.
- **Vague 1 (fuites inter-organisations) :** SEC-2 (PV) → SEC-3 (Solaire) → SEC-4 (`site_access`) → P0-3 (`test-listener`).
- **Vague 2 (facturation) :** P0-1 (garde reset, corrige aussi AM-5) → P0-2 (historique contrats).
- **Vague 3 (performance graphes) :** PERF-1 → PERF-2 → PERF-3/PERF-4.
- **Vague 4 (ML/anomalies) :** AM-4 → W-6 → W-8 → W-9 → AM-6/7/8.
- **Vague 5 (UI et finitions) :** UI-4/5/6 → UI-1/2/3 → UI-7 + P2-5/6/7 → P1-4/AM-14/SEC-6/7/P3 → P0-4/P0-5 (ops).

## Déjà fait — non déployé sauf mention contraire

### `fix/exports-streaming` (5 commits)

- P2-2/P2-3/P2-4 : Excel/CSV/JSON par point en streaming, sans plafond, avec export par lot séquentiel (`ab95ce6`, `b8cdf43`, `ced780b`).
- Terrain CSV/JSON via `/reports/terrain/:id/{csv,json}` et garde `userCanAccessTerrain` (`8c09f71`, `6bb6887`).
- KPI « Énergie » : somme par compteur au lieu d’un mélange d’odomètres (`6bb6887`).
- Vérifié par `node --check`, `tsc` et tests de fumée. **Pas testé contre la vraie base et pas déployé.**

### `perf/dashboard-load-curve-downsample` (3 commits)

- Endpoint `GET /terrains/:id/readings/downsampled` avec `time_bucket`, moyenne et alignement sur l’epoch (`933e941`).
- Courbe de charge (`379f03d`) et `PointDetails` (`a0e89e8`) branchés sur `useDownsampledReadings`.
- Vérifié par `tsc`. **Pas testé contre TimescaleDB réel et pas déployé.**
- `PowerPeaksTable` reste sur les données brutes car il lui faut un maximum, pas une moyenne.

### `ops/safe-deployment`

- Déploiement incrémental, sans arrêt global, suppression de réseau ni pull implicite.
- Services persistants/admin exclus du déploiement courant sur une installation existante.
- Sauvegardes Core/Telemetry et métadonnées de rollback avant mutation.
- Garde-fous contre Docker Snap, daemon/socket Docker inattendu, dépôt sale et options inconnues.
- Migrations, healthchecks, probes HTTP, rattachement Traefik et hash Compose bloquants.
- P1-4 : opérations administratives explicites, authentifiées et non masquées.
- **Syntaxe, scénarios d’arrêt et chemin nominal simulé vérifiés ; jamais exécuté ni déployé en production.**

### Opérations VPS du 2026-07-29

- Docker Snap supprimé, son unité neutralisée, un seul daemon système conservé.
- Traefik recréé proprement via Compose et vérifié sur `simes-edge`.
- MinIO remis `healthy`.
- Sauvegarde complète restaurée dans des conteneurs isolés et copiée hors VPS.
- Ces opérations n’ont pas déployé de nouveau code applicatif.

## Décisions client

- **P0-1** (reset compteur et facturation) : **DIFFÉRÉ**. Vérifier empiriquement en base avant de coder.
- **SEC-1** (authentification ingestion) : **DIFFÉRÉ**. Maintenir l’accès derrière le VPN en attendant.
- Ne pas modifier les accès ou faire tourner les secrets sans instruction explicite.

---

## P0 — Critique

- **P0-1 — DIFFÉRÉ.** Sur-comptage de facturation lors d’un reset compteur : `MAX-MIN` par fenêtre dans `apps/worker-jobs/src/ai.worker.js:147` et `:182`, avec la même racine dans le worker d’agrégation et le dashboard « energy today » (`apps/api-core/src/modules/telemetry/telemetry.routes.js:359`). `GREATEST(MAX-MIN, 0)` ne protège pas d’un reset puisque `MAX-MIN` reste positif. Le vrai correctif doit sommer les hausses entre relevés consécutifs et ignorer les sauts négatifs. Déclencheurs ADW3000 : remplacement, reset usine ou reconfiguration CT/PT. Vérifier d’abord `acrel_agg_15m` pour des `energy_total_delta` aberrants.
- **P0-2.** Contrats non historisés : `UNIQUE(terrain_id)` et `ON CONFLICT DO UPDATE` écrasent l’ancien contrat (`schema-core.sql:151`, `tariffs.routes.js:109`) ; la facturation lit le contrat courant (`ai.worker.js:93`). Ajouter `valid_from`/`valid_to` et lire le contrat valable à la date facturée.
- **P0-3.** Route debug `test-listener` sans authentification en production (`app.js:109`). La désactiver par environnement ou l’authentifier.
- **P0-4.** Dashboard Traefik non sécurisé et absence de TLS (`docker-compose.yml:150-165`). Retirer `api.insecure`, fermer le port 8080 et activer Let’s Encrypt.
- **P0-5.** Secrets faibles par défaut (`ml-service/main.py:23-37`, fallbacks et JWT de développement). Supprimer `fix_admin_hash.sql`, puis purger les secrets historiques de Git avec une procédure dédiée.

## P1 — Élevé

- **P1-1.** Les tests de sécurité facturation ne s’exécutent jamais : le script `test` d’`api-core` scanne `src/`, alors que les tests sont dans `test/`. Élargir le glob.
- **P1-2.** `EnergyAudit.tsx:35` sans limite explicite aboutit au plafond silencieux de 5 000 ; la complétude (`:69`) suppose une cadence fixe de 15 minutes. Utiliser une API agrégée et calculer la cadence réelle.
- **P1-3.** `PowerQuality.tsx:49`, vue « 30 jours », est plafonnée à 25 000 lignes. Utiliser une API agrégée/downsamplée ou signaler clairement la troncature.
- **P1-4 — FAIT sur `ops/safe-deployment`, non déployé.** `deploy.sh` appelait les routes admin sans jeton et masquait les échecs. Les appels sont désormais sur flags explicites, authentifiés et bloquants.

## P2 — Moyen

- **P2-1.** API de lecture non paginable (`telemetry.routes.js:123-166`) : ajouter pagination et indicateurs `truncated`/`total`. `downsampleByStep` existe mais n’est pas utilisé (`time-window.ts:51`).
- **P2-2 — FAIT `ab95ce6`.** Export Excel sans plafond, en streaming.
- **P2-3 — FAIT `b8cdf43` + `ced780b`.** CSV/JSON par point via le backend.
- **P2-4 — FAIT `ced780b`.** Export par lot séquentiel.
- **P2-5.** Widget facture « live » sans `refetchInterval` malgré le label « 5 min » (`useApi.ts:247`).
- **P2-6.** Le mois de facture par défaut est choisi avant le chargement de la liste, ce qui peut produire un faux état « indisponible » (`Invoice.improved.tsx:110-118`).
- **P2-7.** Bug de date en décembre avec `currentMonth % 12` (`ai.worker.js:898`).
- **P2-8.** CI incomplète : aucun job `ml-service` et aucun test `worker-jobs` (`.github/workflows/ci.yml`).

## P3 — Faible

- **P3-1.** Liste des incidents non paginée, limitée aux 100 plus récents (`Incidents.tsx:41`).
- **P3-2.** Fichiers générés ou temporaires versionnés (`Important docs/Livrables/_build*`, `_tmp_docx_extract`).
- **P3-3.** `Simes_Ui/` est un sous-module fantôme sans `.gitmodules`; le client indique qu’il servait seulement d’inspiration.

## Audit énergétique et ML

### AM-P0

- **AM-1.** Le rapport d’audit énergétique échoue : le worker sélectionne `mp.dev_eui`, colonne inexistante ; la vraie colonne est `lora_dev_eui` (`schema-core.sql:69`, `apps/worker-jobs/src/reports.worker.js:27`). La valeur n’est pas utilisée : retirer la sélection.

### AM-P1

- **AM-2.** Recommandations et scores par point basés sur la dernière lecture, pas sur les dernières 24 heures (`reports.worker.js:164`, `:170-256`, et `EnergyAudit.tsx:86`).
- **AM-3.** Complétude = points × 96, donc cadence supposée à 15 minutes (`reports.worker.js:114`, `EnergyAudit.tsx:69`). Des compteurs à la minute peuvent afficher environ 1 500 %.
- **AM-4.** `IsolationForest(contamination=0.1)` (`main.py:1119`) impose environ 10 % de jours anormaux, même sur un terrain sain. Utiliser un score et un seuil.
- **AM-5.** Le reset compteur, même racine que P0-1, empoisonne l’entraînement et gonfle le sigma résiduel. Les fallbacks `MAX-MIN` ne sont pas protégés (`main.py:104`, `:179`, `:1721`, `reports.worker.js:277`).

### AM-P2

- **AM-6.** Le ML s’entraîne pendant la requête web, jusqu’à 500 itérations LightGBM (`main.py:518-538`, `:1746`). Déplacer l’entraînement en tâche de fond.
- **AM-7.** Modèle jamais rafraîchi entre deux entraînements ; prévision ancrée sur un `last_row` figé (`main.py:405`, `:543-590`). Contrôler l’âge du modèle et afficher un avertissement.
- **AM-8.** La détection résiduelle s’exécute rarement : les prédictions sont stockées seulement lors d’une visite ; le retrain nocturne appelle `/train-all` mais pas `/predict` (`ai.worker.js:788`). Planifier les prédictions.
- **AM-9.** `store_predictions` fait un `ON CONFLICT DO UPDATE` par terrain/jour et écrase les valeurs (`main.py:250`), rendant la base résiduelle incohérente.
- **AM-10.** Analyse incrémentale factice : `fetch_daily_features` charge toujours 365 jours (`main.py:1054`) ; seul le détecteur qualité respecte la fenêtre (`main.py:1232`).
- **AM-11.** Anomalies qualité sans `point_id` : la déduplication avec `COALESCE` fusionne tous les points d’un même type/jour (`main.py:989`, `:1243`).
- **AM-12.** Connexions `psycopg2` sans `statement_timeout` et chargements complets via `pandas.read_sql`, avec risque mémoire sur un gros terrain.

### AM-P3

- **AM-13.** Score d’audit à double pénalité : pénalité dédiée plus `issues*5` pour le même problème (`reports.worker.js:126-143`).
- **AM-14.** Le scheduler nettoie l’ancien job `ai.update_monthly_invoices` sur la queue `telemetry` au lieu de la queue `ai` (`scheduler.js:241-246`).
- **AM-15.** Risque de fuseau : prévisions avec `datetime.now()` naïf et agrégats journaliers en UTC. Cela fonctionne actuellement au Burkina Faso, UTC+0, mais reste fragile.

## Contrôle d’accès et ingestion

### SEC-P0

- **SEC-1 — DIFFÉRÉ.** Ingestion sans authentification (`ingestion-service/src/app.js`). Une personne pouvant atteindre `/ingest/*` peut injecter des mesures. Correctif cible : secret partagé ou HMAC Node-RED ↔ ingestion, plus rate-limit. En attendant, garder l’ingestion derrière le VPN.
- **SEC-2.** IDOR du module PV (`pv.routes.js`) : lecture inter-organisations et mutations sans contrôle de périmètre terrain. Ajouter les contrôles à la liste, au détail, à la production, à l’édition, à la suppression et à l’assignation.
- **SEC-3.** IDOR du module Solaire (`solar.routes.js`) : la liste sans `terrain_id`, le détail et la suppression ne sont pas limités à l’organisation.

### SEC-P1

- **SEC-4.** `site_access` n’est jamais appliqué : `verifyTerrainAccess` (`auth-middleware.js:44` et `telemetry.routes.js:7`) vérifie l’organisation mais pas les sites autorisés.
- **SEC-5.** Pas d’invalidation de jeton : le JWT contient rôle/organisation et reste valide 24 heures ; `requireAuth` ne revérifie ni le statut `active` ni le rôle (`auth-middleware.js:8-30`).

### SEC-P2

- **SEC-8.** IDOR sur les exports par point : `/reports/point/:pointId/{excel,csv,json}` vérifie seulement l’authentification. Résoudre le `terrain_id` du point puis appliquer `userCanAccessTerrain`.
- **SEC-6.** `POST /acrel` ne répond pas si `devices` n’est pas un tableau (`ingestion.routes.js:224`), laissant la connexion suspendue.
- **SEC-7.** Verrouillage de compte utilisable en déni de service : cinq échecs bloquent cinq minutes (`auth.routes.js:20`, `:69`).

## UI et cohérence visuelle

Le système de tokens existe (`index.css`, Tailwind : severity/status/data/energy/pq/forecast/chart-1..6), mais les pages le contournent.

- **UI-1.** Environ 50 usages de tokens sémantiques contre plus de 500 couleurs Tailwind en dur. Remplacer progressivement les couleurs de statut par les tokens.
- **UI-2.** Mode sombre cassé par les fonds clairs codés en dur.
- **UI-3.** Au moins trois palettes de graphes, sans cohérence avec le thème (`dashboard-sections.tsx:28`, `Exports.tsx:253`, `Forecasts.tsx:35`).
- **UI-4.** Le sélecteur de devise change seulement le symbole, sans conversion (`usePreferences.ts:127`).
- **UI-5.** La même devise porte deux noms, `FCFA` et `XOF`; la facture ne lit pas `prefs.currency` (`Invoice.improved.tsx:193`).
- **UI-6.** « Coût estimé » = énergie × tarif plat 193,4, différent de la vraie facture SONABEL. Les données tarifaires existent dans trois sources.
- **UI-7.** Formats numériques incohérents entre `toLocaleString('fr-FR')` et `toLocaleString()`. Centraliser un helper.

## Système de widgets

Le moteur `WidgetBoard.tsx` est correctement structuré et certains widgets autonomes utilisent de vraies données. Le registre contient toutefois des valeurs fabriquées et plusieurs erreurs de câblage.

### Données fabriquées

- **W-1.** `pv-production` (`widget-registry.ts:465`) : graphe 30 jours aléatoire et puissance installée dérivée de `points × 20`. Brancher le vrai endpoint PV ou retirer le widget.
- **W-2.** `pv-performance-ratio` (`:508`) : PR, disponibilité, curtailment, dégradation et tendance générés aléatoirement.
- **W-3.** `battery-status` (`:545`) : SOC, cycles, charge/décharge, santé et courbe 24 h aléatoires, sans source batterie.
- **W-4.** `cost-energy` (`:240`) : taux 0,095 codé en dur, sous-titre « +3,9 % vs hier » littéral et somme de l’odomètre.
- **W-5.** Métadonnées codées en dur : `completeness=98.5` (`:209`) et `confidence=0.87` (`:386`).

### Bugs de câblage

- **W-6.** Bande de confiance invisible : le resolver renvoie `{p50, lower, upper}` mais le rendu lit `p50` et `p90` (`WidgetBoard.tsx:447`).
- **W-7.** `aggregateColumnKpi` (`:92`) somme l’odomètre `energy_total`.
- **W-8.** `buildDefaultLayout` (`WidgetBoard.tsx:816`) ajoute quatre widgets absents du registre, ensuite filtrés (`:1000`).
- **W-9.** Le widget anomalies filtre `warning`/`info`, tandis que le ML produit `low`/`medium`/`high`/`critical`.
- **W-10.** `generic-chart` et `generic-table` lisent `ctx.readings`, plafonné à 12 000 lignes sur 24 heures et tous points confondus (`WidgetBoard.tsx:930`).
- **W-11.** `cost-energy` code `XOF` en dur et ignore `prefs.currency` (`WidgetBoard.tsx:403`).

## Performance des graphes

La racine est le chargement de mesures brutes, souvent plafonné à 120 000–450 000 lignes, alors qu’un hook agrégé existe (`useApi.ts:399`, `/chart-data`). `adaptiveBucketMs` existe aussi (`time-window.ts:44`).

- **PERF-1.** Basculer les graphes puissance/énergie/tension vers `useChartData` lorsque les agrégats ont déjà les colonnes (`PointDetails`, `Donnees`, `dashboard-sections`, `WidgetBoard`). Une partie est remplacée par PERF-4 afin de conserver toutes les métriques.
- **PERF-2.** THD, déséquilibre, phases et facteur de puissance ne sont pas tous disponibles dans les tables/route agrégées. Étendre l’agrégation ou réutiliser l’endpoint downsamplé.
- **PERF-3.** Projeter les colonnes sur ce qui reste brut, notamment `Exports.tsx`. `PointDetails` est déjà traité sur la branche performance.
- **PERF-4 — FAIT partiellement, non déployé.** Sous-échantillonnage serveur par `time_bucket` et moyenne pour la courbe de charge et `PointDetails`. Tester contre TimescaleDB restauré, conserver les maxima nécessaires à `PowerPeaksTable`, puis généraliser si pertinent.
