# Tender Review Action Plan — MVP (этап 1.4)

## 1. Цель

Страница **«План действий»** (`/analytics/action-plan`): единая приоритетная
очередь действий расчётчика по одному тендеру. Отвечает на вопросы: что
блокирует готовность расчёта, что важнее всего проверить, какие позиции и
строки затронуты, какая сумма требует проверки, что именно сделать и куда
перейти. Это **динамический read-only план, не task-management система**:
действия нигде не сохраняются и исчезают автоматически при следующем
построении после исправления данных.

## 2. Три источника действий

Композиция трёх ГОТОВЫХ аналитик (их движки переиспользуются, финансовая
математика не копируется):

1. **Tender Quality** (этап 1.1) — blockers/warnings/information качества;
2. **Historical Price Benchmark** (этап 1.2) — ценовые отклонения;
3. **Price Source Coverage & Freshness** (этап 1.3) — источники цен.

## 3. Почему read-only и динамический

План — производная от текущих данных: фиксировать action-строки означало бы
вторую истину, расходящуюся с BOQ. Никаких статусов «в работе/выполнено»,
dismiss, назначений, дедлайнов, уведомлений; Action Plan не меняет данные, не
запускает recalc, не трогает approval и кэш.

## 4-5. Priority bands и mapping

Четыре понятных band'а — **без непрозрачного числового score**:

| Источник | Статус/код | Priority |
|---|---|---|
| quality | любой blocker (CALCULATION_*, FX_RATE_MISSING, PARENT_*, *_MISMATCH, REDISTRIBUTION_*, APPROVAL_ON_STALE_CALCULATION) | blocking |
| quality | QUANTITY_ZERO, UNIT_RATE_ZERO, EXACT_DUPLICATE_GROUP | high |
| quality | остальные warning (UNIT_CODE_MISSING, DETAIL_COST_CATEGORY_MISSING) | normal |
| quality | information (DESCRIPTION_EMPTY) | low |
| benchmark | HIGH_OUTLIER, LOW_OUTLIER | high |
| benchmark | NOT_ELIGIBLE по identity (INSUFFICIENT_IDENTITY) | normal |
| benchmark | NOT_ELIGIBLE по метрике, INSUFFICIENT_HISTORY, WITHIN_RANGE | не action |
| source | SOURCE_MISSING, EXPIRED, INVALID_SOURCE_DATES | high |
| source | STALE, PRICE_DATE_MISSING | normal |
| source | EXPIRING_SOON | low |
| source | FRESH, NOT_APPLICABLE | не action |

**Blocking приходит ТОЛЬКО из quality blocker-семантики** — ценовая аномалия
и свежесть источника никогда не блокируют согласование.

## 6. Recommended-порядок

Детерминированная сортировка: (1) band; (2) внутри blocking — категория
(CALCULATION_STATE → CURRENCY → RELATIONS → DERIVED_CONSISTENCY →
REDISTRIBUTION → APPROVAL → прочие), затем entity/code; (3) внутри остальных —
известный impact_amount по убыванию → неизвестные после известных →
affected_items_count по убыванию → источник (quality → price_source →
price_benchmark) → порядок позиции → entity ID → code. После сортировки —
`rank` 1..N (не сохраняется; map-iteration не используется; одинаковые входы
дают идентичный ответ, кроме `generated_at`).

## 7-8. Impact amount и защита от двойного учёта

Только текущий server-authoritative `boq_items.total_amount`; доступен лишь
при `calculated` и совпадении ревизий, иначе `impact_amount = null`,
`impact_amount_status = unavailable`. Внутри действия строки суммируются по
UNIQUE BOQ IDs; `amount_requiring_review` в summary — сумма **union** всех
строк, входящих хотя бы в одно действие (строка с outlier + stale source +
missing unit учитывается один раз). Tender-level действия без BOQ IDs сумму не
добавляют. Никаких hypothetical savings/median replacement/commercial/markup/
insurance; benchmark-evidence (current_unit_cost, median, deviation_percent,
historical_tenders_count) возвращается как контекст, не как «экономия».

## 9. Explicit merge rules (без fuzzy)

- **A. Calculation not ready**: quality уже даёт агрегированный
  calculation-blocker → недоступность benchmark НЕ создаёт второй action;
  причину показывает component status.
- **B. Идентичность строки**: quality `UNIT_CODE_MISSING` + benchmark
  `NOT_ELIGIBLE (не указана единица измерения)` на одной строке → ОДИН action
  с `sources: ["quality","price_benchmark"]` и ID
  `merged:ITEM_IDENTITY_MISSING:<itemID>:unit_code`. Номенклатурная привязка
  NOT NULL по DB-констрейнту, поэтому живой identity-случай — единица
  измерения; отсутствие привязки в истории даёт standalone normal-action
  «Привяжите строку к номенклатуре». NOT_ELIGIBLE по иной причине не мержится.
- **C. Дубли**: группа точных дублей — один action на группу (навигация — к
  первой строке, все IDs в `boq_item_ids`).
- **D. Источники**: статусы source-движка взаимоисключающие — по строке один
  action.
