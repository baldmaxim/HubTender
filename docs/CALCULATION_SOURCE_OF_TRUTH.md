# Источник истины для денежных расчётов (HUBTender)

> Итог этапа 0.1.2 — «Аудит единого расчётного контура».
> Цель: зафиксировать, **где** в системе считаются деньги, **какой** расчёт главный,
> и где остаются **скрытые альтернативные формулы**.

## 1. Авторитетный расчёт

**ЕДИНСТВЕННЫЙ источник математики BOQ/тендера — `backend/internal/calc/`.**

Любое денежное значение, которое **сохраняется в БД**, должно вычисляться там
(или проверяться против него на сервере). Frontend и SQL считают деньги только
для **отображения / preview**, никогда как источник истины.

### Что уже живёт в `calc/` (авторитетно)

| Расчёт | Функция | Файл |
|---|---|---|
| BOQ amount (qty×rate×fx, delivery, consumption) | `CalculateBoqItemTotalAmount`, `CalculateDeliveryUnitCost` | `calc/boq_amount.go` |
| FX (курс валюты → RUB, блокировка при отсутствии) | `GetCurrencyRateFromTender` → `MissingFXRateError` | `calc/boq_amount.go`, `calc/errors.go` |
| Markup (последовательность операций, addOne/direct) | `CalculateMarkupResult`, `ValidateSequences` | `calc/markup.go`, `calc/markup_validate.go` |
| Commercial cost + распределение | `CalculateBoqItemCost`, `ApplyPricingDistribution` | `calc/boq_item_cost.go`, `calc/pricing_distribution.go` |
| Rounding (5 ₽ smart-rounding + компенсация) | `RoundTo5`, `CompensateError` | `calc/smart_rounding.go` |
| Grand total (13-коэфф. каскад) | `CalculateGrandTotal` | `calc/grand_total.go` |
| Redistribution (вычеты/добавления) | `CalculateRedistribution`, `CalculateDeductions`, `CalculateAdditions` | `calc/redistribution.go` |

Каждое ядро покрыто юнит-тестами; TS-зеркала обязаны быть 1:1 с Go.

### Production-callers, которые УЖЕ используют `calc/` (эталон)

- `repository/boq_write.go` `CreateBoqItem` → `calc.CalculateBoqItemTotalAmount` (FX-блокировка).
- `repository/boq_mutate.go` `UpdateBoqItem` → то же.
- `repository/position_recompute.go` `RecomputeLinkedMaterialsForWork` → то же.
- `repository/template_insert.go` `InsertTemplateItems` → то же (**0.1.2.1**).
- `services/commercial_recalc.go` `RecalcTender` → `calc.CalculateBoqItemCost`.

### Вставка шаблона (этапы 0.1.2.1 / 0.1.2.1a)

- Библиотека шаблона хранит **только исходные параметры** (unit_rate, currency,
  delivery, consumption, conv_coeff) — она **никогда** не хранит и не поставляет
  денежный итог.
- `total_amount` **всегда** вычисляется `calc.CalculateBoqItemTotalAmount` — те же
  правила, что и у обычного `CreateBoqItem` (consumption, delivery-матрица, FX).
- Отсутствующий/нулевой валютный курс **блокирует всю вставку** (`MissingFXRateError`
  → RFC 7807 400 `MISSING_FX_RATE`). FX-фолбэка `1.0` больше нет.
- **Дочерний материал может ссылаться только на work item.** Родитель проверяется по
  канону `calc.IsWorkBoqType` (раб / суб-раб / раб-комп.).
- **Заданная, но невалидная parent-ссылка блокирует вставку** —
  `InvalidTemplateParentError` → RFC 7807 400 `INVALID_TEMPLATE_PARENT`.
  Причины: `PARENT_NOT_FOUND`, `PARENT_NOT_WORK_ITEM`, `SELF_PARENT_REFERENCE`
  (`PARENT_NOT_INSERTED` зарезервирована: сейчас набор вставки == все строки шаблона).
- **Invalid parent никогда не превращается молча в standalone** — иначе к строке
  применился бы consumption_coefficient, и деньги «тихо» разошлись бы, скрыв
  повреждённый шаблон.
- **Planning выполняется до persistence**: сначала (read-only) валидируются все
  parent-ссылки, нормализуются строки и считается calc-сумма каждой; только после
  этого начинаются INSERT/UPDATE. Ни одной mutation-запроса до прохождения проверок.
- Операция **атомарна**: ошибка любой строки откатывает транзакцию — не остаётся ни
  строк, ни audit-записей, totals не меняются, recalc/cache не трогаются
  (покрыто unit-тестом side-effects в `services`).
- Курсы валют читаются **один раз** на всю операцию (без N+1).

**Runtime-проверка отката** выполняется PostgreSQL integration-тестом при настроенной
тестовой БД (без неё тест честно SKIP-ается, не PASS):

```bash
HUBTENDER_TEST_DATABASE_URL='postgres://<user>:<pass>@<host>:<port>/<db>_test?sslmode=disable' \
  go test ./internal/repository/ -run TemplateInsertIntegration -v
```

Тест отказывается работать, если имя БД в DSN не содержит `test` (защита от
случайного запуска по production). Реальные креды в документацию не добавляются.

## 2. Что запрещено

- ❌ **Frontend money calculation** как источник сохраняемой стоимости.
- ❌ **SQL, дублирующий** денежную формулу параллельно с Go.
- ❌ **Доверять Excel-итогам** (импорт не должен принимать `total_amount` от клиента без пересчёта).
- ❌ **Ручные формулы** в repository/handlers вместо вызова `calc/`.
- ❌ Своё округление / свои коэффициенты в обход `calc/`.

## 3. Как добавлять новый расчёт (для разработчика)

Неправильно:
```ts
// frontend
function calculatePrice(item) { return item.qty * item.rate * fx; } // ← источник истины на фронте
```
Правильно:
```go
// backend/internal/calc
func CalculatePrice(in Input, rates CurrencyRates) (float64, error) { ... } // ← единственная математика
```
```ts
// frontend — только отображение результата сервера
const price = row.total_amount; // сервер посчитал и вернул
// или, для optimistic preview, строго ЗЕРКАЛО calc:
// UI preview only. Authoritative calculation is performed by backend/internal/calc.
```

Порядок: (1) добавить функцию в `calc/` + тест; (2) вызвать её из repository/service на пути записи; (3) на фронте — только `display`/preview-зеркало с баннером `// UI preview only.`

## 4. Карта денежных расчётов (аудит 0.1.2)

### 4a. Go backend

| Файл / метод | Что считает | Использует `calc`? | Риск | Статус |
|---|---|---|---|---|
| `boq_write.go CreateBoqItem` | total_amount | ✅ да | LOW | эталон |
| `boq_mutate.go UpdateBoqItem` | total_amount | ✅ да | LOW | эталон |
| `position_recompute.go` (recompute) | total_amount | ✅ да (кол-во — частично вне) | MED | quantity-деривация вне calc — **backlog** |
| `commercial_recalc.go RecalcTender` | commercial split | ✅ да | LOW | эталон |
| `template_insert.go` | total_amount | ✅ **да** (0.1.2.1) | LOW | **исправлено** — legacy-формула удалена |
| `import_boq.go BulkImport` | total_amount | ✅ **да** (0-F1) | LOW | **исправлено** — client total диагностический, деньги через `RecomputeBoqTotalAmountsTx` |
| `commercial_write.go PersistCalculatedCommercialCosts` | запись **рассчитанных** commercial (внутренний писатель) | ✅ да (пишет результат calc) | LOW | **0.1.2.2** — единственный writer, привязан к одному tender |
| `redistribution.go SaveResults` | redistribution от клиента | ❌ нет | **HIGH** | **backlog** (см. §7) |
| `tender_recalc.go RecalculateTenderGrandTotal` | Σcommercial + insurance, ROUND(,2) | ❌ нет | MED | дубль с SQL — **backlog** |
| `position_costs.go GetPositionsWithCosts` | base/commercial/markup% (read-only) | ❌ нет | MED (read-only) | display-агрегат |
| `boq_copy.go`, `tender_transfer_boq.go` | копируют **только исходные данные**; derived пересчитываются | ✅ да (**0.1.2.2a**) | LOW | **исправлено** |
| `cbr/client.go round2` | FX rate = value/nominal, 2dp | ❌ (ingestion) | LOW | контракт 2dp |

