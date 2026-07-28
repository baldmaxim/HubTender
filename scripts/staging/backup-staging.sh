#!/usr/bin/env bash
# Backup staging DB (pg_dump custom format) + SHA-256 + метаданные.
#   bash scripts/staging/backup-staging.sh [outdir=/var/backups/hubtender-staging]
# Backup НЕ коммитится и не кладётся в публичные пути. Retention: 7 последних
# (старшие удаляются). Валидным считается только после restore-test.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
. scripts/staging/lib-guards.sh
set -a; . "${STAGING_ENV_FILE:-.env.staging}"; set +a
staging_guard_env

OUT="${1:-/var/backups/hubtender-staging}"; mkdir -p "$OUT"; chmod 700 "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/hubtender_staging_$STAMP.dump"
COMPOSE=(docker compose -p hubtender-staging -f deploy/staging/docker-compose.staging.yml)

"${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db \
  pg_dump -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -Fc > "$FILE"
SHA=$(sha256sum "$FILE" | cut -d' ' -f1)
SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
SCHEMA_N=$("${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db \
  psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "$STAMP sha256=$SHA size=$SIZE tables=$SCHEMA_N file=$FILE" | tee -a "$OUT/backups.log"
ls -1t "$OUT"/hubtender_staging_*.dump | tail -n +8 | xargs -r rm -f
echo "BACKUP OK: $FILE (валиден только после restore-test-staging.sh)"
