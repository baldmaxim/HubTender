#!/usr/bin/env bash
# Локальный SSH-wrapper для деплоя HUBTender.
# Ничего локально не собирает. Подключается к prod-серверу, синкает
# /opt/hubtender-build с remote/main и зовёт scripts/deploy-server.sh.
#
# Использование (с локальной машины):
#   bash scripts/deploy-production.sh --check
#   bash scripts/deploy-production.sh backend
#   bash scripts/deploy-production.sh frontend
#   bash scripts/deploy-production.sh both
#
# Env-флаги (прокидываются на сервер):
#   SKIP_VERIFY, FRONTEND_NPM_CI, BUILD_CLEAN_HARD,
#   HUBTENDER_REMOTE, HUBTENDER_BRANCH
#
# Локальные env (только для wrapper'а):
#   HUBTENDER_SSH        default root@45.80.128.254
#   HUBTENDER_BUILD_DIR  default /opt/hubtender-build
#   HUBTENDER_REPO_URL   default https://github.com/baldmaxim/HUBTender.git

set -euo pipefail

readonly SSH_TARGET="${HUBTENDER_SSH:-root@45.80.128.254}"
readonly BUILD_DIR="${HUBTENDER_BUILD_DIR:-/opt/hubtender-build}"
readonly REPO_URL="${HUBTENDER_REPO_URL:-https://github.com/baldmaxim/HUBTender.git}"
readonly REMOTE="${HUBTENDER_REMOTE:-origin}"
readonly BRANCH="${HUBTENDER_BRANCH:-main}"

SCOPE="${1:-}"
if [ -z "$SCOPE" ]; then
  cat <<EOF >&2
Usage: bash scripts/deploy-production.sh <scope>

Scopes: --check | backend | frontend | both

Env (прокидывается на сервер):
  SKIP_VERIFY=1, FRONTEND_NPM_CI=1, BUILD_CLEAN_HARD=1,
  HUBTENDER_REMOTE=$REMOTE, HUBTENDER_BRANCH=$BRANCH

Env (локально для SSH):
  HUBTENDER_SSH=$SSH_TARGET
  HUBTENDER_BUILD_DIR=$BUILD_DIR
  HUBTENDER_REPO_URL=$REPO_URL
EOF
  exit 1
fi

PASSTHROUGH=()
for v in SKIP_VERIFY FRONTEND_NPM_CI BUILD_CLEAN_HARD HUBTENDER_REMOTE HUBTENDER_BRANCH; do
  if [ -n "${!v:-}" ]; then
    PASSTHROUGH+=("$v=${!v}")
  fi
done

echo "[deploy-production] ssh $SSH_TARGET → $BUILD_DIR (scope=$SCOPE)"
if [ "${#PASSTHROUGH[@]}" -gt 0 ]; then
  echo "[deploy-production] passthrough: ${PASSTHROUGH[*]}"
fi

ssh "$SSH_TARGET" \
  BUILD_DIR="$BUILD_DIR" \
  REPO_URL="$REPO_URL" \
  REMOTE="$REMOTE" \
  BRANCH="$BRANCH" \
  SCOPE="$SCOPE" \
  PASSTHROUGH="${PASSTHROUGH[*]:-}" \
  bash -s <<'REMOTE_EOF'
set -euo pipefail

if [ ! -d "$BUILD_DIR/.git" ]; then
  echo "[remote] $BUILD_DIR пуст — git clone $REPO_URL"
  mkdir -p "$(dirname "$BUILD_DIR")"
  git clone "$REPO_URL" "$BUILD_DIR"
fi

cd "$BUILD_DIR"

# Серверный скрипт сам делает git sync, но --check на это не идёт —
# для --check подтянем чистый main, чтобы проверки шли по актуальному
# scripts/deploy-server.sh.
git fetch "$REMOTE" "$BRANCH" --prune
git checkout -f -B "$BRANCH" "$REMOTE/$BRANCH"
git reset --hard "$REMOTE/$BRANCH"

# shellcheck disable=SC2086
env $PASSTHROUGH bash scripts/deploy-server.sh "$SCOPE"
REMOTE_EOF
