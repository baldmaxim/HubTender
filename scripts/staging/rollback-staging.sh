#!/usr/bin/env bash
# Staging rollback drill / откат (этап 3.2, политика HUBTENDER_RC1_ROLLBACK.md).
#   bash scripts/staging/rollback-staging.sh backend <prev-image>   # если совместим с forward-схемой
#   bash scripts/staging/rollback-staging.sh frontend <dist-dir>    # предыдущий собранный dist
#   bash scripts/staging/rollback-staging.sh ai-off <admin-jwt>     # emergency off через API
# Unsafe down-миграции НЕ выполняются; retired SQL writers не возвращаются.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
. scripts/staging/lib-guards.sh
set -a; . "${STAGING_ENV_FILE:-.env.staging}"; set +a
staging_guard_env
COMPOSE=(docker compose -p hubtender-staging --env-file "${STAGING_ENV_FILE:-.env.staging}" -f deploy/staging/docker-compose.staging.yml)

case "${1:-}" in
  backend)
    PREV="${2:?prev image}"
    echo "== ВНИМАНИЕ: backend rollback безопасен только если prev-образ совместим с forward-схемой"
    echo "   (retired-tombstones уже применены → старые SQL-writer-пути дадут fail-closed ошибку)."
    STAGING_IMAGE="$PREV" "${COMPOSE[@]}" up -d api
    bash scripts/staging/health-check-staging.sh
    ;;
  frontend)
    DIST="${2:?prev dist dir}"
    docker run --rm -v hubtender-staging_staging-dist:/dist -v "$(cd "$DIST" && pwd):/src:ro" \
      alpine sh -ec 'rm -rf /dist/* && cp -a /src/. /dist/'
    echo "frontend rollback OK (совместим с forward-схемой: старый UI не знает новых endpoint'ов)"
    ;;
  ai-off)
    JWT="${2:?admin jwt}"
    "${COMPOSE[@]}" exec -T api wget -q -O- --header "Authorization: Bearer $JWT" \
      --post-data '{}' http://127.0.0.1:3005/api/v1/admin/ai/nomenclature/rollout/emergency-off
    echo; echo "emergency off отправлен; проверить rollout=off"
    ;;
  *) echo "usage: rollback-staging.sh backend|frontend|ai-off ..."; exit 2;;
esac
