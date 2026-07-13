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

### Вставка шаблона (этап 0.1.2.1)

- Библиотека шаблона хранит **только исходные параметры** (unit_rate, currency,
  delivery, consumption, conv_coeff) — она **никогда** не хранит и не поставляет
  денежный итог.
- `total_amount` **всегда** вычисляется `calc.CalculateBoqItemTotalAmount` — те же
  правила, что и у обычного `CreateBoqItem` (consumption, delivery-матрица, FX).
- Отсутствующий/нулевой валютный курс **блокирует всю вставку** (`MissingFXRateError`
  → RFC 7807 400 `MISSING_FX_RATE`). FX-фолбэка `1.0` больше нет.
- Операция **атомарна**: ошибка любой строки откатывает транзакцию — не остаётся ни
  строк, ни audit-записей, totals не меняются, recalc/cache не трогаются.
- Курсы валют читаются **один раз** на всю операцию (без N+1).

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
| `boq_bulk.go BulkUpdateCommercial` | commercial от клиента | ❌ нет | HIGH (by-design) | endpoint-escape-hatch — **backlog** |
| `redistribution.go SaveResults` | redistribution от клиента | ❌ нет | **HIGH** | **backlog** (см. §7) |
| `tender_recalc.go RecalculateTenderGrandTotal` | Σcommercial + insurance, ROUND(,2) | ❌ нет | MED | дубль с SQL — **backlog** |
| `position_costs.go GetPositionsWithCosts` | base/commercial/markup% (read-only) | ❌ нет | MED (read-only) | display-агрегат |
| `boq_copy.go`, `tender_transfer_boq.go` | verbatim-копия money | N/A | LOW | копия, ок |
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
5. **`bulk_update_boq_items_commercial` / `PATCH /items/bulk-commercial`** — сырой write
   commercial без проверки против `calc`. Фронт больше не вызывает; endpoint остаётся. →
   валидировать против `calc` или закрыть.
6. **Superseded SQL RPC** (`insert/update_boq_item_with_audit`, `get_positions_with_costs`,
   `execute_version_transfer`, `bulk_*`) всё ещё в БД → латентный bypass. → снять в этапе БД.
7. **Дублированный type→bucket сплит** `SUM(total_amount) FILTER (type IN …)` в
   `position_recompute.go`, `template_insert.go`, `boq_copy.go` и 2 SQL-функциях. →
   централизовать (в `calc` есть `IsWorkBoqType`/`IsMaterialBoqType`).

## 8. Что сделано в 0.1.2 (только безопасное)

- Исправлен вводящий в заблуждение комментарий `boq_amount.go` («trigger-computed» → app-computed).
- Проставлены баннеры `// UI preview only.` на всех preview-калькуляторах и ⚠️-предупреждение
  на `calculateDistribution.ts` (персист-путь).
- Добавлены parity/rounding regression-тесты (Go + focused TS-check).
- Создан этот документ.

Никакие денежные формулы не переносились и не удалялись; БД/структура/импорт не менялись.