- **E. Прочее не объединяется.** NOT_ELIGIBLE по метрике (qty/total ≤ 0)
  action не создаёт — он уже покрыт QUANTITY_ZERO/UNIT_RATE_ZERO.

## 10. Component statuses

`components.{quality|price_benchmark|price_source}.status`:
`available | calculation_not_ready | no_history | unavailable`. Partial result
не скрывается: при stale-расчёте план остаётся 200, quality-blocker объясняет
причину, а `price_benchmark: calculation_not_ready` — почему нет ценовых
отклонений. Внутренняя ошибка любого компонента НЕ маскируется пустым «всё
чисто» — endpoint отвечает 500.

## 11. API

`GET /api/v1/tenders/{id}/action-plan` — read-only, mutation-endpoints для
действий не существуют. Параметры: `benchmark_period_months` (6/12/24/36,
default 24), `source_max_age_days` (30/60/90/180/365, default 90), `priority`
(all/blocking/high/normal/low), `source`
(all/quality/price_benchmark/price_source), `category`, `position_id`,
`search`, `sort` (recommended/amount_desc/position), `page`, `page_size`
(default 50, max 200). **Summary считается по полному набору действий ПОСЛЕ
substantive-фильтров (priority/source/category/position/search), но ДО
пагинации**; контекстные счётчики (within_range, insufficient_history, fresh,
not_applicable) остаются глобальными. 404 — тендер не найден; 400 —
недопустимые period/max_age.

Snapshot-модель: все три аналитики читаются в ОДНОЙ REPEATABLE READ READ ONLY
транзакции (`ActionPlanRepo.LoadSnapshots` → те же `load*SnapshotTx`, что у
собственных endpoints трёх аналитик; фиксированные 5+3+2 запросов, без N+1 и
без HTTP-to-HTTP). Ответ относится к одной `financial_input_revision` и несёт
`financial_*`, `generated_at`, `as_of_date`, `benchmark_period_months`,
`source_max_age_days`.

## 12. UI

Сводка (блокирующие/высокий/остальные/затронутые строки/сумма к проверке/
состояние компонентов); карточка **«Следующее рекомендуемое действие»**
(server rank 1: title, reason, recommended action, priority reason, основная
кнопка; при пустом плане не показывается); фильтры; таблица (rank, приоритет,
источник, действие, строки, сумма, переходы); действия «К строке/Перейти» и
«Открыть аналитику». Подсказка: «Список формируется автоматически и
обновляется после исправления данных». Empty state: «Обязательных действий не
обнаружено» (НЕ «ошибок нет» и НЕ «тендер рассчитан правильно»). Никаких
чекбоксов «выполнено» и назначений.

## 13. Навигация

Frontend строит URL из typed `navigation` contract (без message parsing):
`boq_item`/`duplicate_group` → страница позиции (positionId+itemId+field);
`tender_currency` → курсы тендера; `financial_indicators` → финансовые
показатели; `redistribution` → перераспределение; неизвестный тип →
безопасный fallback на страницу исходной аналитики (`source_navigation`).
Secondary action всегда открывает исходный аналитический экран.

## 14-15. Почему нет persistence и score

Persistence (assignment, статусы, история) превращает динамическую производную
в отдельную систему задач с рассинхронизацией и НЕ входит в MVP. Числовой
score скрывает причину приоритета; четыре band'а + `priority_reason` дают
объяснимую сортировку.

## 16. Ограничения MVP

Нет сохранения/назначений/дедлайнов/уведомлений; план не применяет изменения
(не меняет BOQ/ставки/курсы, не удаляет дубли, не запускает recalc, не трогает
approval); outlier не утверждается как ошибка цены; при недоступном компоненте
показывается его статус, а не пустой «чистый» результат; кэша нет — план
строится на каждый запрос.

## 16a. Связанные инструменты

Сравнение сохранённых версий тендера — «Изменения расчёта»:
[TENDER_CHANGE_IMPACT_ANALYTICS.md](TENDER_CHANGE_IMPACT_ANALYTICS.md)
(этап 1.5); из плана действий ведёт ссылка «Изменения расчёта между версиями».

## 17. Backlog (осознанно НЕ в этапе 1.4)

assignment · acknowledgement/ручное закрытие · дедлайны · уведомления
(email/Telegram) · saved review sessions · AI-объяснения · action history ·
role-based workflows · персистентные снапшоты плана.

## 18. Тесты и guard

- Юнит: `backend/internal/analytics/actionplan/engine_test.go` (42 пункта §16:
  mapping, merge rules, стабильные ID, детерминизм/permutation, impact/union,
  components, 5000-actions perf без квадратичности, NaN-защита).
- Handler: `backend/internal/handlers/action_plan_test.go` (401, фильтры →
  summary, пагинация, amount-sort, 400).
- Интеграционные: `backend/internal/repository/action_plan_integration_test.go`
  (A-O: три источника вместе, union-amount, stale-деградация, исчезновение
  action после исправления, дубль-группа, identity-merge, stable IDs,
  консистентный снапшот, server as-of).
- Guard: `scripts/checks/actionPlanSafety.check.mjs` (15 правил) + 6
  негативных self-checks; frontend focused:
  `scripts/checks/actionPlanFrontendPolicy.check.mjs` (26 проверок).
