#!/usr/bin/env bash
# Этап 2.4 (§14): browser smoke ПРОТИВ production bundle.
# Disposable-стек: postgres:17 (контейнер *test*) + Go backend (go run) +
# static dist server (same-origin proxy). Production credentials НЕ читаются.
#
#   bash scripts/readiness/run-browser-smoke.sh [--reuse-dist]
#
# --reuse-dist: не пересобирать dist/ (использовать существующий бандл,
#   собранный с теми же E2E-адресами).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REUSE_DIST=0
[[ "${1:-}" == "--reuse-dist" ]] && REUSE_DIST=1

PGPORT="${E2E_PG_PORT:-$((56000 + RANDOM % 1000))}"
WEBPORT="${E2E_WEB_PORT:-$((8100 + RANDOM % 800))}"
APIPORT="${E2E_API_PORT:-$((8901 + RANDOM % 90))}"
ORPORT="${E2E_OPENROUTER_PORT:-$((8391 + RANDOM % 90))}"
STAMP="$(date +%s)$RANDOM"
CONTAINER="hubtender-e2e-test-$STAMP"
DB="hubtender_e2e_test"
DSN="postgres://postgres:e2e@localhost:$PGPORT/$DB?sslmode=disable"
TMPDIR_E2E="$(mktemp -d)"
BACKEND_PID=""
WEB_PID=""
OR_PID=""

case "$DSN" in *mdb.yandexcloud.net*|*supabase*) echo "FATAL: production DSN"; exit 1;; esac

cleanup() {
  local rc=$?
  echo "== cleanup (rc=$rc) =="
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" >/dev/null 2>&1 || true
  [[ -n "$OR_PID" ]] && kill "$OR_PID" >/dev/null 2>&1 || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" >/dev/null 2>&1 || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_E2E"
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


echo "== postgres ($CONTAINER, port $PGPORT) =="
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB="$DB" \
  -p "$PGPORT:5432" postgres:17 >/dev/null
wait_pg "$CONTAINER" "$DB" || fail "postgres not ready"

psql_q() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=0 -q "$@"; }
psql_s() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

