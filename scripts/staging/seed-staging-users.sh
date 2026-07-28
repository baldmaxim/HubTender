#!/usr/bin/env bash
# Идемпотентный seed staging-пользователей (admin/regular/pilot) + синтетический
# тендер. Пароли — только из env (.env.staging), не логируются.
# Хэш — bcrypt (backend/internal/auth/password.go), генерируется
# `caddy hash-password` (bcrypt $2a/$2b), без новых зависимостей.
#
#   bash scripts/staging/seed-staging-users.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
. scripts/staging/lib-guards.sh
set -a; . "${STAGING_ENV_FILE:-.env.staging}"; set +a
staging_guard_env
[ "${APP_ENV:-}" = "staging" ] || { echo "FATAL: APP_ENV != staging"; exit 1; }

COMPOSE=(docker compose -p hubtender-staging -f deploy/staging/docker-compose.staging.yml)
PSQL=("${COMPOSE[@]}" exec -T -e PGPASSWORD="$STAGING_DB_PASSWORD" db \
  psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1 -qtA)

bhash() { docker run --rm caddy:2 caddy hash-password --plaintext "$1"; }
uid_for() { # детерминированный uuid из email (идемпотентность)
  printf '%s' "staging-user:$1" | sha1sum | cut -c1-32 \
    | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/'
}

seed_user() { # email password role name
  local email="$1" pw="$2" role="$3" name="$4" id hash
  id="$(uid_for "$email")"; hash="$(bhash "$pw")"
  "${PSQL[@]}" -c "INSERT INTO auth.users (id, email) VALUES ('$id','$email') ON CONFLICT (id) DO NOTHING" >/dev/null
  "${PSQL[@]}" -c "INSERT INTO public.users (id, email, full_name, role_code, access_enabled, password_hash)
    VALUES ('$id','$email','$name','$role', true, '$hash')
    ON CONFLICT (id) DO UPDATE SET role_code=EXCLUDED.role_code, access_enabled=true,
      password_hash=EXCLUDED.password_hash" >/dev/null
  echo "seed user ok: $email ($role)"
}

seed_user "${STAGING_ADMIN_EMAIL:?}"   "${STAGING_ADMIN_PASSWORD:?}"   administrator "Staging Admin"
seed_user "${STAGING_REGULAR_EMAIL:?}" "${STAGING_REGULAR_PASSWORD:?}" engineer      "Staging User"
seed_user "${STAGING_PILOT_EMAIL:?}"   "${STAGING_PILOT_PASSWORD:?}"   engineer      "Staging Pilot"

# Синтетический тендер (без production-имён/номеров/цен/URL).
"${PSQL[@]}" -c "INSERT INTO public.tenders (id, title, client_name, usd_rate, eur_rate)
  SELECT gen_random_uuid(), 'STAGING-SYNTH-001', 'Synthetic Client', 90, 100
  WHERE NOT EXISTS (SELECT 1 FROM public.tenders WHERE title='STAGING-SYNTH-001')" >/dev/null
echo "seed tender ok: STAGING-SYNTH-001"
echo "SEED DONE (idempotent)"
