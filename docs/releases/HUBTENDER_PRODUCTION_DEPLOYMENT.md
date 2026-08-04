# HUBTender — Production Deployment (этап 3.3, 2026-08-04)

Релиз `04ef152` (приложение ≡ RC2 `9781291`/`0bffa67`) развёрнут на **tender.su10.ru** по фазовой матрице, доказанной на клоне прод-БД (`HUBTENDER_PRODUCTION_CLONE_REHEARSAL.md`). AI rollout = **off**.

## Хронология (2026-08-04, UTC)

| Время | Фаза | Результат |
|---|---|---|
| 08:56–09:27 | §6 Final backup (Yandex) | **COMPLETED**, 2 795 MB (restore-способность доказана клоном: 27 мин) |
| ~09:15 | Phase A (хост, Cursor) | checkout `04ef152`, образ `hubtender-api:prod-04ef152` (`c82bd1bb1ed1`), dist 22M, `.env.prod` уже содержал RC2-ключи |
| 09:27:48–09:31:26 | §8 ADDITIVE ×2 на живом проде | **PASS**, 23 файла, идемпотентность подтверждена; verification: section_fields=2, revision_cols=3, ai_tables=6, memory=2, композитные FK валидны, rollout=off; старый backend работал всё время |
| 09:31 | §9 Backfill | подтверждённый no-op (0→0) |
| 09:34:27–09:34:35 | Phase B (Cursor): стоп старого 6e8ea39 → старт `prod-04ef152` | health×4 = **200** (вкл. новые /health/recalc, /health/ai), логи чистые. **Отклонение**: nginx-maintenance не включился (sed сломан SSH-враппером) — мутации не блокировались; несущественно: опасное окно = сам рестарт (~8 сек), новый backend совместим со схемой |
| 09:35 | Внешний API-smoke | 401-гейты корректны, фронт 200, 22 сессии нового пула, застрявших расчётов 0 |
| 09:36:48 | Phase C (Cursor): frontend | rsync нового dist, бэкап `public.backup-20260804T093648`, фронт 200 |
| 09:37 | Браузерный смоук | консоль/ошибки/failed-запросы = 0; логин-страница нового UI живая |
| 09:38:12 | §18 **RETIREMENT** ×3 (~13,5 c) | триггеров grand-total **0**; tombstones fail-closed (`COMMERCIAL_COST_WRITE_RETIRED`, `REDISTRIBUTION_RESULT_WRITE_RETIRED`); backend жив. **Точка невозврата пройдена — далее roll-forward-only** |
| 09:38 | §19 Финальный аудит | rollout=off, 84/84 calculated, застрявших 0, approved 20 целы, FK валидны |
| 09:39+ | Phase D (Cursor) | удаление публичных `.js.map`, docker prune |
| 09:40–10:11 | §21 Наблюдение 31 мин | см. artifacts/production-deploy-observation.log |

## Отклонения от плана (все зафиксированы)

1. **Maintenance-режим не включался**: sed-вставка include сломалась в кавычках SSH-враппера Cursor. Фактическое воздействие — нулевое: additive-фаза по дизайну rolling (старый backend совместим — доказано на клоне и подтверждено на проде), окно рестарта ~8 секунд, новый backend принимает мутации по полностью мигрированной схеме. Retirement выполнялся при живом новом backend — безопасно (release не использует retired-объекты, доказано).
2. **Source maps** (`sourcemap: 'hidden'`) попали в public — удалены в Phase D; в backlog: чистить `*.map` при деплое либо блокировать в nginx.
3. **Гейт `ALL_KNOWN_COMPROMISED_KEYS_REVOKED` снят владельцем письменно** («забудем, он не используется») — ключ принадлежит SA другого проекта (Meridian) без доступа к облаку TenderHUB; ротация остаётся в backlog Meridian.
4. Авторизованный прод-smoke не выполнялся (креды прод-пользователя не передавались; write-smoke не одобрялся) — реальный трафик пользователей во время наблюдения служит фактическим смоуком.

## Rollback-состояние после деплоя

- **Backend**: страховочный тег `hubtender-api:prod-old-6e8ea39` сохранён, но после retirement старый backend — НЕ допустимая цель отката (**roll-forward-only**).
- **Frontend**: `public.backup-20260804T093648` сохранён — откат UI допустим (совместим со схемой).
- **БД**: financial backup 2 795 MB (09:26Z) + клон-кластер жив до отдельного «GO DELETE TEMP CLONE».

## 24-hour hold перед AI-пилотом

`PROD_AI_PILOT_EARLIEST_AT = 2026-08-05 ~10:15 UTC` (production open + 24h). До этого: rollout остаётся off, наблюдать recovery/stale/failed/импорты/аналитику/ошибки браузера. Этап 3.4 (pilot_individual) — только после стабильных 24 часов и отдельного решения владельца.

## Итог

**PRODUCTION DEPLOYED — ROLLOUT OFF** (при условии зелёного 30-мин наблюдения — см. финальный отчёт сессии). Секреты не выводились; hot-edit'ов прод-кода не было; AI-пилот не включался.
