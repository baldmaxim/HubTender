#!/usr/bin/env bash
# Restore-test: восстановить последний staging-backup в DISPOSABLE БД
# (*_restore_test), прогнать readiness audit и базовые counts, удалить БД.
#   bash scripts/staging/restore-test-staging.sh [backup-file]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
. scripts/staging/lib-guards.sh
set -a; . "${STAGING_ENV_FILE:-.env.staging}"; set +a
staging_guard_env

OUT="${STAGING_BACKUP_DIR:-/var/backups/hubtender-staging}"
FILE="${1:-$(ls -1t "$OUT"/hubtender_staging_*.dump | head -1)}"
[ -f "$FILE" ] || { echo "FATAL: backup не найден"; exit 1; }
TESTDB="${STAGING_DB_NAME}_restore_test"
COMPOSE=(docker compose -p hubtender-staging -f deploy/staging/docker-compose.staging.yml)
PSQL=("${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db)

cleanup() { "${PSQL[@]}" psql -U "$STAGING_DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS $TESTDB" || true; }
trap cleanup EXIT

"${PSQL[@]}" psql -U "$STAGING_DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS $TESTDB"
"${PSQL[@]}" psql -U "$STAGING_DB_USER" -d postgres -qc "CREATE DATABASE $TESTDB"
"${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db \
  pg_restore -U "$STAGING_DB_USER" -d "$TESTDB" --no-owner < "$FILE"

echo "== counts (orig vs restore) =="
for t in tenders client_positions boq_items users ai_feature_settings; do
  a=$("${PSQL[@]}" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -tAc "SELECT count(*) FROM public.$t" 2>/dev/null || echo n/a)
  b=$("${PSQL[@]}" psql -U "$STAGING_DB_USER" -d "$TESTDB" -tAc "SELECT count(*) FROM public.$t" 2>/dev/null || echo n/a)
  echo "$t: $a vs $b"; [ "$a" = "$b" ] || { echo "GATE FAILED: counts diverge ($t)"; exit 1; }
done

echo "== readiness audit на restore-копии =="
RESTORE_DSN="postgres://$STAGING_DB_USER:$STAGING_DB_PASSWORD@127.0.0.1:5432/$TESTDB?sslmode=disable"
# Аудит гоняем через api-образ недоступен (distroless) — используем go run на
# операторской машине ЛИБО контейнерный psql-smoke ниже (минимум):
"${PSQL[@]}" psql -U "$STAGING_DB_USER" -d "$TESTDB" -tAc \
  "SELECT rollout_mode FROM ai_feature_settings LIMIT 1" | grep -q off \
  || { echo "GATE FAILED: rollout_mode != off в restore-копии"; exit 1; }
echo "RESTORE TEST OK: $FILE"
