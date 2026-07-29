# SIMES-BF production VPS runbook

Last verified: 2026-07-29.

## Canonical layout

- VPS: `76.13.44.23`, Ubuntu 24.04.
- Repository: `/home/simes/simes-bf`.
- Compose directory: `/home/simes/simes-bf/infra/docker`.
- Docker daemon: system Docker CE (`docker.service`).
- Docker data root: `/var/lib/docker`.
- Compose networks: `simes-edge` and `simes-internal`.
- Portainer is a standalone container; the other production services belong to
  the Compose project.

Docker Snap was installed accidentally and removed permanently on 2026-07-29.
Its service is masked. Never install or enable Docker through Snap on this VPS.

## Mandatory pre-deployment checks

```bash
cd /home/simes/simes-bf
git status --short --branch
git fetch origin
docker info --format '{{.DockerRootDir}}'
docker context show
cd infra/docker
docker compose config --quiet
docker compose ps
```

Expected Docker root: `/var/lib/docker`. Stop if another root or daemon appears.
Do not deploy from a dirty worktree.

Before changing database containers, create logical dumps of both databases and
verify the backup files are non-empty. Compose-managed named volumes contain the
live data and must never be deleted during an application deployment.

## Safe application update

Only deploy a branch and commit explicitly approved for production.

```bash
cd /home/simes/simes-bf
git switch <approved-production-branch>
git pull --ff-only
cd infra/docker
docker compose config --quiet
docker compose up -d --build
```

Routine updates must not run `docker compose down`, `docker network rm`,
`docker volume rm`, or a global builder prune.

## Post-deployment checks

```bash
cd /home/simes/simes-bf/infra/docker
docker compose ps
docker inspect simes-traefik --format '{{json .NetworkSettings.Networks}}'
curl -fsS http://localhost/api/health
curl -fsS http://localhost/ingest/health
curl -fsSI http://localhost/login
```

Check that Traefik is running and attached to `simes-edge`. If the API responds
inside its container but public requests return 504, inspect Traefik and its
network attachment first.

## Incident: Traefik unavailable or detached

Collect evidence before changing anything:

```bash
docker ps -a --filter name=simes-traefik
docker logs --tail 100 simes-traefik
docker inspect simes-traefik --format '{{json .NetworkSettings.Networks}}'
docker network inspect simes-edge
```

Reconcile only Traefik through Compose:

```bash
cd /home/simes/simes-bf/infra/docker
docker compose up -d --no-deps traefik
```

Do not remove shared networks while application containers are running.

## Data-safety rule

Stopping or recreating a container does not delete its named volume. Removing a
volume does. Never use `docker compose down -v`, `docker volume prune`, or
manual volume deletion on production.
