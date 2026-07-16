#!/usr/bin/env bash
# Этап 2.4 (§15): РЕАЛЬНЫЙ go test -race в изолированном Linux/CGO окружении.
# На host ничего не устанавливается: ephemeral golang-контейнер (версия из
# go.mod) + ephemeral postgres:17 в общей docker-сети.
#
#   bash scripts/readiness/run-race-detector.sh
#
# Прогоны:
#   1) ПОЛНЫЙ unit/package race suite: CGO_ENABLED=1 go test -race -p 1 ./...
#      (integration-тесты без DSN самоскипаются — это unit-слой);
#   2) TARGETED DB concurrency race suite: те же -race для наиболее
#      конкурентных пакетов с живой БД (recalc queue/recovery, financial
#      revisions, cache, import, read-only analytics).

set -euo pipefail
# Git Bash (MSYS) конвертирует /src в C:/Program Files/Git/src — отключаем.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

STAMP="$(date +%s)$RANDOM"
NET="hubtender-race-test-net-$STAMP"
PG="hubtender-race-test-pg-$STAMP"
DB="hubtender_race_test"
GO_IMAGE="golang:1.23"

cleanup() {
  local rc=$?
  echo "== cleanup (rc=$rc) =="
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit $rc
}
trap cleanup EXIT INT TERM
fail() { echo "GATE FAILED: $*" >&2; exit 1; }

# postgres в docker перезапускается после initdb: pg_isready ловит ЛОЖНОЕ окно
# готовности. Ждём ДВА последовательных успешных SELECT 1 с паузой 1s.
wait_pg() {
  local container="$1" db="$2" ok=0 i
  for i in $(seq 1 90); do
    if docker exec "$container" psql -U postgres -d "$db" -tAc 'SELECT 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [[ $ok -ge 2 ]] && return 0
    else
      ok=0
    fi
    sleep 1
  done
  return 1
}


docker network create "$NET" >/dev/null

echo "== postgres ($PG) =="
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD=race -e POSTGRES_DB="$DB" postgres:17 >/dev/null
wait_pg "$PG" "$DB" || fail "postgres not ready"

echo "== schema =="
for f in db/yandex/sql/*.sql; do
  docker exec -i "$PG" psql -U postgres -d "$DB" -q -f - < "$f" >/dev/null 2>&1 || true
done
for f in db/yandex/incremental/*.sql; do
  docker exec -i "$PG" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f - < "$f" >/dev/null \
    || fail "incremental $(basename "$f")"
done
docker exec -i "$PG" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
INSERT INTO public.roles (code, name, color) VALUES ('administrator','Администратор','#f00')
ON CONFLICT (code) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000000','itest@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, email, full_name, role_code, access_enabled)
VALUES ('00000000-0000-0000-0000-000000000000','itest@example.com','Itest Actor','administrator', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.units (code, name) VALUES
 ('м2','кв. метр'), ('м3','куб. метр'), ('шт','штука'), ('т','тонна'),
 ('м','метр'), ('кг','килограмм'), ('компл','комплект')
ON CONFLICT (code) DO NOTHING;
SQL

RACE_DSN="postgres://postgres:race@$PG:5432/$DB?sslmode=disable"

echo "== pass 1: FULL unit/package race suite (CGO_ENABLED=1 go test -race -p 1 ./...) =="
docker run --rm --network "$NET" \
  -v "$ROOT/backend:/src" -w /src \
  -e CGO_ENABLED=1 -e GOFLAGS=-buildvcs=false \
  "$GO_IMAGE" go test -race -p 1 -count=1 ./... \
  || fail "full unit race suite"

echo "== pass 2: TARGETED DB concurrency race suite =="
docker run --rm --network "$NET" \
  -v "$ROOT/backend:/src" -w /src \
  -e CGO_ENABLED=1 -e GOFLAGS=-buildvcs=false \
  -e HUBTENDER_TEST_DATABASE_URL="$RACE_DSN" \
  "$GO_IMAGE" go test -race -p 1 -count=1 \
    -run 'RecalcRecoveryIntegration|BoqPatchIntegration|BoqRelationIntegrity|ReadinessIntegration|Revision|SmartImportIntegration|ImportMemoryIntegration|AiSettingsIntegration' \
    ./internal/repository/ ./internal/services/ ./internal/cache/ \
  || fail "targeted DB race suite"

echo "RACE DETECTOR PASSED (full unit + targeted DB)"