### 4b. TypeScript frontend

**Preview/display/formatter (помечены баннером `// UI preview only.`):**
`utils/boq/calculateBoqAmount.ts` (канон-зеркало), `utils/boq/liveCommercialCalculation.ts`,
`utils/boq/currencyGuard.ts`, `utils/markupCalculator.ts`, `services/markupTactic/calculation.ts`,
`services/redistributionPipeline/*`, `pages/CostRedistribution/utils/{smartRounding,buildResultRows,calculatePositionAdjustment}.ts`,
`pages/FinancialIndicators/utils/computeIndicators.ts`, `pages/Commerce/hooks/useCommerceData.ts`,
`pages/*/…/useClientPositions.ts`, `Analytics/ObjectComparison`, все Excel-экспортеры.

**Пишет деньги в БД (нарушение принципа — backlog):**

| Файл | Что персистит | Куда | Статус |
|---|---|---|---|
| `CostRedistribution/utils/calculateDistribution.ts` (+ `useSaveResults`, `lib/api/redistributions.ts`) | 4 поля redistribution | `cost_redistribution_results` | **HIGH — backlog** (баннер ⚠️ добавлен) |
| `importShared.ts`, `massBoqImportValidation.ts`, `massBoqImportPayload.ts` | total_amount при импорте | `/imports/boq`, `/items` | **этап 0.2 (импорт)** |
| add/edit формы (`WorkEditForm`, `useMaterialEditForm`, `useItemActions`) | total_amount в теле POST/PATCH | `/items` | **сервер пересчитывает** (calc) → фактически optimistic; формула-дубль — backlog |

> Примечание: одиночные `POST/PATCH /api/v1/items` пересчитывают `total_amount` на
> сервере через `calc` (0.1.0), поэтому клиентское значение там **игнорируется**.
> Реальные незакрытые персист-дыры — redistribution и импорт.

### 4c. SQL

- `boq_items.total_amount` — **обычная numeric-колонка, НЕ trigger/GENERATED**. Пишется только приложением.
- `recalculate_tender_grand_total` (+ 4 триггера) — Σcommercial + insurance, `ROUND(,2)`. **Второй экземпляр** формулы (дубль с Go `tender_recalc.go`). Insurance-формулы **нет в `calc/`**.
- `get_positions_with_costs`, `execute_version_transfer` (position-rollup), `bulk_update_..._commercial`, `save_redistribution_results`, `bulk_import_...`, `insert/update_boq_item_with_audit` — superseded Go-репликами, но **всё ещё установлены** в БД → латентный bypass. Удаление — отдельный этап (не трогаем БД сейчас).
- `clone_tender_as_new_version`, transfer — copy-only, безопасно.
- **Нет** GENERATED-money-колонок и CHECK/DEFAULT с денежной арифметикой.

## 5. Округление (аудит §4)

| Место | Текущее округление | Правильное | Менять? |
|---|---|---|---|
| `calc/smart_rounding.go RoundTo5` | `math.Round(v/5)*5` (до 5 ₽, half-away) | ✅ эталон | нет |
| `calc/boq_item_cost.go` VAT-детект | `math.Round((num-1)*100)` | ок | нет |
| `calc/money_decimal.go RoundMoney2Decimal` (cached_grand_total) | decimal half away from zero, 2dp (`big.Rat`; 1.005→1.01, ≡ PostgreSQL `ROUND(numeric,2)`) | ✅ эталон денег (0.1.2.4a.1) | нет |
| `cbr/client.go round2` | `math.Round(x*100)/100` | ок (FX ingestion) | нет |
| TS `smartRounding.ts roundTo2` | 2 dp для UI | display-only | нет |
| TS `markupCalculator.ts` | сохраняет JS-float семантику (1:1 с Go) | ок | нет |

**Критические сценарии** (проверены тестом `rounding_scenarios_test.go`): `100.555`, `100.554`,
`0.005`, `0.0049` — все считаются одинаково в Go `math.Round` и JS `Math.round` для
**положительных** значений (half-up == half-away). Расхождение Go↔JS возможно только на
**отрицательных** `.5` (Go — away-from-zero, JS — toward +∞); денежные суммы здесь
положительны, поэтому риска нет. **Банковского округления в проекте нет** — везде
арифметическое (half-up); двойного округления в одном пути не обнаружено.

⚠️ Важно (0.1.2.4a.1): `math.Round(x*100)/100` над float64 — это НЕ half away
from zero по десятичной величине (float64(1.005) < 1.005 → 1.00) и на
авторитетном денежном пути ЗАПРЕЩЁН (guard). Для cached_grand_total действует
десятичная политика §7h; float-round2 остаётся только в non-authoritative
путях (preview-parity prepared pipeline, FX ingestion).

## 6. Float в деньгах (аудит §5)

Проект использует `float64` (Go) / `number` (TS) для денег — **осознанно, полная
decimal-миграция вне этого этапа**. Исключение (0.1.2.4a.1): узкая decimal-граница
`cached_grand_total` (`calc/money_decimal.go`, stdlib `math/big.Rat`) — агрегаты и
insurance читаются как `numeric::text`, арифметика и финальное округление точные,
float64 на этом пути не авторитетен. Классификация остального:

- **A. Безопасно** (UI, графики, проценты, отображение): все preview-зеркала, экспортеры,
  `computeIndicators`, `useCommerceData`, `buildResultRows`.
- **B. Опасно** (сохранение/сравнение/округление денег): пути записи `total_amount` и
  commercial. Смягчено тем, что авторитетный путь — `calc/` на сервере с одинаковой
  float-семантикой Go↔TS (тесты фиксируют идентичность). Полный переход на decimal —
  **отдельный этап**, не здесь.

## 7. Конфликты, требующие ОТДЕЛЬНОГО этапа (backlog)

Ничего из этого не удалялось/не переносилось в 0.1.2 (гарантия «постепенно, без
удаления старых функций и без изменения БД»):

1. ~~**Redistribution пишется с фронта.**~~ → ✅ **category-level закрыто в 0.1.2.3a**
   (см. §7e): save принимает только правила, per-BOQ результаты считает
   `backend/internal/calc`, SQL RPC `save_redistribution_results` — tombstone.
   **Остаётся на 0.1.2.3b:** финальный position-level pipeline (`buildResultRows`,
   smart rounding, insurance-распределение, Commerce/FI/Excel prepared rows).
2. ~~**Grand total + insurance — два экземпляра** (Go `tender_recalc.go` ⇄ SQL
   `recalculate_tender_grand_total`), формула не в `calc/`.~~ → ✅ **закрыто в
   0.1.2.4a** (см. §7h): формула только в `calc.CalculateCachedTenderGrandTotal`,
   SQL-функция — tombstone, grand-total триггеры удалены.
3. ~~**`template_insert.go`** legacy-формула~~ → ✅ **закрыто в 0.1.2.1**: путь переведён на
   `calc.CalculateBoqItemTotalAmount`, effective parent определяется до INSERT, FX блокирует.
4. ~~**Импорт BOQ** доверяет `total_amount` клиента (`import_boq.go`, mass/single import).~~ →
   ✅ **закрыто в 0-F1** (см. §7i): mass import вставляет строки без total_amount и
   пересчитывает их в той же tx через `RecomputeBoqTotalAmountsTx`; client total —
   только диагностика (mismatch report). Single-position import и раньше шёл через
   server-authoritative `CreateBoqItem`.
5. ~~**`PATCH /items/bulk-commercial`** — сырой client-write commercial~~ → ✅ **закрыто в 0.1.2.2**
   (endpoint retired, 410; см. раздел «Коммерческие стоимости» ниже).
   ~~Латентный DB-level bypass `public.bulk_update_boq_items_commercial_costs`~~ →
   ✅ **закрыто в 0.1.2.2c**: функция превращена в fail-closed tombstone (см. §7d).
