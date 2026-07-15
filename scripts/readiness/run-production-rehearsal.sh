#!/usr/bin/env bash
# Этап 2.4 (§16): генеральная репетиция production deployment.
#
#   Сценарий A (по умолчанию): fresh install — baseline + incrementals (×2,
#     идемпотентность) → backend health → full test suite → readiness audit →
#     ACL verification → cleanup.
#   Сценарий B (--upgrade): upgrade rehearsal — schema из git-ревизии
#     pre-upgrade → synthetic legacy data → текущая migration chain →
#     readiness audit ОБЯЗАН выявить рискованные данные → согласованный
#     remediation ТОЛЬКО в test DB → повторное применение миграций → cleanup.
#
# Только disposable environment:
#   * случайный порт, имя контейнера/БД со словом test;
#   * production credentials НЕ читаются (никаких .env/.env.prod);
#   * cleanup trap удаляет контейнер при любом исходе;
#   * любой failed gate → non-zero exit.
#
# Запуск из корня репозитория (Git Bash / WSL / Linux):
#   bash scripts/readiness/run-production-rehearsal.sh [--upgrade] [--keep-going]

set -euo pipefail

MODE="fresh"
[[ "${1:-}" == "--upgrade" ]] && MODE="upgrade"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Случайный порт 55000-55999 + disposable-имена (обязательно *test*).
PORT=$((55000 + RANDOM % 1000))
STAMP="$(date +%s)$RANDOM"
CONTAINER="hubtender-rehearsal-test-$STAMP"
DB="hubtender_rehearsal_test"
DSN="postgres://postgres:rehearsal@localhost:$PORT/$DB?sslmode=disable"

# Guard: не трогаем production. Никакого чтения .env/.env.prod.
case "$DSN" in
  *mdb.yandexcloud.net*|*supabase*) echo "FATAL: production DSN запрещён"; exit 1;;
esac
if [[ "$DB" != *test* ]]; then echo "FATAL: имя БД обязано содержать test"; exit 1; fi

cleanup() {
  local rc=$?
  echo "== cleanup (rc=$rc) =="
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
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


psql_c() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=0 -q "$@"; }
psql_strict() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

echo "== rehearsal mode=$MODE container=$CONTAINER port=$PORT =="
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB="$DB" \
  -p "$PORT:5432" postgres:17 >/dev/null
wait_pg "$CONTAINER" "$DB" || fail "postgres not ready"

