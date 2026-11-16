#!/usr/bin/env bash
# Day-to-day control of a production ZapLink server.
#
#   deploy/zaplink.sh start      build if needed and start everything
#   deploy/zaplink.sh stop       stop everything (data is kept)
#   deploy/zaplink.sh restart    restart the API only
#   deploy/zaplink.sh update     pull the latest code, rebuild, restart (backs up first)
#   deploy/zaplink.sh status     containers, health and disk use
#   deploy/zaplink.sh logs       follow the API logs
#   deploy/zaplink.sh key        print the first admin API key
#   deploy/zaplink.sh backup     database dump + data volume into $BACKUP_DIR
#   deploy/zaplink.sh restore F  restore a backup made by "backup" (asks first)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -f .env ] || { echo "No .env in $ROOT. Run deploy/install.sh first." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB_USER="${DATABASE_USERNAME:-zaplink}"
DB_NAME="${DATABASE_NAME:-zaplink}"

dc() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

wait_healthy() {
  echo -n "Waiting for the API to become healthy"
  for _ in $(seq 1 90); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' zaplink-api 2>/dev/null)" = healthy ]; then
      echo " ok"
      return 0
    fi
    echo -n "."
    sleep 2
  done
  echo
  echo "The API did not become healthy. Look at: deploy/zaplink.sh logs" >&2
  return 1
}

backup() {
  mkdir -p "$BACKUP_DIR"
  local stamp out tmp
  stamp="$(date +%Y%m%d-%H%M%S)"
  out="$BACKUP_DIR/zaplink-$stamp.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  echo "Dumping the database..."
  docker exec zaplink-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc >"$tmp/database.dump"
  echo "Copying the data volume (WhatsApp logins, media, settings)..."
  docker run --rm -v zaplink_zaplink-data:/data:ro -v "$tmp":/out alpine \
    tar -czf /out/data.tar.gz -C /data .
  tar -czf "$out" -C "$tmp" database.dump data.tar.gz
  chmod 600 "$out"
  find "$BACKUP_DIR" -name 'zaplink-*.tar.gz' -mtime +"$BACKUP_KEEP_DAYS" -delete
  echo "Backup written: $out ($(du -h "$out" | cut -f1))"
}

restore() {
  local file="${1:-}"
  [ -f "$file" ] || { echo "Usage: deploy/zaplink.sh restore <backup .tar.gz>" >&2; exit 1; }
  echo "This REPLACES the current database and data volume with $file."
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = RESTORE ] || { echo "Cancelled."; exit 1; }

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  tar -xzf "$file" -C "$tmp"

  dc stop zaplink-api
  echo "Restoring the database..."
  docker exec -i zaplink-postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner \
    <"$tmp/database.dump"
  echo "Restoring the data volume..."
  docker run --rm -v zaplink_zaplink-data:/data -v "$tmp":/in:ro alpine \
    sh -c 'find /data -mindepth 1 -delete && tar -xzf /in/data.tar.gz -C /data'
  dc start zaplink-api
  wait_healthy
}

case "${1:-}" in
  start)
    dc up -d --build
    wait_healthy
    echo "ZapLink is running at https://${ZAPLINK_DOMAIN}"
    ;;
  stop) dc down ;;
  restart)
    dc restart zaplink-api
    wait_healthy
    ;;
  update)
    backup
    git pull --ff-only
    dc up -d --build
    wait_healthy
    docker image prune -f >/dev/null
    ;;
  status)
    dc ps
    echo
    curl -fsS "https://${ZAPLINK_DOMAIN}/api/health" && echo || echo "Health check over HTTPS failed."
    echo
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
      zaplink-api zaplink-postgres zaplink-redis zaplink-caddy
    echo
    df -h / | tail -1
    ;;
  logs) dc logs -f --tail 200 zaplink-api ;;
  key) docker exec zaplink-api cat /app/data/.api-key ;;
  backup) backup ;;
  restore) restore "${2:-}" ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
