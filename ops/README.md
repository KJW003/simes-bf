# SIMES production operations

These scripts are installed on the production VPS from the reviewed Git commit.
They never source Docker's `.env`, never stop the stack, and never delete Docker
volumes.

## Daily backups

`simes-backup.timer` runs once per day at 05:30 UTC with up to ten minutes of
random delay. The backup includes:

- verified custom-format dumps of Core PostgreSQL and Telemetry TimescaleDB;
- PostgreSQL globals;
- an authenticated Redis RDB and a crash-consistent Redis volume archive;
- read-only volume archives for MinIO, ML models, pgAdmin, and Portainer;
- Compose configuration, Docker `.env`, the exact Git tree and commit;
- the PostgreSQL 16 `pg_dirtyread` runtime and source snapshot required by the
  current Telemetry catalog.

Local archives are root-only and retained for 14 days. A CMS-encrypted copy is
staged for read-only offsite retrieval and retained for 30 days. The offsite
private decryption key never exists on the VPS.

The Windows pull task uses a dedicated Ed25519 key and a chrooted, read-only
SFTP account. It cannot execute commands, upload files, open a shell, or read
anything outside the encrypted backup export. Verified local copies are retained
for 90 days. The task also uses a pinned OpenSSH `known_hosts` file and refuses
unknown or changed server host keys. The authorized public key is held root-only
under `/etc/ssh/authorized_keys`; the account cannot replace it.

Useful commands:

```bash
sudo simes-backup --check
sudo systemctl start simes-backup.service
sudo systemctl status simes-backup.service
sudo journalctl -u simes-backup.service
```

## Independent monitoring

`simes-ops-monitor.timer` runs every five minutes. It checks:

- exactly one Docker daemon and `/var/lib/docker` as its data root;
- required containers;
- UI, API, and ingestion HTTP probes;
- age of the last successful automated backup;
- Telemetry freshness when not in planned maintenance.

Alerts are deduplicated in the existing `incidents` table and are visible in the
SIMES incidents interface. They are also written to the systemd journal.

The gateways are intentionally off as of 2026-07-29, so
`SIMES_FRESHNESS_ENABLED=false` is installed in `/etc/simes/monitor.env`.
When they return:

```bash
sudo sed -i 's/^SIMES_FRESHNESS_ENABLED=false$/SIMES_FRESHNESS_ENABLED=true/' /etc/simes/monitor.env
sudo systemctl start simes-ops-monitor.service
```

Self-test:

```bash
sudo simes-ops-monitor --self-test
```

## Safe deployment entry point

`/usr/local/sbin/simes-deploy` executes the reviewed repository `deploy.sh`.
The deployment script refuses ambiguous Docker daemons, dirty repositories,
missing backups, migration failures, and failed post-deployment probes.
