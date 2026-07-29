#!/usr/bin/env bash
# Idempotently install the versioned SIMES production operations scripts.
set -euo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

for file in \
  "$REPO_DIR/deploy.sh" \
  "$SCRIPT_DIR/backup/simes-backup.sh" \
  "$SCRIPT_DIR/backup/simes-backup.service" \
  "$SCRIPT_DIR/backup/simes-backup.timer" \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.sh" \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.service" \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.timer" \
  "$SCRIPT_DIR/deploy/simes-deploy" \
  "$SCRIPT_DIR/offsite/install-readonly-sftp.sh"; do
  [ -f "$file" ] || {
    echo "Required operations file is missing: $file" >&2
    exit 1
  }
done

install -d -m 0700 /etc/simes /var/lib/simes-ops
install -d -m 0700 /var/backups/simes/daily
install -d -m 0755 /srv/simes-backup-export
install -d -m 0750 /srv/simes-backup-export/archives

install -o root -g root -m 0750 \
  "$SCRIPT_DIR/backup/simes-backup.sh" \
  /usr/local/sbin/simes-backup
install -o root -g root -m 0750 \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.sh" \
  /usr/local/sbin/simes-ops-monitor
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/deploy/simes-deploy" \
  /usr/local/sbin/simes-deploy
install -o root -g root -m 0750 \
  "$SCRIPT_DIR/offsite/install-readonly-sftp.sh" \
  /usr/local/sbin/simes-install-backup-sftp

install -o root -g root -m 0644 \
  "$SCRIPT_DIR/backup/simes-backup.service" \
  /etc/systemd/system/simes-backup.service
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/backup/simes-backup.timer" \
  /etc/systemd/system/simes-backup.timer
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.service" \
  /etc/systemd/system/simes-ops-monitor.service
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/monitoring/simes-ops-monitor.timer" \
  /etc/systemd/system/simes-ops-monitor.timer

if [ ! -e /etc/simes/backup.env ]; then
  install -o root -g root -m 0600 \
    "$SCRIPT_DIR/backup/backup.env.example" \
    /etc/simes/backup.env
fi
if [ ! -e /etc/simes/monitor.env ]; then
  install -o root -g root -m 0600 \
    "$SCRIPT_DIR/monitoring/monitor.env.example" \
    /etc/simes/monitor.env
fi

systemd-analyze verify \
  /etc/systemd/system/simes-backup.service \
  /etc/systemd/system/simes-backup.timer \
  /etc/systemd/system/simes-ops-monitor.service \
  /etc/systemd/system/simes-ops-monitor.timer

systemctl daemon-reload

echo "SIMES operations scripts installed."
echo "The timers are not enabled by this installer."
echo "Install /etc/simes/backup-recipient.crt, run both checks, then enable the timers explicitly."
