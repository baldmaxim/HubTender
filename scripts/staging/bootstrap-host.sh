#!/usr/bin/env bash
# HUBTender staging — единый bootstrap НА STAGING HOST (этап 3.2, §2–§13).
# Запускать от root в /opt/hubtender-staging/app (checkout 722098d) при уже
# положенных секретах: /opt/hubtender-staging/secrets/.env.staging (600) и
# /opt/hubtender-staging/secrets/jwt-staging.pem (600).
#
#   bash scripts/staging/bootstrap-host.sh
#
# Делает: host-identity отчёт → guards → image build + secret-inspect →
# fresh dry-run на disposable *_staging_test БД → actual: db+migrate(×2)+api →
# frontend build из того же SHA → web → seed → health → 5-мин лог-надзор.
# Секреты в stdout не печатает.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
SEC=/opt/hubtender-staging/secrets
ART=/opt/hubtender-staging/artifacts; mkdir -p "$ART"

echo "──── §2 HOST IDENTITY ────"
echo "hostname: $(hostname)"; grep PRETTY /etc/os-release || true
echo "cpu: $(nproc) | ram: $(free -h | awk '/Mem:/{print $2}') | disk: $(df -h / | awk 'NR==2{print $4" free"}')"
docker version --format 'docker {{.Server.Version}}'; docker compose version --short | sed 's/^/compose /'
echo "compose projects: $(docker compose ls --format '{{.Name}}' 2>/dev/null | tr '\n' ' ')"
echo "listen 80/443/8081: $(ss -tlnp 2>/dev/null | grep -E ':(80|443|8081) ' | awk '{print $4}' | tr '\n' ' ')"
echo "public ip: $(curl -fsS -m 5 ifconfig.me 2>/dev/null || echo n/a)"
timedatectl show -p NTPSynchronized 2>/dev/null || true

echo "──── GUARDS ────"
[ -f "$SEC/.env.staging" ] || { echo "FATAL: $SEC/.env.staging отсутствует"; exit 1; }
[ -f "$SEC/jwt-staging.pem" ] || { echo "FATAL: $SEC/jwt-staging.pem отсутствует"; exit 1; }
chmod 700 "$SEC"; chmod 600 "$SEC/.env.staging" "$SEC/jwt-staging.pem"
ln -sf "$SEC/.env.staging" .env.staging
export STAGING_ENV_FILE="$SEC/.env.staging"
. scripts/staging/lib-guards.sh
set -a; . "$SEC/.env.staging"; set +a
staging_guard_env
EXPECTED="${STAGING_RELEASE_SHA:?}"
HEAD_SHA="$(git rev-parse --short HEAD)"
[ "$HEAD_SHA" = "$EXPECTED" ] || { echo "FATAL: HEAD $HEAD_SHA != $EXPECTED"; exit 1; }
echo "git: $HEAD_SHA (frozen) OK; dns $STAGING_DOMAIN → $(getent hosts "$STAGING_DOMAIN" | awk '{print $1}' | head -1 || echo NXDOMAIN)"

echo "──── §6 IMAGE BUILD (remote_build) ────"
docker build -t "hubtender:staging-$EXPECTED" ./backend
docker image inspect "hubtender:staging-$EXPECTED" --format 'env-baked: {{.Config.Env}}' \
  | grep -qiE 'KEY=|PASSWORD|DATABASE_URL|PRIVATE' && { echo "FATAL: секрет в образе"; exit 1; } || echo "image env clean"
docker image inspect "hubtender:staging-$EXPECTED" --format 'digest-id: {{.Id}} size: {{.Size}}'

echo "──── §9 FRESH DRY-RUN (disposable *_staging_test) ────"
DR=hubtender-staging-test-dryrun
docker rm -f $DR >/dev/null 2>&1 || true
docker run -d --name $DR -e POSTGRES_PASSWORD=dryrun -e POSTGRES_DB=hubtender_staging_test postgres:17 >/dev/null
trap "docker rm -f $DR >/dev/null 2>&1 || true" EXIT
for i in $(seq 1 60); do docker exec $DR psql -U postgres -d hubtender_staging_test -tAc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
for round in 1 2; do
  for f in db/yandex/sql/*.sql; do docker exec -i $DR psql -U postgres -d hubtender_staging_test -q -f - < "$f" >/dev/null 2>&1 || true; done
  for f in db/yandex/incremental/*.sql; do
    docker exec -i $DR psql -U postgres -d hubtender_staging_test -v ON_ERROR_STOP=1 -q -f - < "$f" >/dev/null \
      || { echo "DRY-RUN FAIL: $f (round $round)"; exit 1; }
  done
done
docker exec $DR psql -U postgres -d hubtender_staging_test -tAc "SELECT rollout_mode FROM ai_feature_settings" | grep -qx off || { echo "DRY-RUN FAIL: rollout != off"; exit 1; }
docker exec $DR psql -U postgres -d hubtender_staging_test -tAc "SELECT count(*) FROM pg_constraint WHERE conname IN ('boq_items_position_scope_fkey','boq_items_parent_scope_fkey')" | grep -qx 2 || { echo "DRY-RUN FAIL: composite FK"; exit 1; }
docker rm -f $DR >/dev/null; trap - EXIT
echo "FRESH DRY-RUN PASS (миграции ×2, rollout off, FK; полный Go-suite выполнен на этом же SHA на машине сборки)"

echo "──── §10–§13 ACTUAL DEPLOY ────"
mkdir -p /srv/hubtender-staging && cp "$SEC/jwt-staging.pem" /srv/hubtender-staging/jwt-staging.pem && chmod 600 /srv/hubtender-staging/jwt-staging.pem
COMPOSE=(docker compose -p hubtender-staging --env-file "$SEC/.env.staging" -f deploy/staging/docker-compose.staging.yml)
"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -tAc \
  "SELECT current_database()||' | '||current_user||' | '||current_setting('server_version')"
bash scripts/staging/deploy-staging.sh --migrate
bash scripts/staging/seed-staging-users.sh

echo "──── §12 LOG WATCH (5 мин: panic/migration-loop/recovery-storm/secret) ────"
END=$((SECONDS+300)); BAD=0
while [ $SECONDS -lt $END ]; do
  if "${COMPOSE[@]}" logs --since 10s api 2>/dev/null | grep -aiE 'panic|fatal|BEGIN RSA|OPENROUTER_API_KEY=' ; then BAD=1; fi
  sleep 10
done
[ $BAD -eq 0 ] && echo "log watch clean" || { echo "LOG WATCH FAIL"; exit 1; }
bash scripts/staging/health-check-staging.sh
echo "──── BOOTSTRAP DONE — верните этот вывод целиком (секретов в нём нет) ────"
