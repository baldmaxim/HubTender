#!/usr/bin/env bash
# Полное удаление staging-стека (контейнеры/сеть; volumes — только с --volumes).
#   bash scripts/staging/cleanup-staging.sh [--volumes]
# Затрагивает ТОЛЬКО compose-проект hubtender-staging; production не трогается.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
COMPOSE=(docker compose -p hubtender-staging -f deploy/staging/docker-compose.staging.yml)
if [ "${1:-}" = "--volumes" ]; then
  echo "== down + volumes (БД staging будет удалена; backup обязателен) =="
  "${COMPOSE[@]}" down --volumes --remove-orphans
else
  "${COMPOSE[@]}" down --remove-orphans
fi
echo "CLEANUP DONE (project hubtender-staging)"
