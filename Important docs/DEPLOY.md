# SIMES – VPS Deployment Guide

## Production VPS (source of truth)

| Item | Current value |
|---|---|
| Host | Hostinger VPS `76.13.44.23` |
| Repository | `/home/simes/simes-bf` |
| Compose file | `/home/simes/simes-bf/infra/docker/docker-compose.yml` |
| Docker engine | Docker CE managed by `docker.service` |
| Docker data root | `/var/lib/docker` |
| Production branch (2026-07-29) | `deploy/fix-exports-plus-perf-dashboard` |
| Production commit (2026-07-29) | `f9d9f896` |

Docker installed through Snap was removed on 2026-07-29. Do not reinstall it:
SIMES must use the system Docker daemon only. Before any deployment, verify that
`docker info --format '{{.DockerRootDir}}'` returns `/var/lib/docker`.

The paths below use the real production location. `/opt/simes` is not used on
the current VPS.

## Prerequisites

| Requirement | Minimum |
|---|---|
| Ubuntu / Debian | 22.04+ |
| Docker | 24+ |
| Docker Compose | v2+ |
| RAM | 4 GB |
| Disk | 40 GB SSD |
| Ports open | 80, 443, 22 |

---

## 1. Clone the repository

```bash
ssh your-user@your-vps
git clone <repo-url> /home/simes/simes-bf
cd /home/simes/simes-bf
```

## 2. Configure environment

```bash
cd infra/docker
cp .env.example .env
nano .env
```

**Change these values** (use strong passwords in production):
```
CORE_DB_PASSWORD=<strong-random>
TELEMETRY_DB_PASSWORD=<strong-random>
REDIS_PASSWORD=<strong-random>
MINIO_ROOT_PASSWORD=<strong-random>
```

Optionally set your domain:
```
DOMAIN=simes.mondomaine.com
ACME_EMAIL=admin@mondomaine.com
```

## 3. Build and start all services

```bash
docker compose up -d --build
```

This starts:
- **core-db** – PostgreSQL 16 (core data)
- **telemetry-db** – TimescaleDB (time-series)
- **redis** – Queue broker
- **minio** – Object storage
- **traefik** – Reverse proxy (ports 80/443)
- **api-core** – Express API backend
- **worker-jobs** – BullMQ consumer workers
- **frontend-web** – React SPA (Nginx)

## 4. Initialize databases

On first run, the SQL init scripts are mounted automatically. If you need to apply migrations:

```bash
# Core DB migrations
docker exec -i simes-core-db psql -U simes -d simes_core \
  < infra/db/migrations/001_core_job_results.sql
docker exec -i simes-core-db psql -U simes -d simes_core \
  < infra/db/migrations/003_core_tariffs.sql
docker exec -i simes-core-db psql -U simes -d simes_core \
  < infra/db/migrations/004_core_tariffs_seed_202310.sql
docker exec -i simes-core-db psql -U simes -d simes_core \
  < infra/db/migrations/005_core_incoming_and_mapping.sql

# Telemetry DB migrations
docker exec -i simes-telemetry-db psql -U simes -d simes_telemetry \
  < infra/db/migrations/002_telemetry_acrel_agg.sql
```

## 5. Verify deployment

```bash
# Check containers
docker compose ps

# Health check
curl http://localhost/api/health

# Frontend
curl -I http://localhost/
```

## 6. DNS & TLS (production)

Point your domain's A record to the VPS IP. Then update `docker-compose.yml` traefik config:

```yaml
traefik:
  command:
    - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}
    - --certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json
    - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    - --entrypoints.websecure.address=:443
  volumes:
    - ./acme:/acme
```

Add to `frontend-web` labels:
```yaml
- "traefik.http.routers.frontend.rule=Host(`${DOMAIN}`)"
- traefik.http.routers.frontend-secure.tls.certresolver=letsencrypt
```

## 7. Configure Milesight gateways

On each Milesight UG67 gateway, configure the HTTP integration to POST to:

```
http://<VPS-IP>/ingest/milesight
```

Content-Type: `application/json`

The system will automatically buffer unknown gateways and route mapped ones.

## 8. Admin workflow after deployment

Once the platform is running and the UG67 starts sending data:

1. **Créer une organisation** — Onglet *Organisations & Sites* de la page Admin
2. **Créer un site** — Déplier l'organisation, ajouter un site
3. **Mapper le concentrateur** — Onglet *Concentrateurs*, choisir l'org/site, nommer le terrain → le terrain est créé et le gateway est lié
4. **Auto-provisionner les appareils** — Onglet *Appareils*, sélectionner le gateway mappé, cliquer « Auto-provisionner » → les points de mesure sont créés automatiquement à partir des devices Acrel découverts
5. **Visualiser** — Se connecter en tant qu'utilisateur org, voir le Dashboard et le DataMonitor avec les données en temps réel

