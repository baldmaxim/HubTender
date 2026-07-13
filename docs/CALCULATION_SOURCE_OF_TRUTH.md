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
| `import_boq.go BulkImport` | total_amount **от клиента** | ❌ нет | **HIGH** | **этап 0.2 (импорт)** |
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
| `tender_recalc.go` / SQL grand total | `ROUND(x,2)` (копейки) | ок (by design) | нет (консолидировать формулу — backlog) |
| `cbr/client.go round2` | `math.Round(x*100)/100` | ок (FX ingestion) | нет |
| TS `smartRounding.ts roundTo2` | 2 dp для UI | display-only | нет |
| TS `markupCalculator.ts` | сохраняет JS-float семантику (1:1 с Go) | ок | нет |

**Критические сценарии** (проверены тестом `rounding_scenarios_test.go`): `100.555`, `100.554`,
`0.005`, `0.0049` — все считаются одинаково в Go `math.Round` и JS `Math.round` для
**положительных** значений (half-up == half-away). Расхождение Go↔JS возможно только на
**отрицательных** `.5` (Go — away-from-zero, JS — toward +∞); денежные суммы здесь
положительны, поэтому риска нет. **Банковского округления в проекте нет** — везде
арифметическое (half-up); двойного округления в одном пути не обнаружено.

## 6. Float в деньгах (аудит §5)

Проект использует `float64` (Go) / `number` (TS) для денег — **осознанно, decimal-миграция
вне этого этапа**. Классификация:

- **A. Безопасно** (UI, графики, проценты, отображение): все preview-зеркала, экспортеры,
  `computeIndicators`, `useCommerceData`, `buildResultRows`.
- **B. Опасно** (сохранение/сравнение/округление денег): пути записи `total_amount` и
  commercial. Смягчено тем, что авторитетный путь — `calc/` на сервере с одинаковой
  float-семантикой Go↔TS (тесты фиксируют идентичность). Полный переход на decimal —
  **отдельный этап**, не здесь.

## 7. Конфликты, требующие ОТДЕЛЬНОГО этапа (backlog)

Ничего из этого не удалялось/не переносилось в 0.1.2 (гарантия «постепенно, без
удаления старых функций и без изменения БД»):

1. **Redistribution пишется с фронта.** `cost_redistribution_results` заполняется
   клиентской математикой (`calculateDistribution.ts`) без серверного пересчёта, хотя
   `calc/redistribution.go` готов. → перенести расчёт в BFF, пересчитывать/валидировать
   при сохранении.
2. **Grand total + insurance — два экземпляра** (Go `tender_recalc.go` ⇄ SQL
   `recalculate_tender_grand_total`), формула не в `calc/`. → вынести insurance/Σcommercial
   в `calc/`, оставить один владелец; SQL-триггер — снять в этапе работы с БД.
3. ~~**`template_insert.go`** legacy-формула~~ → ✅ **закрыто в 0.1.2.1**: путь переведён на
   `calc.CalculateBoqItemTotalAmount`, effective parent определяется до INSERT, FX блокирует.
4. **Импорт BOQ** доверяет `total_amount` клиента (`import_boq.go`, mass/single import). →
   **этап 0.2**.
5. ~~**`PATCH /items/bulk-commercial`** — сырой client-write commercial~~ → ✅ **закрыто в 0.1.2.2**
   (endpoint retired, 410; см. раздел «Коммерческие стоимости» ниже). **Но остаётся**
   латентный DB-level bypass: SQL-функция `public.bulk_update_boq_items_commercial_costs`
   **не удалена** — снимать в отдельном DB-подэтапе.
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
6. **Латентный DB bypass остаётся:** SQL-функция
   `public.bulk_update_boq_items_commercial_costs(p_rows jsonb)` **всё ещё существует**
   в `db/yandex/sql/04_functions.sql`. Она не удалена, миграции не применялись, grants из
   репозитория не видны (**UNKNOWN**), приложение её не вызывает. Пока функция есть,
   **нельзя утверждать, что DB-level bypass закрыт** — это отдельный DB-подэтап.
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

Остаётся в backlog (вне 0.1.2.2b): вывод legacy SQL RPC commercial writer,
frontend redistribution, `updated_at`/ETag после серверных recalc, конкурентные
stale-recalc, calculation versioning (`calculation_run` для точного replay).

## 8. Что сделано в 0.1.2 (только безопасное)

- Исправлен вводящий в заблуждение комментарий `boq_amount.go` («trigger-computed» → app-computed).
- Проставлены баннеры `// UI preview only.` на всех preview-калькуляторах и ⚠️-предупреждение
  на `calculateDistribution.ts` (персист-путь).
- Добавлены parity/rounding regression-тесты (Go + focused TS-check).
- Создан этот документ.

Никакие денежные формулы не переносились и не удалялись; БД/структура/импорт не менялись.
