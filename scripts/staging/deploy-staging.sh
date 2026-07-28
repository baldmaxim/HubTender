#!/usr/bin/env bash
# HUBTender staging deploy (этап 3.2). Запускается НА staging host из корня
# репозитория, checkout строго на замороженном RC2 SHA.
#
#   bash scripts/staging/deploy-staging.sh [--skip-frontend] [--migrate]
#
# Порядок: guards → (опц.) migration one-shot → backend (immutable image) →
# frontend build из ТОГО ЖЕ SHA → публикация dist в staging-volume → health.
# Секреты — только .env.staging (вне git). Push/deploy-approvals проверяет
# оператор до запуска; скрипт проверяет изоляцию.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
. scripts/staging/lib-guards.sh

ENV_FILE="${STAGING_ENV_FILE:-.env.staging}"
[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE отсутствует (см. deploy/staging/.env.staging.example)"; exit 1; }
# Абсолютный путь: env_file в compose резолвится относительно compose-файла.
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export STAGING_ENV_FILE="$ENV_FILE"
set -a; . "$ENV_FILE"; set +a
staging_guard_env

# Freeze-проверка: HEAD может含 staging-package-коммиты поверх RC2, но
# приложение (backend/src/db/package-lock) ОБЯЗАНО быть идентично release-SHA.
EXPECTED_SHA="${STAGING_RELEASE_SHA:-0bffa67}"
HEAD_SHA="$(git rev-parse --short HEAD)"
git merge-base --is-ancestor "$EXPECTED_SHA" HEAD || {
  echo "FATAL: RC2 $EXPECTED_SHA не предок HEAD $HEAD_SHA"; exit 1; }
APP_DRIFT="$(git diff --name-only "$EXPECTED_SHA"..HEAD -- backend/ src/ db/ package.json package-lock.json index.html vite.config.ts)"
[ -z "$APP_DRIFT" ] || {
  echo "FATAL: приложение отличается от замороженного RC2 $EXPECTED_SHA:"; echo "$APP_DRIFT"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FATAL: грязное дерево"; exit 1; }

COMPOSE=(docker compose -p hubtender-staging --env-file "$ENV_FILE" -f deploy/staging/docker-compose.staging.yml)

echo "== образ: ${STAGING_IMAGE} (immutable) =="
docker image inspect "${STAGING_IMAGE}" >/dev/null 2>&1 || docker pull "${STAGING_IMAGE}"

if [ "${1:-}" = "--migrate" ] || [ "${2:-}" = "--migrate" ]; then
  echo "== migration one-shot (baseline + incrementals ×2) =="
  "${COMPOSE[@]}" up -d db
  "${COMPOSE[@]}" run --rm migrate
fi

echo "== backend =="
"${COMPOSE[@]}" up -d api

if [ "${1:-}" != "--skip-frontend" ]; then
  echo "== frontend build из RC2 SHA (VITE_API_URL=https://${STAGING_DOMAIN}) =="
  npm ci
  VITE_API_URL="https://${STAGING_DOMAIN}" VITE_API_MODE=go VITE_API_REALTIME_ENABLED=true \
    NODE_OPTIONS=--max-old-space-size=8192 npm run build
  echo "== публикация dist в staging-volume =="
  docker run --rm -v hubtender-staging_staging-dist:/dist -v "$ROOT/dist:/src:ro" \
    alpine sh -ec 'rm -rf /dist/* && cp -a /src/. /dist/'
fi

echo "== web (reverse proxy + TLS) =="
"${COMPOSE[@]}" up -d web

bash scripts/staging/health-check-staging.sh
echo "STAGING DEPLOY DONE: sha=$HEAD_SHA image=${STAGING_IMAGE}"