6. **Superseded SQL RPC** (`insert/update_boq_item_with_audit`, `get_positions_with_costs`,
   `execute_version_transfer`, `bulk_*`) всё ещё в БД → латентный bypass. → снять в этапе БД.
7. **Дублированный type→bucket сплит** `SUM(total_amount) FILTER (type IN …)` в
   `position_recompute.go`, `template_insert.go`, `boq_copy.go` и 2 SQL-функциях. →
   централизовать (в `calc` есть `IsWorkBoqType`/`IsMaterialBoqType`).

## 7a. Коммерческие стоимости — только серверная запись (этап 0.1.2.2)

`commercial_markup`, `total_commercial_material_cost`, `total_commercial_work_cost` —
это **результаты расчёта**, а не пользовательский ввод.

1. **`PATCH /api/v1/items/bulk-commercial` ВЫВЕДЕН ИЗ ЭКСПЛУАТАЦИИ.** Route намеренно
   остаётся зарегистрированным как tombstone и **всегда** отвечает:
   `410 Gone`, `application/problem+json`, `code: COMMERCIAL_COST_WRITE_RETIRED`.
   Он не читает body, не валидирует, не зовёт service/repository, ничего не мутирует,
   не сбрасывает кэш и не запускает recalc — одинаково для корректного, пустого и
   битого JSON.
2. **Клиенты не могут сохранять эти поля.** Client-DTO `BulkCommercialRow` и метод
   `BulkUpdateCommercial` удалены из handler/service/repository. Интерфейс
   `bulkBoqServicer` больше **физически не содержит** commercial-writer, поэтому
   handler не способен мутировать эти колонки даже по ошибке.
3. **Единственный production-писатель** — внутренний
   `BulkBoqRepo.PersistCalculatedCommercialCosts`, вызываемый **только**
   `CommercialRecalcService` после `calc.CalculateBoqItemCost`. Строка результата —
   `CalculatedCommercialCostRow`: **без json- и validate-тегов**, «server-generated,
   must never be populated from an HTTP request» (закреплено тестом через reflect).
4. **Writer привязан к одному тендеру.** Контракт:
   `PersistCalculatedCommercialCosts(ctx, tenderID, rows)`. SQL обновляет строки при
   `bi.id = u.id AND bi.tender_id = $tenderID` — чужой тендер невозможно задеть, какие
   бы ID ни передали (а не «собрать затронутые тендеры постфактум»).
