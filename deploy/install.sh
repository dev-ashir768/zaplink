#!/usr/bin/env bash
# One-time setup of ZapLink on a fresh Ubuntu 22.04/24.04 (or Debian 12) VPS. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/dev-ashir768/zaplink/main/deploy/install.sh -o install.sh
#   sudo bash install.sh wa.yourcompany.com admin@yourcompany.com
#
# It installs Docker, opens only SSH/HTTP/HTTPS in the firewall, adds swap, puts the code in
# /opt/zaplink, writes .env with random passwords, starts ZapLink and schedules a nightly backup.
# Running it again is safe: an existing .env and its passwords are kept.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${ZAPLINK_REPO:-https://github.com/dev-ashir768/zaplink.git}"
DIR="${ZAPLINK_DIR:-/opt/zaplink}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash install.sh ...)" >&2; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || {
  echo "Usage: sudo bash install.sh <domain> <email>   e.g. wa.yourcompany.com admin@yourcompany.com" >&2
  exit 1
}

step() { echo; echo "==> $*"; }

step "System packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git ufw openssl >/dev/null

if ! command -v docker >/dev/null; then
  step "Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

step "Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

if ! swapon --show | grep -q .; then
  step "4 GB swap"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

step "Code in $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  step "Writing .env with new random passwords"
  cp deploy/.env.production.example .env
  sed -i "s|^ZAPLINK_DOMAIN=.*|ZAPLINK_DOMAIN=$DOMAIN|" .env
  sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=$EMAIL|" .env
  sed -i "s|^DATABASE_PASSWORD=.*|DATABASE_PASSWORD=$(openssl rand -hex 24)|" .env
  sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 24)|" .env
  chmod 600 .env
else
  echo "Keeping the existing .env"
fi

step "Checking DNS for $DOMAIN"
SERVER_IP="$(curl -fsS https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "$DNS_IP" ]; then
  echo "WARNING: $DOMAIN points to '${DNS_IP:-nothing}', this server is $SERVER_IP."
  echo "         HTTPS will only work once the A record points here."
fi

step "Starting ZapLink (the first build takes a few minutes)"
chmod +x deploy/zaplink.sh
deploy/zaplink.sh start

step "Nightly backup at 02:30"
cat >/etc/cron.d/zaplink-backup <<EOF
30 2 * * * root $DIR/deploy/zaplink.sh backup >>/var/log/zaplink-backup.log 2>&1
EOF

echo
echo "Done. Open https://$DOMAIN and log in with the admin key:"
echo "  $DIR/deploy/zaplink.sh key"
