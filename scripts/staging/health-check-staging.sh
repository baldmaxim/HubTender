#!/usr/bin/env bash
# Health-check staging: /health, /health/db, /health/recalc, /health/ai через
# api-контейнер (внутренняя сеть) и, при заданном STAGING_DOMAIN, через public URL.
set -euo pipefail
COMPOSE=(docker compose -p hubtender-staging -f deploy/staging/docker-compose.staging.yml)
for ep in health health/db health/recalc health/ai; do
  code=$("${COMPOSE[@]}" exec -T api wget -q -O /dev/null -S "http://127.0.0.1:3005/$ep" 2>&1 | awk '/HTTP\//{print $2; exit}') || code=ERR
  echo "internal /$ep: ${code:-ERR}"
  [ "${code:-}" = "200" ] || { echo "GATE FAILED: /$ep"; exit 1; }
done
if [ -n "${STAGING_DOMAIN:-}" ]; then
  for ep in health health/db; do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' "https://${STAGING_DOMAIN}/$ep" || echo ERR)
    echo "public /$ep: $code"
    [ "$code" = "200" ] || { echo "GATE FAILED: public /$ep"; exit 1; }
  done
fi
echo "HEALTH OK"
