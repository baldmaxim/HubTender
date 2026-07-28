#!/usr/bin/env bash
# Этап 3.1 (§15): эквивалентность конечной схемы двух путей.
#   A. fresh:   текущий baseline (db/yandex/sql) + все incrementals;
#   B. upgrade: baseline+incrementals ревизии REHEARSAL_BASE_REF (default main)
#               + текущая incremental-цепочка.
# Schema-only dump обоих путей нормализуется и сравнивается.
# Только disposable environment (контейнер *test*, случайный порт, cleanup trap).
#
#   bash scripts/readiness/schema-equivalence.sh [out-dir]

set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT="${1:-artifacts/release}"
mkdir -p "$OUT"

PORT=$((57000 + RANDOM % 1000))
STAMP="$(date +%s)$RANDOM"
CONTAINER="hubtender-schemaeq-test-$STAMP"
PREV_REF="${REHEARSAL_BASE_REF:-main}"

cleanup() { local rc=$?; echo "== cleanup (rc=$rc) =="; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; exit $rc; }
trap cleanup EXIT INT TERM
fail() { echo "GATE FAILED: $*" >&2; exit 1; }

wait_pg() {
  local ok=0 i
  for i in $(seq 1 90); do
    if docker exec "$CONTAINER" psql -U postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [[ $ok -ge 2 ]] && return 0
    else ok=0; fi
    sleep 1
  done
  return 1
}

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=schemaeq -p "$PORT:5432" postgres:17 >/dev/null
wait_pg || fail "postgres not ready"

psql_db() { # db, [--strict]
  local db="$1" mode="${2:-}"
  if [[ "$mode" == "--strict" ]]; then
    docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f -
  else
    docker exec -i "$CONTAINER" psql -U postgres -d "$db" -q -f - >/dev/null 2>&1 || true
  fi
}

docker exec "$CONTAINER" psql -U postgres -c 'CREATE DATABASE schema_fresh_test' >/dev/null
docker exec "$CONTAINER" psql -U postgres -c 'CREATE DATABASE schema_upgrade_test' >/dev/null

echo "== path A: fresh baseline + incrementals =="
for f in db/yandex/sql/*.sql; do psql_db schema_fresh_test < "$f"; done
for f in db/yandex/incremental/*.sql; do
  psql_db schema_fresh_test --strict < "$f" >/dev/null || fail "fresh incremental $(basename "$f")"
done

echo "== path B: $PREV_REF schema + current incrementals =="
TMP_SCHEMA="$(mktemp -d)"
git archive "$PREV_REF" -- db/yandex | tar -x -C "$TMP_SCHEMA" || fail "git archive $PREV_REF"
for f in "$TMP_SCHEMA"/db/yandex/sql/*.sql; do psql_db schema_upgrade_test < "$f"; done
for f in "$TMP_SCHEMA"/db/yandex/incremental/*.sql; do psql_db schema_upgrade_test < "$f"; done
rm -rf "$TMP_SCHEMA"
for f in db/yandex/incremental/*.sql; do
  psql_db schema_upgrade_test --strict < "$f" >/dev/null || fail "upgrade incremental $(basename "$f")"
done

echo "== schema-only dumps + normalize =="
dump() { # db out
  docker exec "$CONTAINER" pg_dump -U postgres -d "$1" --schema-only --no-owner --no-privileges \
    | sed -e '/^--/d' -e '/^$/d' -e '/^SET /d' -e '/^SELECT pg_catalog.set_config/d' \
          -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    > "$2"
}
dump schema_fresh_test "$OUT/schema-fresh.sql"
dump schema_upgrade_test "$OUT/schema-upgrade.sql"

# Нормализация: порядок колонок upgrade-пути отличается (ALTER добавляет в
# конец) — это эквивалентная схема. Убираем хвостовые запятые (последняя
# колонка CREATE TABLE не имеет запятой → артефакт порядка) и сортируем строки.
sed 's/,$//' "$OUT/schema-fresh.sql"   | sort > "$OUT/schema-fresh.norm.sql"
sed 's/,$//' "$OUT/schema-upgrade.sql" | sort > "$OUT/schema-upgrade.norm.sql"

if diff -u "$OUT/schema-fresh.norm.sql" "$OUT/schema-upgrade.norm.sql" > "$OUT/schema-equivalence.diff"; then
  echo "SCHEMA EQUIVALENCE: PASS"
else
  echo "SCHEMA EQUIVALENCE: FAIL (см. $OUT/schema-equivalence.diff)"
  head -60 "$OUT/schema-equivalence.diff"
  fail "schema divergence"
fi
