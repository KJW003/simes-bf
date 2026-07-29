#!/usr/bin/env bash
# Install a key-only, read-only SFTP account for offsite backup retrieval.
set -euo pipefail
umask 077

usage() {
  echo "Usage: install-readonly-sftp.sh /path/to/backup-pull.pub"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

PUBLIC_KEY_FILE="$1"
BACKUP_USER="simes-backup"
CHROOT_DIR="/srv/simes-backup-export"
ARCHIVE_DIR="$CHROOT_DIR/archives"
SSHD_DROPIN="/etc/ssh/sshd_config.d/60-simes-backup.conf"
AUTHORIZED_KEYS_DIR="/etc/ssh/authorized_keys"
SSHD_BACKUP=""
SSHD_INSTALLED=false

[ -s "$PUBLIC_KEY_FILE" ] || {
  echo "Public key file is missing or empty: $PUBLIC_KEY_FILE" >&2
  exit 1
}

non_empty_lines=$(grep -cve '^[[:space:]]*$' "$PUBLIC_KEY_FILE")
[ "$non_empty_lines" -eq 1 ] || {
  echo "The public key file must contain exactly one key." >&2
  exit 1
}
ssh-keygen -l -f "$PUBLIC_KEY_FILE" >/dev/null

key_type=$(awk 'NR == 1 { print $1 }' "$PUBLIC_KEY_FILE")
case "$key_type" in
  ssh-ed25519|sk-ssh-ed25519@openssh.com) ;;
  *)
    echo "Only an Ed25519 public key is accepted." >&2
    exit 1
    ;;
esac

if ! getent passwd "$BACKUP_USER" >/dev/null 2>&1; then
  useradd \
    --create-home \
    --home-dir "/home/$BACKUP_USER" \
    --shell /usr/sbin/nologin \
    "$BACKUP_USER"
  random_password=$(openssl rand -base64 48)
  password_hash=$(openssl passwd -6 "$random_password")
  usermod --password "$password_hash" "$BACKUP_USER"
  unset random_password password_hash
fi

install -d -o root -g root -m 0755 "$CHROOT_DIR"
install -d -o root -g "$BACKUP_USER" -m 0750 "$ARCHIVE_DIR"
install -d -o root -g root -m 0755 "$AUTHORIZED_KEYS_DIR"

authorized_keys="$AUTHORIZED_KEYS_DIR/$BACKUP_USER"
{
  printf 'restrict '
  cat "$PUBLIC_KEY_FILE"
} > "$authorized_keys"
chown root:root "$authorized_keys"
chmod 0644 "$authorized_keys"

rollback_sshd_dropin() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$SSHD_INSTALLED" = true ]; then
    if [ -n "$SSHD_BACKUP" ] && [ -f "$SSHD_BACKUP" ]; then
      cp -- "$SSHD_BACKUP" "$SSHD_DROPIN"
      chown root:root "$SSHD_DROPIN"
      chmod 0600 "$SSHD_DROPIN"
    else
      rm -f -- "$SSHD_DROPIN"
    fi
    sshd -t >/dev/null 2>&1 || true
  fi
  if [ -n "$SSHD_BACKUP" ]; then
    rm -f -- "$SSHD_BACKUP"
  fi
  exit "$status"
}
trap rollback_sshd_dropin EXIT

if [ -f "$SSHD_DROPIN" ]; then
  SSHD_BACKUP=$(mktemp /run/simes-backup-sshd.XXXXXX)
  cp -- "$SSHD_DROPIN" "$SSHD_BACKUP"
fi

cat > "$SSHD_DROPIN" <<EOF
Match User $BACKUP_USER
    AuthenticationMethods publickey
    AuthorizedKeysFile $AUTHORIZED_KEYS_DIR/%u
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ChrootDirectory $CHROOT_DIR
    ForceCommand internal-sftp -R -d /archives
    AllowAgentForwarding no
    AllowTcpForwarding no
    PermitTunnel no
    PermitTTY no
    X11Forwarding no
EOF
chown root:root "$SSHD_DROPIN"
chmod 0600 "$SSHD_DROPIN"
SSHD_INSTALLED=true

sshd -t
systemctl reload ssh.service

trap - EXIT
if [ -n "$SSHD_BACKUP" ]; then
  rm -f -- "$SSHD_BACKUP"
fi
echo "Read-only SFTP account installed: $BACKUP_USER"
