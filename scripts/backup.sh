#!/usr/bin/env bash
# backup.sh — sauvegarde PostgreSQL StockMan avec rétention glissante.
#
# Usage :
#   ./scripts/backup.sh                      # utilise DATABASE_URL ou les défauts
#   BACKUP_DIR=/backups RETENTION_DAYS=14 ./scripts/backup.sh
#
# Prérequis : pg_dump ≥ 14 dans le PATH (docker : pg_dump du conteneur db).
# Cron quotidien suggéré :  30 3 * * * /opt/stockman/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/stockman-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

# pg_dump accepte une URL directement ; sinon variables PG* classiques.
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$OUT" "$DATABASE_URL"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx stockman-db; then
  docker exec stockman-db pg_dump -U stockman -d stockman --format=custom --compress=6 --no-owner --no-privileges > "$OUT"
else
  PGUSER="${PGUSER:-stockman}" PGPASSWORD="${PGPASSWORD:-stockman}" PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" \
    pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$OUT" "${PGDATABASE:-stockman}"
fi

# Rétention glissante
find "$BACKUP_DIR" -maxdepth 1 -name 'stockman-*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "✔ Sauvegarde créée : $OUT ($(du -h "$OUT" | cut -f1))"
echo "ℹ Restauration : pg_restore --clean -d \"\$DATABASE_URL\" \"$OUT\""
