# PR: HUBTender RC1 — этапы 0–2.6 (финансовая надёжность, аналитика, Smart Import, OpenRouter AI c контролируемым rollout)

> Готовый текст Pull Request `release/hubtender-rc1` → `main`. PR не создан автоматически; ветка не запушена (политика этапа 3.1).

## Context

29 коммитов этапов 0–2.6 поверх `952d729` (merge-base с main). Стек: Go BFF + Yandex Managed PG17 + React/AntD. Всё AI-поведение выключено по умолчанию и включается только явными действиями администратора.

## Scope

- **Этап 0–1**: server-authoritative финансовые расчёты, fail-closed FX, revision/CAS-модель, инвалидация согласования, decimal grand-total, retirement SQL-writers, recovery, tri-state PATCH, составные FK.
- **Этап 2.1–2.2**: 6 read-only аналитик + Review Pack XLSX.
- **Этап 2.3**: Smart Import + AI matching boundary + Import Memory.
- **Этап 2.4**: production readiness (audit, rehearsal, race, browser smoke).
- **Этап 2.5–2.6**: OpenRouter administration + controlled rollout (пилот, квоты, бюджет, circuit breaker, emergency off, evaluation).

Документы: `docs/releases/HUBTENDER_RC1_{SCOPE,MIGRATIONS,ENVIRONMENT,API,RELEASE_NOTES,DEPLOYMENT,ROLLBACK}.md`.

## Architecture

Трёхслойка handlers→services→repository; расчётное ядро `backend/internal/calc` (единственный источник формул); AI-подсистема `internal/ai/{openrouter,nomenclature,aieval}` за live-гейтом `services/ai_rollout*`; analytics `internal/analytics/*` — read-only движки; guard-скрипты `scripts/checks/*` фиксируют инварианты на уровне исходников.

## Screenshots checklist (заполнить при создании PR)

- [ ] Страницы аналитики (6) — desktop + iPhone 15 Pro Max
- [ ] Smart Import мастер (analyze → mapping → preview → execute)
- [ ] Admin AI: каталог, rollout-панель, пилот, квоты
- [ ] Статус финрасчёта на тендере (актуален/stale/считается)

## Migration plan

9 миграций, лексикографический порядок, идемпотентны (rehearsal ×2). FK-миграция — data-preflight обязателен. Retire-tombstones применять в связке с рестартом backend. Подробно: `HUBTENDER_RC1_MIGRATIONS.md`, `HUBTENDER_RC1_DEPLOYMENT.md`.

## Rollout plan

Деплой НЕ включает AI: rollout `off`, ключ не задан. Включение пилота — отдельное решение владельца по `docs/CONTROLLED_AI_ROLLOUT.md` (evaluation → пилотные пользователи → квоты/бюджет → transition).

## Security

- `OPENROUTER_API_KEY` только server env; в БД, фронт-бандле и логах отсутствует (guard + bundle-скан).
- Prompt/response и financial-поля не персистятся в AI-таблицах.
- Admin AI endpoints — backend role-гейт `RequireRoles`, не только frontend ACL.
- Review Pack: экранирование formula injection, безопасные ссылки.
- Secret scan tracked+history release-диапазона: чисто.

## Tests

Полный список с логами: RELEASE_NOTES §15. Кратко: go build/vet/test (unit+integration на disposable PG17), rehearsal fresh+upgrade, race detector (Linux/CGO), tsc+ESLint(0 warn), production build, Playwright smoke (17 тестов, fake OpenRouter, «ровно 5 провайдерских вызовов»), 38 guard'ов.

## Manual review checklist

- [ ] `backend/internal/calc` — формулы против `docs/CALCULATION_SOURCE_OF_TRUTH.md`
- [ ] Порядок и идемпотентность 9 миграций; NOT VALID→VALIDATE FK
- [ ] Revision/CAS: `tender_revision.go`, `recalc_recovery.go`
- [ ] AI data minimization: `internal/ai/nomenclature/suggest.go` (что уходит провайдеру)
- [ ] Квоты/бюджет: `services/ai_rollout_gateway.go` (атомарность резерваций)
- [ ] Emergency off: сквозной путь до suggest
- [ ] Formula injection: `analytics/reviewpack/safetext.go`
- [ ] Access control: `routes.go` AIAdminRoles-группа
- [ ] Frontend routes/ACL: `App.tsx`, `hasPageAccess`
- [ ] Mobile/user-коммиты в истории ветки: `26ab151` (merge origin/main этапа 2.5), `f3a9596` (шрифт вкладок) — не относятся к этапам, но в ветке

## Release-blocking фиксы этапа 3.1 (в этой ветке)

1. `git mv` миграции rollout → `2026_07_ai_rollout_controlled.sql` (порядок применения; upgrade rehearsal падал) + guard `migrationOrder.check.mjs`.
2. Миграция `2026_07_client_positions_section_fields.sql` (baseline-gap; no-op на prod).
3. Выравнивание baseline ↔ migration chain (11 FK-имён, CHECK-констрейнты ai_feature_settings) + гейт `schema-equivalence.sh`.

Продуктовый код не менялся; только SQL/скрипты/доки.

## Known risks

1. **Отставание от origin/main на 12 mobile/UX-коммитов**; пересечение по 9 файлам, вкл. `backend/cmd/server/routes.go` (CORS Cache-Control) и `src/pages/PositionItems/PositionItems.tsx`. Merge main → release до слияния PR обязателен.
2. Retire-tombstones ломают старый backend в rolling-окне (fail-closed) — деплой по порядку DEPLOYMENT §5–6.
3. Markup multiplyFormat: суммы части тактик изменятся (осознанное исправление P0) — manual gate.

## Rollback

`HUBTENDER_RC1_ROLLBACK.md`. Frontend — всегда; backend — до retire-миграций; далее roll-forward. AI — emergency off без деплоя.

## Reviewer focus

Financial calc ▸ migration ordering ▸ revisions/recovery ▸ AI data minimization ▸ quotas/budget ▸ emergency off ▸ formula injection ▸ access control ▸ frontend routes ▸ mobile-коммиты в истории.
