# Passation — SIMES-BF (état au 2026-07-29)

> Document de reprise. Objectif : permettre à une autre personne (ou à un autre assistant)
> de continuer le travail de remédiation sans avoir à tout redécouvrir.
> Le backlog détaillé et priorisé est dans `REMEDIATION_PLAN.md`.

---

## 1. Le projet en 30 secondes

SIMES-BF : plateforme SaaS de monitoring énergétique (Burkina Faso). Compteurs **Acrel ADW3000**
→ LoRaWAN → gateways Milesight UG67 → Node-RED → ingestion → **TimescaleDB** → workers
(agrégations, facturation, ML) → frontend React.

**Microservices** (Docker Compose, `infra/docker/docker-compose.yml`) :
`frontend-web` (React/nginx) · `api-core` (Express) · `ingestion-service` · `worker-jobs`
(BullMQ) · `ml-service` (FastAPI/LightGBM) · Postgres (`core-db`) · TimescaleDB
(`telemetry-db`) · Redis · MinIO · Traefik (proxy) · pgAdmin.

**Hiérarchie multi-tenant** : Organisation → Site → Terrain (1 gateway) → Zone →
Point de mesure (compteur).

---

## 2. Environnements

| | Chemin / adresse |
|---|---|
| Repo local principal | `D:\Documents\IC\IC3\PING\simes-bf` (Windows) |
| Worktree ops isolé | `D:\Documents\IC\IC3\PING\simes-bf-audit` |
| Repo VPS | `/home/simes/simes-bf` |
| VPS | Hostinger, `76.13.44.23`, Ubuntu, 2 vCPU / 8 Go |
| Compose (VPS) | `/home/simes/simes-bf/infra/docker/docker-compose.yml` |
| Docker actif | Docker système uniquement, data root `/var/lib/docker` |
| Site | `http://76.13.44.23/` — HTTP simple, pas de HTTPS (voir P0-4) |

Les secrets en clair ont été retirés des documents versionnés au commit `d64b760f`.
Les accès réels ne doivent pas être remis dans Git. Leur rotation reste une opération séparée.

---

## 3. ⚠️ État de production et travail non déployé

Le VPS est propre sur la branche `hotfix/minio-healthcheck-prod`, commit
`d64b760f900b11a8bb046810d601aa5042aa82eb`, avec un worktree propre au
2026-07-29.

Les corrections applicatives ci-dessous restent **locales, non poussées et non déployées** :

- `fix/exports-streaming` (5 commits) ;
- `perf/dashboard-load-curve-downsample` (3 commits).

Elles ont été compilées et testées en fumée, mais n'ont jamais été exécutées contre une
copie de la vraie base ni en production.

Les opérations VPS effectuées le 2026-07-29 ne constituent pas un déploiement applicatif :

- Docker Snap supprimé et neutralisé ;
- Traefik recréé proprement via Compose ;
- MinIO remis healthy ;
- sauvegarde complète créée, restaurée dans des conteneurs isolés et copiée hors VPS.

---

## 4. Branches et travail réalisé

### `fix/exports-streaming` (5 commits)

✅ codé · ✅ vérifié localement · ❌ non testé avec la vraie base · ❌ non déployé

| Commit | Contenu |
|---|---|
| `ab95ce6` | Excel par point en streaming et sans plafond 50 000. |
| `b8cdf43` | CSV/JSON par point en streaming, pagination keyset. |
| `ced780b` | Frontend branché sur les routes backend, export par lot séquentiel. |
| `8c09f71` | CSV/JSON terrain + garde `userCanAccessTerrain`. |
| `6bb6887` | KPI énergie regroupé par compteur au lieu de mélanger les odomètres. |

Les `0` ne deviennent plus des cellules vides ; les `NULL` restent distincts de `0`.

Vérifications : `node --check`, `tsc --noEmit`, smoke tests Excel/CSV/JSON et
regroupement énergie.

### `perf/dashboard-load-curve-downsample` (3 commits)

✅ codé · ✅ `tsc` · ❌ SQL non testé avec TimescaleDB réel · ❌ non déployé

| Commit | Contenu |
|---|---|
| `933e941` | Endpoint `/terrains/:id/readings/downsampled` avec `time_bucket` et AVG. |
| `379f03d` | `UnifiedLoadCurve` branchée sur l'endpoint. |
| `a0e89e8` | `PointDetails` branché sur l'endpoint. |