echo "== schema =="
for f in db/yandex/sql/*.sql; do psql_q -f - < "$f" >/dev/null 2>&1 || true; done
for f in db/yandex/incremental/*.sql; do psql_s -f - < "$f" >/dev/null || fail "incremental $(basename "$f")"; done

echo "== seed (пользователь + тендер + номенклатура) =="
psql_s <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO public.roles (code, name, color) VALUES
 ('administrator','Администратор','#f00'), ('general_director','Генеральный директор','#0a0')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.units (code, name) VALUES
 ('м2','кв. метр'), ('м3','куб. метр'), ('шт','штука'), ('м','метр'), ('кг','килограмм')
ON CONFLICT (code) DO NOTHING;
INSERT INTO auth.users (id, email, encrypted_password)
VALUES ('e2e00000-0000-0000-0000-000000000001', 'e2e@test.local', crypt('Test1234!', gen_salt('bf', 10)))
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, email, full_name, role_code, access_status, access_enabled, allowed_pages)
VALUES ('e2e00000-0000-0000-0000-000000000001', 'e2e@test.local', 'E2E Инженер',
        'administrator', 'approved', true, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
-- Генеральный директор — только для approve-шагов (у GD особый UI-workspace).
INSERT INTO auth.users (id, email, encrypted_password)
VALUES ('e2e00000-0000-0000-0000-000000000002', 'e2e-gd@test.local', crypt('Test1234!', gen_salt('bf', 10)))
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, email, full_name, role_code, access_status, access_enabled, allowed_pages)
VALUES ('e2e00000-0000-0000-0000-000000000002', 'e2e-gd@test.local', 'E2E Гендиректор',
        'general_director', 'approved', true, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.work_names (name, unit) VALUES ('e2e работа', 'м2') ON CONFLICT DO NOTHING;
INSERT INTO public.material_names (name, unit) VALUES ('e2e материал', 'шт') ON CONFLICT DO NOTHING;
INSERT INTO public.tenders (id, title, client_name, tender_number, version,
    usd_rate, eur_rate, cny_rate, financial_calculation_status)
VALUES ('e2e00000-0000-0000-0000-0000000000e2', 'E2E Тендер', 'ООО Тест', 'E2E-1', 1,
        90, 100, 12, 'calculated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.client_positions (tender_id, position_number, work_name)
SELECT id, 1, 'Позиция 1' FROM public.tenders WHERE title = 'E2E Тендер'
ON CONFLICT DO NOTHING;
SQL

echo "== app JWT ключ (ephemeral) =="
openssl genrsa -out "$TMPDIR_E2E/jwt.pem" 2048 >/dev/null 2>&1

echo "== fake OpenRouter (port $ORPORT) — этап 2.5, реальный API не используется =="
node scripts/readiness/fake-openrouter-server.mjs "$ORPORT" > "$TMPDIR_E2E/openrouter.log" 2>&1 &
OR_PID=$!
sleep 1
curl -fsS "http://127.0.0.1:$ORPORT/__stats" >/dev/null || fail "fake openrouter"

echo "== backend (port $APIPORT, recovery scan 3s) =="
(
  cd backend
  DATABASE_URL="$DSN" \
  PORT="$APIPORT" BIND_HOST=127.0.0.1 \
  APP_JWT_ISSUER=hubtender-e2e APP_JWT_AUDIENCE=hubtender-app \
  APP_JWT_KEY_ID=e2e APP_JWT_PRIVATE_KEY_PATH="$TMPDIR_E2E/jwt.pem" \
  CORS_ORIGINS="http://127.0.0.1:$WEBPORT" \
  RECALC_RECOVERY_SCAN_INTERVAL=3s RECALC_RECOVERY_CALCULATING_TIMEOUT=30s \
  OPENROUTER_API_KEY="sk-or-e2e-fake-not-a-real-key" \
  OPENROUTER_API_BASE="http://127.0.0.1:$ORPORT" \
  APP_ENV=development \
  LOG_LEVEL=warn \
  go run ./cmd/server > "$TMPDIR_E2E/backend.log" 2>&1
) &
BACKEND_PID=$!
for i in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$APIPORT/health" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS "http://127.0.0.1:$APIPORT/health/db" >/dev/null || { cat "$TMPDIR_E2E/backend.log"; fail "backend not healthy"; }

echo "== production bundle (VITE_API_URL=same-origin proxy) =="
if [[ "$REUSE_DIST" != "1" ]]; then
  VITE_API_URL="http://127.0.0.1:$WEBPORT" VITE_API_MODE=go VITE_REALTIME_ENABLED=true \
  NODE_OPTIONS=--max-old-space-size=8192 npm run build || fail "production build"
fi
node scripts/readiness/gen-e2e-xlsx.mjs

echo "== static server (port $WEBPORT → api $APIPORT) =="
node scripts/readiness/e2e-static-server.mjs "$WEBPORT" "$APIPORT" > "$TMPDIR_E2E/web.log" 2>&1 &
WEB_PID=$!
sleep 1
curl -fsS "http://127.0.0.1:$WEBPORT/" >/dev/null || fail "static server"

echo "== bundle secret check (§28): OPENROUTER-ключ не должен попасть в dist =="
# ИМЯ переменной в UI-подсказке («задаётся как server secret …») легально и
# требуется заданием §18.A; ищем ЗНАЧЕНИЕ ключа и VITE-инлайн.
if grep -RIl "sk-or-e2e-fake-not-a-real-key\|VITE_OPENROUTER" dist/assets >/dev/null 2>&1; then
  fail "OPENROUTER secret leaked into production bundle"
fi

echo "== playwright smoke =="
E2E_BASE_URL="http://127.0.0.1:$WEBPORT" \
E2E_PG_CONTAINER="$CONTAINER" \
E2E_OPENROUTER_STATS="http://127.0.0.1:$ORPORT/__stats" \
npx playwright test --config playwright.readiness.config.ts || {
  echo "== backend.log (tail) =="; tail -50 "$TMPDIR_E2E/backend.log"
  fail "browser smoke"
}

echo "BROWSER SMOKE PASSED"