5. **Exact-set + атомарность.** До мутации набор валидируется (непустой и уникальный ID,
   конечные числа, без NaN/±Inf, неотрицательные суммы; верхнего предела нет). После
   UPDATE обязана выполняться `RowsAffected == len(rows)`; иначе —
   `CommercialResultSetMismatchError{TenderID, Expected, Updated}` и **rollback всей
   транзакции**: ни частичного набора, ни частично обновлённого grand total. Grand total
   пересчитывается **один раз** в той же транзакции. Кэш чистится **только** после
   успешного commit.
   Невалидный рассчитанный результат → `InvalidCommercialCalculationResultError{ItemID,
   Field, Reason}` (это баг расчёта, а не ввод клиента — клиент до writer'а не доходит).
6. ~~**Латентный DB bypass:** SQL-функция
   `public.bulk_update_boq_items_commercial_costs(p_rows jsonb)`~~ → ✅ **закрыто в
   0.1.2.2c**: baseline и incremental migration превращают её в fail-closed tombstone
   (SQLSTATE 0A000 `COMMERCIAL_COST_WRITE_RETIRED`), EXECUTE отозван у PUBLIC и всех
   обнаруженных non-owner grantees. Runtime ACL production до применения миграции —
   **UNKNOWN**; проверяется verification query из миграции (см. §7d).
7. **Остаётся на 0.1.3:** серверный recalc меняет `updated_at` (риск ETag-конфликтов) и
   не защищён от stale-write при двух конкурентных пересчётах. В этом этапе сознательно
   не решалось.

Защита от возврата фронтового писателя: `scripts/checks/noCommercialWrite.check.mjs`
(падает, если в `src/` появится вызов retired-endpoint, хелпер `bulkUpdateCommercial`
или commercial-поле внутри тела запроса).

## 7b. Copy / Version transfer — авторитетный пересчёт (этап 0.1.2.2a)

`boq_copy.go` и `tender_transfer_boq.go` больше **не переносят** рассчитанные суммы
исходной строки.

1. **Копируются только исходные данные (класс A):** `boq_item_type`, `quantity`,
   `unit_rate`, `currency_type`, `consumption/conversion_coefficient`, delivery-поля,
   номенклатура, `unit_code`, `description`, `quote_link`, `detail_cost_category_id`.
   Вычисляемые (класс B) — `total_amount`, `commercial_markup`,
   `total_commercial_material_cost`, `total_commercial_work_cost` — **отсутствуют и в
   SELECT, и в списке колонок INSERT**. Плейсхолдеры из source не используются: колонки
   nullable, остаются NULL внутри незакоммиченной транзакции до авторитетного расчёта.
2. **`total_amount` всегда пересчитывается по FX ЦЕЛЕВОГО тендера** через
   `calc.CalculateBoqItemTotalAmount` (`RecomputeBoqTotalAmountsTx`). Курсы читаются
   **один раз** на операцию; один bulk-UPDATE. Нет FX-фолбэка 1.0, нет 0 при ошибке,
   нет собственной формулы в repository. Это верно и для same-tender copy — чтобы не
   размножать устаревший source-итог.
3. **Commercial всегда пересчитываются по конфигурации ЦЕЛЕВОГО тендера** (markup-тактика,
   проценты, pricing distribution, исключения) — `MaterializeCommercialForTenderTx` →
   то же ядро `ComputeCommercialRows` (`calc.CalculateBoqItemCost`) → тот же внутренний
   писатель `PersistCalculatedCommercialCostsTx`. Формула не дублируется.
4. **Source calculated values никогда не авторитетны для target.**
5. **Parent remap до определения effective parent:** ссылки валидируются против реально
   копируемого набора (`ResolveCopiedParents`); родитель обязан быть **work item**.
   Неразрешимая / non-work / self ссылка → блокирующая `InvalidBoqParentError`
   (RFC 7807 400 `INVALID_BOQ_PARENT`), а не молчаливый standalone/dangling. Source
   parent UUID никогда не попадает в целевой тендер. `total_amount` считается уже
   **после** восстановления связей, поэтому «effective parent в calc == persisted parent».
6. **Одна транзакция.** Порядок: read source → validate parents → insert (без derived) →
   remap parents → recompute `total_amount` → position totals → commercial → grand total
   (**ровно один раз** на реально изменённый тендер) → commit. Операция **не возвращает
   success до завершения авторитетного расчёта**.
7. **Async queue — не источник корректности.** Кэш инвалидируется только после успешного
   commit и только для затронутого тендера (он известен из операции, а не выводится из
   обновлённых строк). При ошибке кэш не чистится и recalc не ставится в очередь как
   компенсация.
8. **Затронутые тендеры:** copy — same-tender (один тендер); version transfer — создаёт
   **новый** тендер-версию, source **не изменяется** (это copy, не move) и не пересчитывается.

Защита от регресса: `scripts/checks/noDerivedCopy.check.mjs` (падает, если copy/transfer
снова начнут селектить/вставлять derived-колонки, заведут свою формулу или FX-фолбэк 1).

## 7b-bis. Архив смет — composition из чужих тендеров

`POST /api/v1/archive/compose` (`archive_compose*.go`) собирает позиции целевого тендера
из исторических позиций **других** тендеров. Инварианты те же, что в §7b, плюс специфика
кросс-тендерного переноса и масштабирования:

1. **Class A only.** Копируются те же исходные поля, что в §7b. Дополнительно **не**
   копируются: `import_session_id` (FK на чужую сессию импорта — `ON DELETE SET NULL`
   чужой сессии иначе мутировал бы этот тендер) и по умолчанию `quote_price_date` /
   `quote_valid_until` (даты источника цены многолетней давности искажают аналитику
   свежести; opt-in `options.copy_quote_dates`, копируются обе или ни одной из-за CHECK
   `quote_valid_until >= quote_price_date`). `sort_number` перенумеровывается: в одну
   целевую позицию можно слить N источников, исходные номера столкнулись бы.
2. **Валюта не конвертируется.** `unit_rate` и `currency_type` переносятся как есть,
   курс применяется целевой (`RecomputeBoqTotalAmountsTx`). Конвертация `unit_rate`
   переместила бы конфигурационное значение во входную колонку: `tender_reprice.go`
   пересчитывает все строки при смене курса и умножил бы такую строку второй раз, а
   подмена `currency_type` на `RUB` уничтожила бы провенанс цены для `price_benchmark`
   и `price_source_quality`. Нет курса у цели → 400 `MISSING_FX_RATE` и полный откат —
   это правильное fail-closed поведение, а не дефект. `delivery_amount` при `'суммой'`
   не масштабируется и не конвертируется: это per-unit рублёвая величина.
3. **Масштабирование количеств.** Работы и самостоятельные материалы: `quantity * k`
   (`k` = `factor` либо `target_volume / source_volume`, объёмы по умолчанию
   `COALESCE(manual_volume, volume)`). Привязанный к работе материал **пере-выводится**
   из уже масштабированного родителя: `parentQty * conversion * consumption` — формула
   `RecomputeLinkedMaterialsForWork`. Умножать хранимое количество ребёнка на `k` нельзя:
   `calc` принудительно считает `consumption = 1` при наличии родителя, потому что расход
   уже зашит в `quantity`. Пере-вывод даёт идемпотентность — последующий
   `recompute-linked-materials` не меняет ничего. Расхождение с `quantity * k` даёт
   предупреждение `LINKED_QUANTITY_REDERIVED` (источник был рассогласован).
   `base_quantity` привязанной строки принудительно NULL.
4. **`quantity > 0` — жёсткий CHECK.** Если после масштабирования и округления
   (`options.quantity_decimals`) количество становится нулевым — 400
   `ARCHIVE_QUANTITY_UNDERFLOW` до любой записи. Молчаливый кламп к минимуму запрещён.
5. **Одна группа = одна целевая позиция.** Диктуется FK `boq_items_parent_scope_fkey`:
   связь материал → работа не может пересекать позицию, поэтому и ремап родителей
   возможен только внутри одной позиции. Родители валидируются существующим
   `ResolveCopiedParents` в пределах каждого источника; исключение родительской работы
   через `source_item_ids` даёт 400 `INVALID_BOQ_PARENT`.
6. **Порядок в транзакции** совпадает с §7b: `SET LOCAL statement_timeout = '0'` →
   `setAuditUser` → `skipBoqAuditTrigger` → `MarkTenderFinancialInputsChangedTx`
   (**одна** ревизия на команду) → план (read-only) → INSERT позиций → INSERT строк без
   derived-колонок → bulk-remap родителей → `RecomputeBoqTotalAmountsTx` →
   `RecomputePositionTotalsForTenderTx` → аудит → `MaterializeCommercialForTenderTx` →
   `RecalculateTenderGrandTotalTx` (ровно один раз) → `MarkTenderCalculationSucceededTx`
   → commit. Тендеры-источники не изменяются и ревизию не получают.
7. **`dry_run` — та же транзакция с Rollback.** Отдельного «симулятора» нет намеренно:
   CHECK-констрейнты срабатывают только на реальном INSERT, а `RecomputeBoqTotalAmountsTx`
   специально перечитывает записанные строки — считать «как было бы» без вставки значило
   бы развести расчётный путь надвое. Откат не оставляет аудита и ревизии и не рассылает
   realtime (NOTIFY транзакционный). Id новых строк в `dry_run` наружу не отдаются.
8. **Async queue — не источник корректности.** Кэш инвалидируется только после успешного
   commit и только при `dry_run = false`; `enqueueRecalc` не нужен — авторитетный пересчёт
   уже прошёл в той же транзакции.

Защита от регресса: те же `scripts/checks/noDerivedCopy.check.mjs` и
`scripts/checks/financialRevisionSafety.check.mjs` — файлы `archive_compose*.go` внесены
в их списки.

## 7c. Audit rollback — авторитетный пересчёт (этап 0.1.2.2b)

`boq_audit_rollback.go` больше не реинсертит весь `old_data` через
`jsonb_populate_record`, а UPDATE-rollback больше не идёт клиентским snapshot'ом
через PATCH.

1. **Семантика:** audit rollback = «восстановить пользовательские входы из
   исторической записи и пересчитать результат с текущими курсами, текущей
   конфигурацией тендера и текущей версией расчётного движка». Это НЕ
   исторический calculation replay: точное воспроизведение старого финансового
   результата потребует `calculation_run`, snapshot входов/конфигурации, FX
   snapshot и версию движка — отдельный будущий этап.
2. **Единственный источник snapshot — сервер.** Команда клиента несёт только
   audit id (`POST /api/v1/boq-audit/{auditId}/rollback`, тело игнорируется);
   сервер сам читает `old_data` из `boq_items_audit`. `before_data`/`after_data`
   /произвольный patch от клиента не принимаются.
3. **Explicit allowlist** (`boqAuditInputAllowlist`): восстанавливаются только
   перечисленные входы (тип, количества, коэффициенты, расценка, валюта,
   delivery, номенклатура, категория затрат, parent, sort, описание/ссылки).
   Derived (класс B: `total_amount`, `commercial_markup`,
   `total_commercial_*`) непредставимы в плане восстановления. Identity (класс
   C: `id`, `tender_id`, `client_position_id`, timestamps, `import_session_id`)
   верифицируются, но не применяются слепо; неизвестный JSON-ключ никогда не
   попадает в SQL. Динамический SET из ключей snapshot запрещён.
4. **Операции:** UPDATE — восстановить входы существующей строки (позиция и
   тендер не меняются); DELETE — реинсерт с исходным id (контракт сохранения
   parent-ссылок), только входы, derived-колонок нет в INSERT-списке; INSERT
   undo — не поддерживается (`UNSUPPORTED_BOQ_AUDIT_ROLLBACK`).
5. **Ownership:** audit ↔ item ↔ tender проверяются
   (`BOQ_AUDIT_TARGET_MISMATCH`, 409, без утечки данных чужого тендера);
   cross-tender move через rollback невозможен.
6. **Parent integrity** — тот же инвариант, что у Template Insert / Copy /
   Transfer: parent существует, в том же тендере и позиции, является работой,
   не сам элемент. Невалидный исторический parent → блокирующая
   `InvalidBoqParentError`; фолбэка parent=NULL нет.
7. **Legacy snapshots** (полная форма `to_jsonb(OLD.*)` триггера и форма
   `boqRowJSON` Go-писателя) парсятся строго: неверный тип/enum/uuid →
   `INVALID_BOQ_AUDIT_SNAPSHOT` (400), отсутствие обязательного входа → typed
   error; отсутствующее optional-поле получает канонический default текущей
   модели, а не 0/RUB/«мат». FX=1 не подставляется.
8. **Одна транзакция.** Порядок: план/валидация → применение входов →
   `RecomputeBoqTotalAmountsTx` (текущие FX, fail-closed `MISSING_FX_RATE`) →
   итоги позиции → `MaterializeCommercialForTenderTx` (текущая
   тактика/проценты/distribution) → `recalculate_tender_grand_total` ровно один
   раз → новая audit-запись о самом rollback (старая запись immutable; поля
   rollback_of в схеме нет — связь не персистится, миграции не добавлялись) →
   commit. При любой ошибке — полный rollback: строка, итоги, commercial,
   grand total и кэш не меняются, success не возвращается.
9. **Async queue — не источник корректности**; кэш инвалидируется только после
   успешного commit.

Защита от регресса: `scripts/checks/noDerivedAuditRollback.check.mjs` (падает,
если rollback снова начнёт писать derived-колонки из snapshot, вернёт
`jsonb_populate_record`, свою формулу, FX-фолбэк 1 или клиентский snapshot).

Остаётся в backlog (вне 0.1.2.2b): ~~вывод legacy SQL RPC commercial writer~~
(✅ закрыто в 0.1.2.2c, см. §7d), frontend redistribution, `updated_at`/ETag
после серверных recalc, конкурентные stale-recalc, calculation versioning
(`calculation_run` для точного replay).

## 7d. Legacy SQL RPC commercial writer — retired (этап 0.1.2.2c)

`public.bulk_update_boq_items_commercial_costs(p_rows jsonb)` **retired**:
последний DB-level путь записи `commercial_markup` /
`total_commercial_material_cost` / `total_commercial_work_cost` мимо серверного
расчётного контура закрыт.

1. **Tombstone, не DROP.** Имя и сигнатура сохранены на переходный период ради
   внешних stale callers: любой вызов — включая `NULL`, `[]`, `{}`, валидный
   старый payload, чужие/несуществующие id — всегда завершается
   **SQLSTATE 0A000, message `COMMERCIAL_COST_WRITE_RETIRED`** до чтения
   `p_rows`. Никакой mutation, никакого «0 = успех», никакого silent no-op.
2. **NULL не обходит tombstone:** функция объявлена `CALLED ON NULL INPUT`
   (НЕ `STRICT`) — иначе PostgreSQL вернул бы `NULL` без выполнения тела.
   Также `SECURITY INVOKER` (прав владельца не наследует, в отличие от старого
   `SECURITY DEFINER`-writer'а) и фиксированный `search_path`. Вызов даже
   owner-ролью падает — корректность не зависит от grants.
3. **Два уровня схемы:** baseline `db/yandex/sql/04_functions.sql` (fresh
   install сразу создаёт tombstone) и идемпотентная транзакционная миграция
   `db/yandex/incremental/2026_07_retire_bulk_update_commercial_costs.sql`
   (для существующих установок; повторное применение безопасно; данные
   boq_items не трогает).
4. **ACL:** `REVOKE ALL … FROM PUBLIC` (закрывает и implicit default EXECUTE)
   + динамический отзыв EXECUTE у всех обнаруженных non-owner grantees из
   `proacl` (не полагаясь на известные имена ролей). Runtime ACL production —
   проверять verification query в конце миграции (не выполнялась в 0.1.2.2c).
5. **Единственный активный production writer** commercial-полей —
   `repository.PersistCalculatedCommercialCosts(Tx)`, вызываемый только
   внутренним `CommercialRecalcService` (и transaction-aware
   `MaterializeCommercialForTenderTx`). Retirement RPC его не затрагивает
   (writer пишет прямым SQL, не через RPC).
6. **Generated type** `bulk_update_boq_items_commercial_costs` в
   `src/lib/types/database.types.ts` может оставаться до полного DROP функции —
   это отражение фактической сигнатуры в БД, а **не разрешение на вызов**.
   Production-код её не вызывает; регресс ловит
   `scripts/checks/noCommercialSqlRpc.check.mjs`.
7. **Deployment order:** сначала application code (endpoint 410, callers
   отсутствуют, internal writer отделён — уже в проде с 0.1.2.2), затем SQL
   retirement migration. При rolling deployment старый внешний caller после
   миграции получает явную ошибку, но не может изменить данные. Если
   application откатят на старую версию — RPC остаётся retired, и старый
   caller падает fail-closed: **это намеренное безопасное поведение**.
   Down migration, возвращающая unsafe writer, запрещена; допустим только
   DROP tombstone (тоже fail-closed).
8. **Точный DROP tombstone** — позднее, после подтверждения отсутствия внешних
   stale callers по логам production.

Статус direct-table privileges: клиентских DB-ролей (anon/authenticated) на
Yandex нет — фронт ходит только через Go BFF; runtime-роль бэкенда создаётся
оператором (см. `08_permissions.sql`, no-op) и является trusted server role
internal writer'а, поэтому column-level REVOKE для неё не применяется.
Фактический production ACL таблицы — **UNKNOWN** до выполнения verification
query; пункт добавлен в deployment checklist миграции.

## 7e. Redistribution save — server-authoritative (этап 0.1.2.3a)

`POST /api/v1/redistributions/save` больше **не принимает** рассчитанные
клиентом значения.

1. **Клиент сохраняет только правила** (`tender_id`, `markup_tactic_id`,
   `rules{deductions, targets, position_adjustments}`). Поля `records` /
   `original_work_cost` / `deducted_amount` / `added_amount` /
   `final_work_cost` / `created_by` отсутствуют в request DTO; legacy-поле
   `records` старого клиента молча отбрасывается декодером (rolling
   compatibility) и не может попасть ни в расчёт, ни в repository, ни в БД.
   Actor — только из auth context.
2. **Category-level результаты считает `backend/internal/calc`**
   (`CalculateRedistribution`; Go↔TS parity закреплена golden-фикстурами
   `calc/testdata/redistribution_cases.json` ↔
   `scripts/checks/redistributionParity.check.mjs`; найденный drift —
   отсутствие `boq_item_types`-фильтра в Go — исправлен).
3. **Commercial base синхронно материализуется сервером до redistribution**
   (`MaterializeCommercialForTenderTx`) в той же транзакции; stale-поля
   не используются; `MissingFXRateError` откатывает всё.
4. **Save разрешён только для активной тактики тендера**
   (`tenders.markup_tactic_id`); иначе 409 `REDISTRIBUTION_TACTIC_MISMATCH`.
5. **Одна транзакция:** tender/tactic → typed rules validation (DB-confirmed
   ID, канонические имена, effective BOQ-scopes, дубликаты/overlap) →
   materialization → полный BOQ тендера (ORDER BY id) → calc → инварианты
   (final=orig−ded+add, ≥0, конечность, exact set, детерминированный порядок,
   баланс — несбалансированный результат **не сохраняется**, 409
   `REDISTRIBUTION_UNBALANCED`) → position_adjustments на server-generated базе
   → канонический rules JSON → **атомарный batched replace** (DELETE + один
   UNNEST-INSERT, никаких per-row Exec; exact-set count) → grand total ровно
   один раз → commit. Кэш — только после commit; async queue не источник
   корректности.
6. **Persisted set — полный server-generated:** все BOQ тендера; boq_item_id
   из request не принимается; client placeholder (`fallbackBoqItem`) удалён —
   position-only конфигурация даёт server-generated no-op category-результат.
   Composite FK `(tender_id, boq_item_id) → boq_items` — в backlog DB
   integrity; scope гарантирует writer.
7. **Legacy snapshots не авторитетны:** новый save пишет в rules
   `schema_version=2`, `calculation_source="server"`; GET возвращает
   `status: calculated | requires_recalculation | empty`. Legacy snapshot →
   `requires_recalculation`: CR-страница восстанавливает только правила и
   показывает «Сохранённый расчёт создан старой версией и требует пересчёта»,
   Commerce/FI/exports его не применяют (live calc до нового server save).
   Legacy-строки не удаляются и не перемаркируются без фактического пересчёта.
8. **Position adjustment rules валидируются сервером** (mode/amount/IDs
   текущего тендера/пересечения/последовательная валидация на меняющейся базе;
   `calc.ValidatePositionAdjustments`); server-calculated position deltas
   возвращаются в ответе как diagnostics для 0.1.2.3b, но деньгами не
   персистятся.
9. **SQL RPC `save_redistribution_results` retired** — fail-closed tombstone
   (SQLSTATE 0A000 `REDISTRIBUTION_RESULT_WRITE_RETIRED`, CALLED ON NULL
   INPUT, SECURITY INVOKER, REVOKE PUBLIC + non-owner grants): baseline
   `04_functions.sql` + идемпотентная миграция
   `2026_07_retire_save_redistribution_results.sql` (+ verification query).
   Production ACL — **UNKNOWN** до deployment verification.
10. **TS `calculateDistribution.ts` — UI preview only**; ответ сервера всегда
    побеждает preview; при ошибке backend preview не объявляется сохранённым.

~~**НЕ закрыто в 0.1.2.3a (остаётся на 0.1.2.3b):** финальное position-level
отображение, smart rounding, распределение insurance, prepared rows
Commerce/FI/Excel.~~ → ✅ **закрыто в 0.1.2.3b** (см. §7f).

Защита от регресса: `scripts/checks/noClientRedistributionResults.check.mjs`
(клиентские records/financial-поля в save, financial request DTO, tombstone
обеих схем, production callers RPC) +
`scripts/checks/redistributionParity.check.mjs` (Go↔TS parity).

## 7f. Prepared redistribution pipeline — server-authoritative (этап 0.1.2.3b)

Весь **финансовый** redistribution-pipeline теперь серверный (но НЕ versioned —
см. ограничения ниже):

1. **Один авторитетный движок** — `calc.BuildPreparedRedistribution`
   (`backend/internal/calc/redistribution_prepared.go`), pure-функция без
   БД/env/HTTP. Канонический порядок (порт ЕДИНОГО фронтового pipeline,
   расхождений между CR/Commerce/Excel не было):
   агрегация category-снимка по позициям (`buildResultRows`-семантика:
   обычные позиции + ДОП-строки после родителя; ДОП без родителя
   отбрасывается; item без category-результата проходит с текущей стоимостью)
   → position adjustments (общий валидатор `ValidatePositionAdjustments`,
   последовательные правила на меняющейся базе, works-only)
   → **rounding policy `unit_price_2dp`**: цена за единицу округляется до
   2 знаков (half up), итог = round2(цена × количество); НИКАКОЙ cross-row
   компенсации. Примечание: 5-руб ядро `RoundTo5`/`CompensateError` относится
   к другому legacy-потоку Commerce и НЕ является частью этого pipeline
   (старый комментарий в smartRounding.ts утверждал обратное — канон =
   фактическое production-поведение 2dp)
   → insurance: total = `calc.CalculateInsuranceTotal`
   ((apt+parking+storage)×judicial%×total%, одна строка на тендер — «несколько
   insurance rows» в модели не существует), распределяется пропорционально
   ОКРУГЛЁННОЙ базе работ и добавляется в финальную стоимость работ; нулевая
   база при ненулевом страховании → доли 0 (каноническая policy, видна через
   `is_insurance_fully_allocated=false`)
   → prepared rows (трассируемый breakdown: before/category/adjustments/
   rounding/insurance/final) + summary (каждое поле = Σ строк, проверяется
   валидатором `ValidatePreparedRedistribution`; несоответствие — typed
   internal error, результат не возвращается).
2. **Save и GET используют один движок**: save строит prepared ДО commit
   (ошибка prepared откатывает всю транзакцию, включая materialization);
   GET в одной read-only транзакции перечитывает snapshot+positions+BOQ+
   insurance и вызывает ту же функцию. При неизменной БД
   save.prepared == GET.prepared (bit-identical, integration-тест parity).
   Prepared НЕ персистится (ни новых колонок, ни скрытого snapshot в rules
   JSON) — это server-generated projection.
3. **Статусы GET**: `calculated` (prepared доступен) /
   `requires_recalculation` (legacy снимок ИЛИ server-снимок, входы которого
   изменились и prepared больше не строится — честная деградация вместо 500) /
   `not_configured` (снимка нет). Fallback'ов нет: ни live-frontend-расчёта,
   ни старых client rows, ни частичных итогов.
4. **Маркеры ответа**: `calculation_source="server"`,
   `prepared_schema_version=1`, `rounding_policy="unit_price_2dp"`.
5. **Frontend**: CostRedistribution может показывать локальный preview ТОЛЬКО
   с явным статусом «Предварительный расчёт — не сохранён»; после save/load
   server prepared полностью замещает preview (без merge по полям).
   Commerce/FI/Excel не импортируют и не вызывают preview-калькуляторы
   (`applyRedistributionPipeline`/`computeInsuranceTotal`/
   `computeCumulativePositionDeltas`/`buildResultRows`/`smartRoundResults`) —
   только серверные значения; insurance_total отдаёт GET insurance
   (server-computed). Excel-экспорт блокируется без server prepared
   (`REDISTRIBUTION_EXPORT_NOT_READY`), частичный файл не создаётся.
6. **BOQ commercial-поля НЕ перезаписываются** redistribution-результатом:
   category-снимок живёт в `cost_redistribution_results`, prepared — это
   presentation projection, а не новая себестоимость BOQ (фронт их и раньше
   не мутировал — риска переноса mutation нет).
7. **Известное расхождение preview↔server**: TS preview молча пропускает
   невалидные position-правила (`computeCumulativePositionDeltas`), сервер их
   блокирует typed-ошибкой; сервер авторитетен. Go↔TS числовой drift не
   обнаружен (21 golden-кейс, epsilon 1e-6).
8. **Ограничения → этап 0.1.3** (не решались здесь, без скрытых hash/version
   механизмов): историческое replay prepared-результата, гарантированное
   обнаружение stale snapshot (сейчас — только честная деградация статуса),
   защита от concurrent save/recalc, calculation_run/input_revision,
   updated_at/ETag.
9. SQL redistribution RPC остаётся retired; client-calculated records —
   запрещены (guards этапов 0.1.2.3a/b продолжают действовать).

Защита от регресса: `scripts/checks/noClientPreparedRedistribution.check.mjs`
(импорты/вызовы preview-калькуляторов в Commerce/FI/Analytics/Excel, prepared-
поля в save-запросе и request DTO, гейт экспорта) +
`scripts/checks/redistributionPipelineParity.check.mjs` (Go↔TS parity полного
pipeline на общих fixtures).

## 7g. Fail-closed prepared states (этап 0.1.2.3b.1)

Закрыты четыре fail-open сценария prepared-pipeline:

1. **Exact-set snapshot.** Server category snapshot обязан быть полным:
   `calc.ExpectedRedistributionBoqItems` — ЕДИНАЯ классификация expected-набора
   (в текущей модели — каждый BOQ item тендера, исключённых классов нет; новый
   класс расширяет helper, а не создаёт pass-through). Missing/extra строка →
   typed `RedistributionSnapshotSetMismatchError`; **pass-through текущими
   commercial values запрещён** и удалён; частичный summary не строится.
   SAVE: mismatch после свежего расчёта — internal invariant, полный rollback.
   GET: `status=requires_recalculation`, `reason=SNAPSHOT_SET_MISMATCH`,
   prepared=nil (не 500; typed context логируется zerolog'ом, в API не течёт).
2. **ДОП-позиции.** «ДОП» = additional client_positions (не boq_item_type);
   их BOQ несёт реальные деньги. Финансовая значимость определяется наличием
   BOQ items, а не наличием parent: cost-bearing ДОП без разрешимого
   regular-родителя → typed error `ADDITIONAL_POSITION_PARENT_MISSING`
   (никакого silent drop); пустая ДОП (без items — нулевая финансовая база по
   построению) может отбрасываться как presentation-only. Ненулевая строка не
   может исчезнуть из prepared result/summary (regression-тесты).
3. **Insurance zero-base policy.** `insurance_total==0` — любая база валидна;
   `insurance_total>ε` при `eligible base≤ε` → typed
   `InvalidInsuranceAllocationError{NON_ZERO_INSURANCE_WITH_ZERO_BASE}`:
   SAVE — rollback, GET — requires_recalculation/`INSURANCE_ALLOCATION_INVALID`
   без prepared. Conservation-инвариант безусловен:
   |Σ insurance_amount − insurance_total| ≤ ε — «calculated» с
   нераспределённым страхованием невозможен.
4. **Статусы разделены.** GET-контракт: `{status, reason, message, prepared}`;
   reason-коды стабильны (`LEGACY_SNAPSHOT | SNAPSHOT_SET_MISMATCH |
   PREPARED_INPUT_CHANGED | INSURANCE_ALLOCATION_INVALID |
   PREPARED_CALCULATION_FAILED`), фронт ветвится по коду, не по тексту.
   Единая политика потребления —
   `resolveRedistributionConsumptionState` (`src/lib/redistribution/
   consumptionState.ts`), обязательная для Commerce/FI/exports:
   - `calculated`: server prepared, экспорт разрешён;
   - `not_configured`: база видима ТОЛЬКО как база (не как результат
     перераспределения), redistribution-specific export недоступен, общий
     base-export допустим;
   - `requires_recalculation`: final-итоги «—», база НЕ подставляется как
     final, один Alert («Расчёт перераспределения устарел или неполон…» /
     reason-специфичный), **все** exports с final redistributed values
     блокируются (`REDISTRIBUTION_RECALCULATION_REQUIRED`, файл не создаётся);
     никакого fallback на preview/live/базу, никакого схлопывания в
     not_configured.
   Commerce показывает пометку «значения ДО перераспределения»; FI: все
   показатели — класс A (не зависят от prepared snapshot; insurance — только
   конфигурационный вход), новый redistribution-dependent показатель обязан
   идти через политику (см. комментарий-классификацию в
   useFinancialCalculations).

Без input_revision snapshot может быть stale даже при совпадающем set —
остаётся этапом 0.1.3.

Защита от регресса: `scripts/checks/failClosedPreparedRedistribution.check.mjs`
(pass-through, parent-only drop, zero-base insurance, единая политика, гейты
экспорта, reason-коды) + `scripts/checks/redistributionConsumptionState.check.mjs`
(truth-table политики).

## 7h. cached_grand_total — единственная формула в calc (этап 0.1.2.4a / 0.1.2.4a.1)

1. **Семантика:** `cached_grand_total = round2dec(Σ(total_commercial_material_cost
   + total_commercial_work_cost) + текущее страхование тендера)`. Входы —
   materialized server-generated commercial values; insurance — ровно один раз
   через единое ядро `insuranceTotalRat` (`calc/money_decimal.go`; decimal-API
   `CalculateInsuranceTotalDecimal` для авторитетного пути, float-API
   `CalculateInsuranceTotal` — compatibility wrapper над тем же ядром);
   redistribution prepared values / position adjustments в итог НЕ входят;
   markup/НДС уже внутри materialized commercial и повторно не применяются.
   Это ПОСЛЕДНИЙ успешно materialized итог, не исторический snapshot
   (input_revision — 0.1.3). Семантика 0.1.2.4a не менялась — 0.1.2.4a.1
   исправил только граничный баг округления.
2. **Политика округления (0.1.2.4a.1): DECIMAL half away from zero, 2 знака,
   ровно один раз в конце** (`RoundMoney2Decimal`, точная рациональная
   арифметика stdlib `math/big.Rat`): `0.005→0.01`, `1.005→1.01`, `1.015→1.02`,
   `2.675→2.68`, `100.555→100.56` — эквивалентно PostgreSQL `ROUND(numeric,2)`
   (закреплено integration-тестом `TestCachedGrandTotal_DecimalRoundingParity`;
   на 2026-07-14 БЕЗ тестовой БД он NOT EXECUTED — compiled+SKIP). float64 на
   авторитетном пути НЕ авторитетен: `math.Round(x*100)/100` давал `1.005→1.00`
   (зафиксированный красный regression) и запрещён guard'ом вместе с
   epsilon-хаками; никакого двойного округления. Публичные JSON DTO остаются
   `number`, но деривируются ТОЛЬКО после финального decimal-округления
   (`Result.RoundedTotalDecimal` — канонический персистируемый string).
3. **Формула только в calc:** `CalculateCachedTenderGrandTotal`
   (`calc/cached_grand_total.go`) — pure, входы `numeric::text`-строки, typed
   errors (`INVALID_CACHED_GRAND_TOTAL_INPUT`:
   MALFORMED_DECIMAL/NEGATIVE_VALUE/NOT_FINITE/OVERFLOW — без fallback 0;
   пустая строка = MALFORMED, fail-closed), breakdown для диагностики. НЕ
   путать с legacy `calc.CalculateGrandTotal` — это FI formula breakdown
   (отдельный путь, разбор в 0.1.2.4b; помечен комментарием).
4. **Один writer:** `repository.RecalculateTenderGrandTotalTx(ctx, Querier,
   tenderID)` — один aggregate-запрос по BOQ (material/work раздельно,
   `SUM(...)::text` — без float64), один запрос insurance (`::text`), calc,
   один UPDATE уже округлённой канонической decimal-строки
   (`$1::numeric`, string-bind — без SQL ROUND и повторного округления),
   RowsAffected==1 (typed CACHED_GRAND_TOTAL_TENDER_NOT_FOUND /
   WRITE_MISMATCH).
5. **Матрица мутаций.** Категория A (пересчёт в той же tx, один раз на тендер):
   commercial writer, redistribution save, copy/clone/transfer, audit
   rollback, import, **DeleteBoqItem**, **BulkDeletePositions/ClearPositionsBoq**
   (затронутые тендеры определяются ДО каскадного удаления), **insurance
   Upsert** (валидация конфигурации через calc до записи; невалидная → rollback,
   RFC7807 INVALID_INSURANCE_CONFIGURATION; никакого «commit → async recalc
   позже»). Категория B (входы: quantity/rate/FX, markup/tactic/distribution/
   exclusions, create/update BOQ, template insert): существующий async
   commercial recalc сохраняется; итог остаётся последним materialized
   значением — SQL-формула по старым commercial больше НЕ выдаётся за свежий
   пересчёт (это и делали удалённые триггеры markup/exclusions); stale
   detection — 0.1.3. Категория C (metadata/notes/документы/prepared
   projection): пересчёта нет. Delete тендера: пересчёт не нужен, skip-GUC
   удалён.
6. **SQL retired:** `public.recalculate_tender_grand_total(uuid)` — fail-closed
   tombstone (SQLSTATE 0A000 `GRAND_TOTAL_SQL_RETIRED`, CALLED ON NULL INPUT,
   SECURITY INVOKER, REVOKE PUBLIC + non-owner grants); 4 grand-total триггера
   и их функции УДАЛЕНЫ (вторая формула, O(N) per-row SUM, пересчёт по
   несвежим commercial); `app.skip_grand_total` больше никем не читается и не
   выставляется. Baseline (04_functions/05_triggers) + идемпотентная миграция
   `2026_07_retire_sql_grand_total_recalc.sql` (порядок: triggers → trigger
   functions → tombstone → grants; verification query внутри). Deployment:
   сначала полный application rollout 0.1.2.4a, затем миграция; down migration
   с формулой запрещена.
7. **Readers (double-count audit):** tender lists/registry/Admin Tenders/
   useTenderData — отображают значение как есть (fallback `|| 0` — display
   only); insurance/VAT/prepared повторно НЕ добавляются нигде.
   FinancialIndicators cached_grand_total НЕ читает — считает собственный
   legacy breakdown (computeIndicators + insurance config) — расхождение
   семантики зафиксировано как отдельный путь и переходит в 0.1.2.4b
   (серверный FI breakdown, унификация VAT/итогов).

Защита от регресса: `scripts/checks/canonicalCachedGrandTotal.check.mjs`
(SQL-callers, дубли формулы/insurance/ROUND, единственный UPDATE-writer,
baseline tombstone/триггеры, skip_grand_total, frontend-пересчёт; 0.1.2.4a.1 —
на decimal-границе запрещены `math.Round`/epsilon/`ParseFloat`/float64,
обязательны `::text`-агрегаты и string-bind `RoundedTotalDecimal`).

## 7i. Импорт BOQ и изменение валютного курса (этап 0-F1)

1. **Импорт передаёт только inputs** (quantity, unit_rate, currency,
   коэффициенты, доставка, связи). `total_amount` от клиента/Excel —
   **только диагностика** (обратная совместимость): в INSERT его нет, fallback'ом
   не служит, на расчёт не влияет.
2. **Persisted total всегда считает calc**: после INSERT'ов строки
   пересчитываются в той же tx через `RecomputeBoqTotalAmountsTx`
   (persisted inputs + реальные parent-связи, курсы тендера загружаются один
   раз, один bulk UPDATE), затем `RecomputePositionTotalsForTenderTx` и
   `RecalculateTenderGrandTotalTx`. Import atomicity — all-or-nothing:
   любая ошибка (MISSING_FX_RATE, invalid parent, NaN-контроль, DB) откатывает
   всё; commercial материализует существующий async recalc (категория B).
3. **Mismatch report**: расхождение client total vs server calc >
   `ImportTotalMismatchTolerance` (0.01) → warning-запись
   (row/name/client/server/Δ/Δ%) в ответе импорта и в модалке; не ошибка,
   значение в БД всегда серверное.
4. **Изменение курса (usd/eur/cny) атомарно**: оба пути записи (PATCH tenders
   и admin-patch) при изменении курса выполняют в одной tx
   `repriceTenderAfterRateChangeTx`: rates → BOQ totals → position totals →
   commercial (`MaterializeCommercialForTenderTx`) → `cached_grand_total` →
   commit; cache-инвалидация и success — только после commit. Частичное
   применение невозможно.
5. **FX fail-closed**: новый курс, делающий существующую строку
   нерассчитываемой (null/0 при наличии строк в этой валюте) → 400
   `MISSING_FX_RATE`, полный rollback (старые rates/totals/commercial/cached
   сохранены). Async-очередь recalc — идемпотентный ДОП. механизм, не источник
   корректности.
6. Клиентский FX fallback `|| 1` и клиентский расчёт `total_amount` удалены из
   mass-import фронта.

Защита от регресса: `scripts/checks/serverAuthoritativeImportFx.check.mjs`
(INSERT без client total/commercial, calc-pipeline в tx импорта, полный
reprice-pipeline, admin-паритет, отсутствие FX fallback=1, payload только с
inputs). Следующий этап **0-F2** (финальный): stale/concurrent guard, approval
invalidation, финальная приёмка.

## 7j. Financial revision model — финальное закрытие этапа 0 (0-F2)

1. **Схема**: `tenders.financial_input_revision` (+1 на каждую пользовательскую
   финансовую команду, НЕ на строку batch'а), `financial_calculation_revision`
   (ревизия входов последнего успешного расчёта), `financial_calculation_status`
   (`calculated | stale | calculating | failed`, CHECK), `started_at /
   calculated_at / error_code / error_message`; CHECK `calc_rev <= input_rev`.
   Миграция `2026_07_financial_calculation_revision.sql` (идемпотентна,
   выполнена дважды на приёмочной БД).
2. **Центральный helper** `MarkTenderFinancialInputsChangedTx` — ЕДИНСТВЕННЫЙ
   способ зафиксировать финансовое изменение: в одной tx с мутацией (+1
   revision, stale, очистка error, **инвалидация согласования**:
   approved=false/by=NULL/at=NULL; факт инвалидации активного approval пишется
   в structured log — отдельной tender-audit таблицы нет, схема не расширена).
3. **Старый расчёт не может перезаписать новые входы**:
   `MarkTenderCalculationSucceededTx` — CAS `WHERE financial_input_revision =
   calculatedRevision`; провал → typed `StaleCalculationResultError`, ВСЕ
   derived-записи расчёта откатываются, latest revision re-enqueue'ится.
   Фоновая ошибка → `MarkTenderCalculationFailedIfCurrent` (failed только для
   текущей ревизии; без stack trace/SQL в message).
4. **Сериализация recalc** (`RecalcTenderCommercialAuthoritative`): session
   advisory lock (`pg_advisory_lock(42001, hashtext(tender_id))`) на выделенном
   соединении, взятый ДО начала ОДНОЙ REPEATABLE READ tx (lock-then-begin —
   иначе второй job получил бы pre-lock snapshot); чтение ревизии → no-op при
   актуальном расчёте → compute из того же snapshot → внутренний writer →
   grand total → CAS → commit. Кросс-процессно; lock умирает с соединением
   (crash не подвешивает тендер); индикативный status='calculating' ничего не
   блокирует. Два конкурентных job'а: один calculated, второй no-op
   (интеграционно доказано на живой БД).
5. **Категории мутаций**: A (async: BOQ create/update/delete, batch clear,
   mass import, template insert, linked-materials, markup tactic/percentages/
   pricing distribution/subcontract exclusions, admin tactic) — mark → commit →
   enqueue; B (sync full: FX reprice regular+admin, audit rollback, copy,
   version transfer, insurance, redistribution save) — mark → change → полный
   расчёт → success CAS в той же tx. Presentation-изменения ревизию не
   трогают.
6. **Redistribution marker**: SaveAuthoritative штампует canonical rules
   `financial_input_revision: N` (repo-обогащение, calc-форма не менялась);
   GET при несовпадении с текущей ревизией →
   `requires_recalculation / INPUT_REVISION_CHANGED` (ловит stale snapshot при
   неизменном BOQ-set); approve тоже проверяет marker (REDISTRIBUTION_STALE).
7. **Approval**: разрешён только при status=calculated ∧ calc_rev=input_rev ∧
   нет error ∧ redistribution snapshot (если настроен) актуален; иначе RFC 7807
   **409 FINANCIAL_CALCULATION_NOT_READY** (calculationStatus/inputRevision/
   calculationRevision/reason). Любая финансовая мутация автоматически снимает
   approval (история не удаляется).
8. **UX**: единая политика `src/lib/financial/calculationState.ts`
   (`resolveFinancialCalculationState`) — calculated/stale/calculating/failed;
   stale/failed/calculating блокируют approve + final exports, суммы подписаны
   «Последний рассчитанный итог»; fail-closed (неизвестный статус = stale).
   Подключено: FinancialIndicators (approve + Alert), Commerce (final-export
   gate + Alert), CostRedistribution (через INPUT_REVISION_CHANGED reason).
9. **ETag**: derived commercial writer (`PersistCalculatedCommercialCostsTx`)
   больше НЕ трогает `boq_items.updated_at` — пользовательский ETag меняют
   только input-мутации (интеграционно доказано).
10. **Проекция состояния — часть контракта, а не деталь запроса** (август 2026).
    Политика фронта fail-closed, поэтому НЕотданная колонка неотличима от
    честного «расчёт устарел»: `financial_calculation_status` приезжает как `""`,
    `?? 'stale'` его не ловит, и гейт закрывается навсегда при здоровой БД.
    Ровно это и произошло: `ListTenders` остался со своим рукописным списком
    колонок, `GET /api/v1/tenders` отдавал пустой статус, и «Форма КП»
    блокировала финальный экспорт для каждого тендера. Проекция теперь одна —
    `repository.tenderFinancialCols`, из неё же строится `tenderScanCols`;
    любой новый запрос, наполняющий `TenderRow`, обязан её включать
    (`financial_calculated_at` — только с `::text`, поле `*string`).
    Следствие для UI: страница обязана брать статус из перечитываемого
    источника. Commerce берёт его из per-tender чтения внутри `loadPositions`
    (повторяется на realtime/focus/смене тактики), а не из списка тендеров,
    который грузится один раз на маунте.

Защита от регресса: `scripts/checks/financialRevisionSafety.check.mjs`
(17 mutation paths → central helper; CAS в recalc и отсутствие безусловного
'calculated'; approval-гейты; stale+enqueue импорта; revision marker;
frontend shared policy; derived writes не трогают updated_at; §11 — list-проекция
несёт все шесть 0-F2 колонок) + `backend/internal/repository/tender_list_query_test.go`
(проекция и порядок аргументов, без тестовой БД).

## 8. Что сделано в 0.1.2 (только безопасное)

- Исправлен вводящий в заблуждение комментарий `boq_amount.go` («trigger-computed» → app-computed).
- Проставлены баннеры `// UI preview only.` на всех preview-калькуляторах и ⚠️-предупреждение
  на `calculateDistribution.ts` (персист-путь).
- Добавлены parity/rounding regression-тесты (Go + focused TS-check).
- Создан этот документ.

Никакие денежные формулы не переносились и не удалялись; БД/структура/импорт не менялись.

## Связанный инструмент (этап 2.1)

Серверный мастер «Умный импорт BOQ» (анализ Excel, mapping, нормализация,
повторный серверный parse при execute) описан в
[SMART_BOQ_EXCEL_IMPORT.md](SMART_BOQ_EXCEL_IMPORT.md); финансовый результат
по-прежнему считает только контур этапа 0.