À vérifier contre une copie restaurée de TimescaleDB :

- `GROUP BY` sur l'expression complète ;
- alignement des buckets sur l'epoch ;
- courbes visuellement équivalentes ;
- `PowerPeaksTable` reste sur les données brutes car elle a besoin de `MAX`.

### `ops/safe-deployment`

Branche créée depuis le commit exact de production `d64b760f`.

Objectif :

- préserver les services de données lors d'un déploiement courant ;
- créer et valider les dumps Core/Telemetry avant mutation ;
- refuser un daemon ambigu ou un dépôt sale ;
- ne jamais tirer de nouvelles images sans `--pull-images` explicite ;
- ne jamais réconcilier les services persistants/admin sur une installation existante ;
- rendre les migrations et probes bloquantes ;
- vérifier Traefik, `simes-edge`, UI, API, ingestion, pgAdmin, MinIO et les healthchecks ;
- ne lancer les opérations admin que sur flag explicite avec `SIMES_ADMIN_TOKEN`.

Cette branche n'est **pas déployée**.

Vérifications locales effectuées :

- `bash -n` ;
- aide et rejet des options inconnues ;
- arrêts contrôlés pour `.env` absent, socket Docker inattendu, Docker Snap détecté,
  dépôt sale, jeton admin absent, volumes DB orphelins et mauvais projet Compose ;
- chemin nominal simulé de bout en bout : dumps validés, checksums, renommage du répertoire
  `.partial`, migrations et probes. Aucun Docker réel ni VPS n'a été appelé.

---

## 5. Ordre de travail restant

1. **Faire relire puis pousser `ops/safe-deployment`**, sans l'exécuter en production.
2. **Automatiser les sauvegardes** quotidiennes, la rétention et une copie hors VPS.
3. **Tester les branches exports/performance contre des bases restaurées isolées.**
4. Définir l'ordre de merge, puis déployer un correctif à la fois avec validation explicite.
5. Reprendre les vagues du `REMEDIATION_PLAN.md`.

Décisions client à respecter :

- `P0-1` (reset compteur/facturation) : différé ;
- `SEC-1` (authentification ingestion) : différé ;
- accès et secrets : ne pas modifier sans instruction explicite.

---

## 6. Déploiement et runbook VPS

### 6.1 État Docker validé le 2026-07-29

- un seul `dockerd` : `/usr/bin/dockerd` ;
- Docker data root : `/var/lib/docker` ;
- service Docker système : actif et activé au boot ;
- Docker Snap : package absent, aucun montage, processus ou scope orphelin ;
- `snap.docker.dockerd.service` : masqué vers `/dev/null` et inactif ;
- 12 conteneurs de production actifs.

Le masque Docker Snap est volontaire : ce n'est pas un logiciel résiduel, c'est la barrière
qui empêche son service de repartir automatiquement.

### 6.2 Incident Traefik historique et résolution

Après un reboot, le site était tombé avec des `504` parce que Traefik ne rejoignait plus les
backends. La réparation temporaire avait été :

```bash
docker start simes-traefik
docker network connect simes-edge simes-traefik
```

L'état manuel n'existe plus.

Le 2026-07-29 :

1. un Traefik temporaire a été créé sur `simes-edge` et a servi UI/API/ingestion en `200` ;
2. seul `simes-traefik` a été recréé avec :

```bash
cd /home/simes/simes-bf/infra/docker
docker compose up -d --no-deps --force-recreate --pull never traefik
```

3. le nouvel ID est `1cfc5c51c35505668fb02c0abc4eaa6207fe251c711e6c097eb55a30941928bc` ;
4. son hash runtime correspond au hash Compose
   `2528ebf016a2dcb4878e70e71d22cd92a89d6231cc974cea5f4caec028d74fb7` ;
5. il est directement sur `simes-edge`, avec `restart: unless-stopped` ;
6. aucun autre conteneur n'a été recréé et aucune donnée n'a changé.

Probes validées :

- `/login` → `200` ;
- `/api/health` → `200` ;
- `/ingest/health` → `200` ;
- Traefik API → `200` ;
- pgAdmin, Portainer, MinIO, ML → `200`.

### 6.3 Sauvegardes de sécurité disponibles

Sauvegarde principale :

- VPS : `/var/backups/simes/pre-remediation-20260729T142520Z`;
- archive hors VPS :
  `D:\Documents\IC\IC3\PING\simes-bf-backups\pre-remediation-20260729T142520Z.tar.gz`;