apply_schema() {
  local label="$1"
  echo "== apply schema ($label) =="
  for f in db/yandex/sql/*.sql; do psql_c -f - < "$f" >/dev/null 2>&1 || true; done
  for f in db/yandex/incremental/*.sql; do
    psql_strict -f - < "$f" >/dev/null || fail "incremental $(basename "$f") failed ($label)"
  done
}

seed_minimum() {
  psql_strict <<'SQL' >/dev/null
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
}

if [[ "$MODE" == "upgrade" ]]; then
  # ── Сценарий B: schema pre-upgrade ревизии (main) ──────────────────────────
  PREV_REF="${REHEARSAL_BASE_REF:-main}"
  echo "== upgrade: schema from $PREV_REF =="
  TMP_SCHEMA="$(mktemp -d)"
  git archive "$PREV_REF" -- db/yandex | tar -x -C "$TMP_SCHEMA" || fail "git archive $PREV_REF"
  for f in "$TMP_SCHEMA"/db/yandex/sql/*.sql; do psql_c -f - < "$f" >/dev/null 2>&1 || true; done
  for f in "$TMP_SCHEMA"/db/yandex/incremental/*.sql; do psql_c -f - < "$f" >/dev/null 2>&1 || true; done
  rm -rf "$TMP_SCHEMA"
  seed_minimum

  echo "== upgrade: synthetic legacy data (ТОЛЬКО main-era колонки) =="
  psql_strict <<'SQL' >/dev/null
-- calculated-тендер эпохи main (ревизий ещё нет: chain даст default 0/0)
INSERT INTO public.tenders (id, title, client_name, tender_number, version)
VALUES ('11111111-1111-1111-1111-111111111111', 'legacy calculated', 'test', 'LEG-1', 1);
-- approved-тендер эпохи main (financial_approved уже существует в main)
INSERT INTO public.tenders (id, title, client_name, tender_number, version, financial_approved)
VALUES ('22222222-2222-2222-2222-222222222222', 'legacy approved', 'test', 'LEG-2', 1, true);
-- тендер с КРИВЫМ total_amount (после chain станет calculated 0/0 → audit
-- обязан выявить boq_total_mismatch + legacy_zero_revision_inconsistent)
INSERT INTO public.tenders (id, title, client_name, tender_number, version)
VALUES ('33333333-3333-3333-3333-333333333333', 'legacy broken total', 'test', 'LEG-3', 1);
INSERT INTO public.client_positions (id, tender_id, position_number, work_name)
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 1, 'поз');
-- main-era CHECK: раб → work_name_id NOT NULL; мат → material_name_id NOT NULL
INSERT INTO public.work_names (id, name, unit)
VALUES ('44444444-4444-4444-4444-444444444444', 'legacy работа', 'м2');
INSERT INTO public.material_names (id, name, unit)
VALUES ('55555555-5555-5555-5555-555555555555', 'legacy материал', 'шт');
INSERT INTO public.boq_items (tender_id, client_position_id, boq_item_type, description,
    unit_code, quantity, unit_rate, currency_type, total_amount, work_name_id)
VALUES ('33333333-3333-3333-3333-333333333333', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'раб', 'legacy row', 'м2', 10, 100, 'RUB', 999999, '44444444-4444-4444-4444-444444444444');
-- работа+материал с parent (валидная связь — FK-миграция chain обязана пройти)
INSERT INTO public.boq_items (id, tender_id, client_position_id, boq_item_type, description,
    unit_code, quantity, unit_rate, currency_type, work_name_id)
VALUES ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333',
        '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'раб', 'работа', 'м2', 1, 1, 'RUB',
        '44444444-4444-4444-4444-444444444444');
INSERT INTO public.boq_items (tender_id, client_position_id, boq_item_type, material_type,
    description, unit_code, quantity, unit_rate, currency_type, parent_work_item_id, material_name_id)
VALUES ('33333333-3333-3333-3333-333333333333', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'мат', 'основн.', 'материал', 'шт', 1, 1, 'RUB', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '55555555-5555-5555-5555-555555555555');
-- старая markup-тактика без multiplyFormat (main-era)
INSERT INTO public.markup_tactics (name, sequences)
VALUES ('legacy tactic', '{"раб": [{"action1": "multiply", "operand1Type": "markup", "operand1Markup": "mp1"}]}'::jsonb);
-- старый redistribution snapshot без server_metadata (boq_item_id NOT NULL в main-схеме)
INSERT INTO public.cost_redistribution_results (tender_id, markup_tactic_id, boq_item_id, redistribution_rules)
SELECT '33333333-3333-3333-3333-333333333333', t.id, b.id, '{"rules": []}'::jsonb
FROM public.markup_tactics t, public.boq_items b
WHERE b.tender_id = '33333333-3333-3333-3333-333333333333' AND b.boq_item_type = 'раб'
LIMIT 1;
SQL

  echo "== upgrade: apply current migration chain =="
  for f in db/yandex/incremental/*.sql; do
    psql_strict -f - < "$f" >/dev/null || fail "upgrade incremental $(basename "$f") failed"
  done

  echo "== upgrade: post-chain порча (застрявший calculating между релизами) =="
  psql_strict <<'SQL' >/dev/null
-- Эмуляция инцидентов ПОСЛЕ апгрейда (колонки уже существуют):
UPDATE public.tenders
SET financial_calculation_status = 'calculating',
    financial_calculation_started_at = NOW() - interval '3 days'
WHERE id = '22222222-2222-2222-2222-222222222222';
-- approved при неактуальном расчёте
UPDATE public.tenders
SET financial_input_revision = 7, financial_calculation_revision = 2
WHERE id = '22222222-2222-2222-2222-222222222222';
SQL

  echo "== upgrade: readiness audit must FLAG risky data =="
  set +e
  DATABASE_URL="$DSN" go run -C backend ./cmd/production-readiness-audit \
    --json-out /tmp/rehearsal-upgrade-report.json >/tmp/rehearsal-upgrade-audit.txt 2>&1
  AUDIT_RC=$?
  set -e
  cat /tmp/rehearsal-upgrade-audit.txt
  [[ $AUDIT_RC -ne 0 ]] || fail "readiness audit must exit non-zero on risky legacy data"
  grep -q "stuck_calculating" /tmp/rehearsal-upgrade-audit.txt || fail "stuck calculating not flagged"
  grep -q "approved_not_current" /tmp/rehearsal-upgrade-audit.txt || fail "approved stale not flagged"

  echo "== upgrade: agreed remediation (ТОЛЬКО test DB) =="
  psql_strict <<'SQL' >/dev/null
-- Ручная согласованная remediation (документирована в PRODUCTION_READINESS.md):
-- снять невалидный approval и вернуть застрявший тендер в stale.
UPDATE public.tenders
SET financial_approved = false, financial_approved_by = NULL, financial_approved_at = NULL,
    financial_calculation_status = 'stale', financial_calculation_started_at = NULL
WHERE id = '22222222-2222-2222-2222-222222222222';
SQL

  echo "== upgrade: re-apply migrations (idempotency) =="
  for f in db/yandex/incremental/*.sql; do
    psql_strict -f - < "$f" >/dev/null || fail "re-apply $(basename "$f") failed"
  done
  echo "UPGRADE REHEARSAL PASSED"
  exit 0
fi

# ── Сценарий A: fresh install ─────────────────────────────────────────────────
apply_schema "round 1"
apply_schema "round 2 (idempotency)"
seed_minimum

echo "== backend build + health =="
( cd backend && go build ./... ) || fail "go build"

echo "== full test suite (-p 1) against rehearsal DB =="
( cd backend && HUBTENDER_TEST_DATABASE_URL="$DSN" go test -p 1 ./... -count=1 ) || fail "test suite"

echo "== readiness audit (healthy fresh DB) =="
DATABASE_URL="$DSN" go run -C backend ./cmd/production-readiness-audit \
  --json-out /tmp/rehearsal-fresh-report.json || fail "readiness audit reported blockers on fresh DB"

echo "== retired SQL objects / ACL summary =="
grep -E "\[(OK |UNK|BLK)\] acl:" /tmp/rehearsal-fresh-report.json >/dev/null 2>&1 || true

echo "== frontend production bundle (§13) =="
if [[ "${REHEARSAL_SKIP_FRONTEND:-0}" != "1" ]]; then
  NODE_OPTIONS=--max-old-space-size=8192 npm run build || fail "frontend production build"
  echo "== browser smoke against production bundle (§14) =="
  npx playwright test --config playwright.readiness.config.ts || fail "browser smoke"
else
  echo "SKIPPED by REHEARSAL_SKIP_FRONTEND=1 (отдельный gate)"
fi

echo "FRESH-INSTALL REHEARSAL PASSED"
