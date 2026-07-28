#!/usr/bin/env bash
# Общие guard-функции staging-скриптов (этап 3.2). Source, не запускать.

staging_guard_env() {
  : "${STAGING_DB_NAME:?STAGING_DB_NAME обязателен}"
  case "$STAGING_DB_NAME" in
    *staging*) ;;
    *) echo "FATAL: STAGING_DB_NAME='$STAGING_DB_NAME' не содержит 'staging'"; exit 1;;
  esac
  local dsn="${DATABASE_URL:-}"
  case "$dsn" in
    *mdb.yandexcloud.net*|*supabase*)
      echo "FATAL: DATABASE_URL указывает на production/облачный кластер — staging-скриптам запрещено"; exit 1;;
  esac
  if [ "${APP_ENV:-}" != "staging" ] && [ -n "${APP_ENV:-}" ]; then
    echo "FATAL: APP_ENV='${APP_ENV}' != staging"; exit 1
  fi
}

staging_confirm_db_identity() { # host port user db  (пароль в PGPASSWORD)
  local h="$1" p="$2" u="$3" d="$4" out
  out=$(psql -h "$h" -p "$p" -U "$u" -d "$d" -tAc \
    "SELECT current_database()||'|'||current_user||'|'||current_setting('server_version')" ) || {
    echo "FATAL: staging DB недоступна"; exit 1; }
  echo "DB identity: $out"
  case "$out" in
    *staging*) ;;
    *) echo "FATAL: current_database без 'staging' — деплой запрещён"; exit 1;;
  esac
}