- SHA-256 :
  `4207a25f0bd80307a58b1dcb9328a834f108bc7c4e41d48cb7a077b0294f5a08`.

Les dumps Core et Telemetry ont été restaurés dans des conteneurs isolés sans réseau.
Les compteurs restaurés correspondent exactement aux références de production.

Snapshots supplémentaires :

- `snap-docker-cleanup-20260729T145605Z`;
- `traefik-recreate-20260729T150237Z`.

Ils existent sur le VPS et hors VPS, avec SHA-256 validés et ACL locales restreintes.

### 6.4 Règles de déploiement

Ne jamais exécuter un déploiement depuis un worktree sale.

La branche `ops/safe-deployment` rend le chemin normal incrémental :

```bash
./deploy.sh
```

Par défaut :

- pas de `docker compose down` ;
- pas de suppression de réseau ;
- pas de `--force-recreate` ;
- pas de pull d'image ;
- services de données/admin jamais réconciliés par ce script sur une installation existante ;
- dumps Core/Telemetry vérifiés avant migrations ;
- échec des migrations ou probes = échec du déploiement.

Flags à impact explicite :

```bash
./deploy.sh --pull-images
./deploy.sh --repair-agg
./deploy.sh --retry-failed-jobs
```

Les deux derniers exigent `SIMES_ADMIN_TOKEN`.

Tant que cette branche n'est pas fusionnée et déployée, vérifier le script présent sur le VPS
avant de l'utiliser.

### 6.5 MinIO

Le `healthcheck` MinIO a été corrigé sur `hotfix/minio-healthcheck-prod`.
Au 2026-07-29, `simes-minio` est `healthy` et répond `200` depuis le réseau interne.

---

## 7. Gotchas techniques validés

### Compteurs ADW3000 / énergie

- `energy_total` est un registre cumulatif, donc un odomètre.
- Consommation = dernier − premier relevé, **par compteur**.
- `EP` → `energy_total`, `EPI` → import, `EPE` → export/production PV.
- Décodage : `brut × 0.01 × CT × PT`.

### KPI énergie des exports

Le bug corrigé par `6bb6887` concernait uniquement la page Exports et son PDF.
Il n'écrit pas en base et ne corrige pas la facturation.

### Reset compteur (`P0-1`, différé)

`MAX − MIN` ne protège pas contre un reset. `GREATEST(MAX − MIN, 0)` est un no-op.
Le vrai correctif doit sommer les hausses consécutives et ignorer les sauts négatifs.

### Graphes et plafonds

`/terrains/:id/readings` peut renvoyer des centaines de milliers de lignes sans pagination.
Les agrégats existants n'ont pas toutes les colonnes électriques ; c'est pourquoi PERF-4 utilise
un sous-échantillonnage serveur qui conserve les métriques.

### TimescaleDB et `pg_dirtyread`

Le catalogue Telemetry référence `pg_dirtyread`, mais l'image TimescaleDB actuelle ne contient
plus ses fichiers runtime. La sauvegarde principale contient :

- le code source exact au commit `7cd9a62b0d5a260e68da46c42b375033811a207c` ;
- le runtime compilé pour PostgreSQL 16 ;
- une preuve de restauration réussie avec cette dépendance.

---

## 8. Pointeurs de code

- Exports : `apps/frontend-web/src/pages/org/Exports.tsx`
- Routes export/downsampled :
  `apps/api-core/src/modules/telemetry/telemetry.routes.js`
- Courbe de charge :
  `apps/frontend-web/src/components/widgets/dashboard-sections.tsx`
- Hooks API : `apps/frontend-web/src/hooks/useApi.ts`, `apps/frontend-web/src/lib/api.ts`
- Facturation : `apps/worker-jobs/src/ai.worker.js`
- Audit énergétique : `apps/worker-jobs/src/reports.worker.js`
- Widgets : `apps/frontend-web/src/lib/widget-registry.ts`
- Codec compteur : `Important docs/ADW3000Codec.js`

---

## 9. Méthode de travail

- Une branche et un commit par correctif.
- Vérifier avant commit : syntaxe, typecheck, test de fumée pertinent et `git diff --check`.
- Ne jamais déployer sans accord explicite.
- Montrer le diff avant une opération de production.
- Séparer les changements système, sécurité, application et documentation.
- Ne jamais réintroduire un secret réel dans Git ou dans les sorties de déploiement.
