# HUBTender Staging — Runbook (этап 3.2)

Развёртывание замороженного RC2 (`0bffa67`) в изолированный staging. Ничего из
этого пакета не содержит секретов; фактический `.env.staging` живёт ТОЛЬКО на
staging host (chmod 600, вне git).

## Предпосылки (owner gates)

`STAGING_PROVISION_APPROVED/PUSH_APPROVED/DEPLOY_APPROVED=true`, заполненные
`STAGING_*`-значения (SSH, домен, DB, JWT-ключ, тест-пользователи), а для
actual-миграции — `STAGING_MARKUP_BACKFILL_REVIEWED=true` и
`STAGING_RELATION_PREFLIGHT_APPROVED=true` (для first-install пустой БД оба
вакуумно-истинны, но подтверждаются владельцем явно).

## Топологии

- **dedicated_host**: web публикует 80/443 на внешний интерфейс (`STAGING_WEB_BIND=0.0.0.0`), DNS staging-домена → host, Caddy сам получает TLS.
- **isolated_same_host** (рядом с production su10): `STAGING_WEB_BIND=127.0.0.1`, host-nginx добавляет ОТДЕЛЬНЫЙ server-блок staging-домена → proxy на `127.0.0.1:${STAGING_WEB_PORT}`; production vhost/контейнеры не изменяются; лимиты памяти compose (`STAGING_DB_MEM_LIMIT`, `STAGING_API_MEM_LIMIT`) защищают прод.

## Порядок первого развёртывания

```bash
# на staging host, checkout строго RC2 SHA
git clone <origin> hubtender && cd hubtender
git switch release/hubtender-rc2-staging && git checkout 0bffa67
cp deploy/staging/.env.staging.example .env.staging && chmod 600 .env.staging  # заполнить
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /srv/hubtender-staging/jwt-staging.pem  # отдельный ключ

bash scripts/staging/deploy-staging.sh --migrate      # db → migrate(×2) → api → build dist → web → health
bash scripts/staging/seed-staging-users.sh            # admin/regular/pilot + STAGING-SYNTH-001
bash scripts/staging/backup-staging.sh                # первый backup
bash scripts/staging/restore-test-staging.sh          # backup валиден только после этого
```

Приёмка: Playwright против `https://$STAGING_DOMAIN` (`E2E_BASE_URL=https://$STAGING_DOMAIN npx playwright test --config playwright.readiness.config.ts` + staging-специфичные сценарии), API-security smoke, 30-мин soak, rollback drill (`scripts/staging/rollback-staging.sh`), security-приёмка. После всех тестов проверить `rollout_mode=off`.

## Гарантии изоляции

Отдельный compose-project/network/volumes; db без внешнего порта; api только за
reverse proxy; образ — immutable `staging-<sha>`; guard-скрипты отказывают при
DB-имени без `staging`, prod-DSN (`mdb.yandexcloud|supabase`) и `APP_ENV!=staging`;
notifications выключены (SMTP не задан); source maps наружу не отдаются (Caddy 404).

## Rollback

`rollback-staging.sh frontend|backend|ai-off` — по политике
`docs/releases/HUBTENDER_RC1_ROLLBACK.md`: frontend — всегда безопасен; backend —
только совместимый с forward-схемой образ (retired-tombstones!); БД — без down-
миграций, восстановление backup только в disposable-клон; AI — emergency off.
