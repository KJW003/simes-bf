# SIMES – VPS Deployment Guide

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
git clone <repo-url> /opt/simes
cd /opt/simes
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
curl -I http://localhost/testUi/
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
http://<VPS-IP>/api/ingest/milesight
```

Content-Type: `application/json`

The system will automatically buffer unknown gateways and route mapped ones.

## 7b. Admin workflow after deployment

Once the platform is running and the UG67 starts sending data:

1. **Créer une organisation** — Onglet *Organisations & Sites* de la page Admin
2. **Créer un site** — Déplier l'organisation, ajouter un site
3. **Mapper le concentrateur** — Onglet *Concentrateurs*, choisir l'org/site, nommer le terrain → le terrain est créé et le gateway est lié
4. **Auto-provisionner les appareils** — Onglet *Appareils*, sélectionner le gateway mappé, cliquer « Auto-provisionner » → les points de mesure sont créés automatiquement à partir des devices Acrel découverts
5. **Visualiser** — Se connecter en tant qu'utilisateur org, voir le Dashboard et le DataMonitor avec les données en temps réel

L'URL d'ingestion est aussi affichée en bannière sur la page Admin (copiable en un clic).

## 8. Monitoring & Logs

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

## 9. Backup

```bash
# Core DB backup
docker exec simes-core-db pg_dump -U simes simes_core > backup_core_$(date +%F).sql

# Telemetry DB backup
docker exec simes-telemetry-db pg_dump -U simes simes_telemetry > backup_telemetry_$(date +%F).sql
```

## 10. Update deployment

```bash
cd /opt/simes
git pull
cd infra/docker
docker compose up -d --build
```

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
     ├── /testUi/*  → frontend-web (nginx + React SPA)
     │                    └── /api/*  → api-core:3000
     ├── /api/*     → api-core:3000
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
/api/ingest/milesight
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
