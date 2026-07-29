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

Le VPS est propre sur la branche `ops/safe-deployment`, commit
`c54a52761f840c3d1b951b26c4cd439c09bd4af3`, avec un worktree propre au
2026-07-29.

Les corrections applicatives ci-dessous restent **locales, non poussées et non déployées** :

- `fix/exports-streaming` (5 commits) ;
- `perf/dashboard-load-curve-downsample` (3 commits).

Elles ont été compilées et testées en fumée, mais n'ont jamais été exécutées contre une
copie de la vraie base ni en production.

Les opérations VPS effectuées le 2026-07-29 ne constituent pas un déploiement applicatif :

- Docker Snap supprimé et neutralisé ;
- outils de déploiement sécurisé, sauvegarde et supervision installés ;
- Traefik recréé proprement via Compose, dashboard désactivé et port 8080 fermé ;
- MinIO remis healthy ;
- sauvegarde complète créée, restaurée dans des conteneurs isolés et copiée hors VPS ;
- timers de sauvegarde et de supervision activés.

Le code applicatif de `frontend-web`, `api-core`, `ingestion-service`, `worker-jobs` et
`ml-service` n'a pas été reconstruit ni redéployé. Le nouveau `deploy.sh` est installé mais
n'a pas encore servi à un déploiement applicatif réel.

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

Cette branche est poussée et installée sur le VPS au commit
`c54a52761f840c3d1b951b26c4cd439c09bd4af3`.

Vérifications effectuées :

- `bash -n` ;
- aide et rejet des options inconnues ;
- arrêts contrôlés pour `.env` absent, socket Docker inattendu, Docker Snap détecté,
  dépôt sale, jeton admin absent, volumes DB orphelins et mauvais projet Compose ;
- chemin nominal simulé de bout en bout : dumps validés, checksums, renommage du répertoire
  `.partial`, migrations et probes ;
- wrapper `/usr/local/sbin/simes-deploy` installé et testé sur l'aide et une option invalide ;
- le chemin complet de déploiement applicatif avec migrations n'a pas encore été exécuté
  en production.

---

## 5. Ordre de travail restant

1. **Tester les branches exports/performance contre des bases restaurées isolées.**
2. Définir l'ordre de merge, puis déployer un correctif à la fois avec validation explicite.
3. Reprendre les vagues du `REMEDIATION_PLAN.md`.

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

1. un Traefik candidat a été créé sans dashboard sur `simes-edge` et a servi
   UI/API/ingestion en `200` ;
2. seul `simes-traefik` a été recréé avec :

```bash
cd /home/simes/simes-bf/infra/docker
docker compose up -d --no-deps --force-recreate --pull never traefik
```

3. le nouvel ID est `d134d271e54d1f19d7e93b2a504ea117b926ede80d1f346dec551d3f0d23daa4` ;
4. il est directement sur `simes-edge`, avec `restart: unless-stopped` ;
5. le dashboard et l'API Traefik sont désactivés, et seul `80:80` est publié ;
6. aucun autre conteneur n'a été recréé et aucune donnée n'a changé.

Probes validées :

- `/login` → `200` ;
- `/api/health` → `200` ;
- `/ingest/health` → `200` ;
- TCP 8080 → fermé ;
- TCP 443 → fermé, inchangé : HTTPS n'a volontairement pas été activé ;
- pgAdmin, Portainer, MinIO, ML → `200`.

Depuis le poste Windows utilisé le 2026-07-29, les requêtes HTTP directes vers l'IP publique
reçoivent une page `FortiGuard Intrusion Prevention - Access Blocked`. Le VPS répond pourtant
`200` avec le même en-tête `Host`, son firewall est ouvert et Traefik route correctement :
ce `403` vient du filtre réseau FortiGuard externe au VPS, pas de SIMES.

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

Sauvegarde automatisée validée :

- archive VPS :
  `/var/backups/simes/daily/daily-20260729T165034Z.tar.gz` ;
- export chiffré :
  `/srv/simes-backup-export/archives/daily-20260729T165034Z.tar.gz.cms` ;
- SHA-256 export :
  `a06d6d981f9deeb3db2d55667e91834f5d7203986fe49e5c8253b36d6350ccd9` ;
- copie hors VPS :
  `D:\Documents\IC\IC3\PING\simes-bf-backups\automated` ;
- dumps Core et Telemetry restaurés sans réseau et comparés aux comptes/timestamps de
  production ;
- export hors VPS déchiffré et archive tar vérifiée, puis copie déchiffrée temporaire supprimée.

`simes-backup.timer` s'exécute chaque jour vers `05:30 UTC`, avec un délai aléatoire maximal
de dix minutes. Rétention : 14 jours sur le VPS, 30 jours dans l'export chiffré, 90 jours
sur le poste hors VPS.

### 6.4 Règles de déploiement

Ne jamais exécuter un déploiement depuis un worktree sale.

La branche `ops/safe-deployment` est installée. Le point d'entrée opérateur est :

```bash
sudo simes-deploy
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

Le script refuse notamment un autre daemon Docker, Docker Snap, un dépôt sale, un backup
invalide, une migration en échec ou une probe post-déploiement en échec.

### 6.5 MinIO

Le `healthcheck` MinIO a été corrigé sur `hotfix/minio-healthcheck-prod`.
Au 2026-07-29, `simes-minio` est `healthy` et répond `200` depuis le réseau interne.

### 6.6 Supervision et alertes

`simes-ops-monitor.timer` s'exécute toutes les cinq minutes, indépendamment de BullMQ.
Il vérifie :

- l'unique daemon Docker système, `/var/lib/docker` et la barrière anti-Snap ;
- les conteneurs requis, UI, API, ingestion et la fermeture de TCP 8080 ;
- l'âge de la dernière sauvegarde ;
- la fraîcheur des mesures quand elle est activée.

Les alertes sont dédupliquées dans la table `incidents` et journalisées par systemd.
Le self-test a créé puis résolu `ops_monitor_self_test`. L'audit final indique
`infrastructure_issues=0`, `backup_issue=none` et aucun incident `ops_%` ouvert.

Les équipements étant volontairement éteints depuis le 27 juillet,
`SIMES_FRESHNESS_ENABLED=false` reste configuré dans `/etc/simes/monitor.env`.
Cela ne supprime ni ne modifie les incidents historiques du worker
`stale_device_monitor`, qui reste un mécanisme applicatif séparé.
À leur remise en marche, passer cette valeur à `true`, puis lancer :

```bash
sudo systemctl start simes-ops-monitor.service
```

### 6.7 Copie hors VPS

Le compte `simes-backup` est limité à une clé dédiée, chrooté dans
`/srv/simes-backup-export`, forcé sur `internal-sftp -R` et sans shell, mot de passe,
forwarding ni upload. Les tests ont confirmé le refus d'un upload et d'une commande shell.

La tâche Windows `SIMES-BF Offsite Backup Pull` s'exécute chaque jour à `06:15 UTC`,
avec reprise au prochain démarrage disponible, et vérifie le SHA-256. Elle a été exécutée
manuellement avec `LastTaskResult=0`. Elle utilise un compte Windows interactif : le poste
doit être allumé et l'utilisateur connecté ; sinon `StartWhenAvailable` reporte l'exécution.

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