L'URL d'ingestion est aussi affichée en bannière sur la page Admin (copiable en un clic).

## 9. Monitoring & Logs

```bash
# All logs
docker compose logs -f

# Specific service
docker compose logs -f api-core
docker compose logs -f worker-jobs

# DB access
docker exec -it simes-core-db psql -U simes -d simes_core
docker exec -it simes-telemetry-db psql -U simes -d simes_telemetry
```

## 10. Database admin UI (pgAdmin)

pgAdmin 4 is included in the deployment for graphical database administration:

```
http://localhost:5050  (after ./deploy.sh)
```

**Credentials** (from the production secret store or local `.env`):
- Email: `${PGADMIN_EMAIL}`
- Password: `${PGADMIN_PASSWORD}`

### Quick setup

After deployment, the `deploy.sh` script prints database connection details. To register servers in pgAdmin:

1. Open http://localhost:5050
2. Login with credentials above
3. Click **Register → Server**
4. Fill in the form:
   - **Name**: `SIMES Core` (or choose)
   - **Host**: `core-db`
   - **Port**: `5432`
   - **Database**: `simes_core`
   - **Username**: `simes`
   - **Password**: `${CORE_DB_PASSWORD}` (read securely from `.env`)
   - Click **Save**

5. Repeat for Telemetry DB:
   - **Name**: `SIMES Telemetry`
   - **Host**: `telemetry-db`
   - **Port**: `5432`
   - **Database**: `simes_telemetry`
   - **Username**: `simes`
   - **Password**: `${TELEMETRY_DB_PASSWORD}`

### Audit queries

Once connected, navigate to: **Servers** → **SIMES Core** → **Databases** → **simes_core** → **Schemas** → **public** → **Tables**

Common audit queries (right-click → **Query Tool**):

```sql
-- Count readings
SELECT COUNT(*) FROM acrel_readings;

-- Readings timeline (recent 10)
SELECT time, point_id, voltage_a, current_a FROM acrel_readings 
ORDER BY time DESC LIMIT 10;

-- Data points coverage
SELECT COUNT(DISTINCT point_id) FROM acrel_readings;

-- Temporal range
SELECT MIN(time) as earliest, MAX(time) as latest FROM acrel_readings;

-- NULL check (data quality)
SELECT COUNT(*), COUNT(current_a) FROM acrel_readings;
```

See [PGADMIN.md](./PGADMIN.md) for comprehensive audit and troubleshooting.

## 11. Backup

```bash
# Core DB backup
docker exec simes-core-db pg_dump -U simes simes_core > backup_core_$(date +%F).sql

# Telemetry DB backup
docker exec simes-telemetry-db pg_dump -U simes simes_telemetry > backup_telemetry_$(date +%F).sql
```

## 12. Update deployment

```bash
cd /home/simes/simes-bf
git status --short --branch
git fetch origin
# Select and review the exact branch/commit approved for production.
git switch <approved-production-branch>
git pull --ff-only
cd infra/docker
docker compose up -d --build
```

Do not use `docker compose down`, remove Docker networks, or prune all builder
data as part of a routine update. Those operations create avoidable downtime
and previously left Traefik detached from `simes-edge`.

After every update, verify the proxy as well as the application containers:

```bash
docker compose ps
docker inspect simes-traefik --format '{{json .NetworkSettings.Networks}}'
curl -fsS http://localhost/api/health
curl -fsSI http://localhost/login
```

Traefik must be running and attached to `simes-edge`. A healthy backend with a
stopped or detached Traefik results in an HTTP 504 for users.

---

## Architecture

```
Internet
    │
    ▼
┌──────────┐
│  Traefik │ :80/:443
└────┬─────┘
     │
  ├── /          → frontend-web (nginx + React SPA)
  ├── /api/*     → api-core:3000
  ├── /ingest/*  → ingestion-service:3001
     │
     └── Internal network
            ├── core-db       (postgres:5432)
            ├── telemetry-db  (timescale:5432)
            ├── redis         (:6379)
            ├── minio         (:9000)
            └── worker-jobs   (BullMQ consumers)
```

## Data flow

```
Milesight Gateway
    │ HTTP POST
    ▼
/ingest/milesight
    │
    ├─ Unknown gateway? → incoming_messages (buffer)
    │
    └─ Mapped gateway? → acrel_readings (direct ingest)
                              │
                              ▼
                      worker-jobs (aggregate 15m/daily)
                              │
                              ▼
                      Frontend Dashboard / DataMonitor / Invoice
```
