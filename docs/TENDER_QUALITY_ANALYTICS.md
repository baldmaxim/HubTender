# Tender Quality Analytics — MVP (этап 1.1)

## 1. Цель

Первая аналитическая функция HUBTender: экран **«Качество расчёта»**
(`/analytics/quality`). По одному серверному snapshot показывает блокирующие
проблемы, предупреждения, полноту данных, статус финансового расчёта, конкретные
проблемные позиции/BOQ-строки, причину, действие и переход к месту исправления.
Движок **read-only**: обнаруживает, объясняет, направляет — не меняет BOQ, не
запускает recalc, не ставит курс, не удаляет дубли, не трогает approval/status.

## 2. Severity и категории

Severity: `blocker` (финальный расчёт не готов; approve/final export уже
блокируются этапом 0) · `warning` (расчёт возможен, требуется проверка) ·
`information` (диагностика). Категории: CALCULATION_STATE, CURRENCY, BOQ_INPUT,
RELATIONS, DERIVED_CONSISTENCY, REDISTRIBUTION, APPROVAL, COMPLETENESS,
DUPLICATES.

## 3. Реализованные checks

| Code | Severity | Category | Entity |
|---|---|---|---|
| CALCULATION_STALE / CALCULATION_RUNNING / CALCULATION_FAILED / CALCULATION_REVISION_MISMATCH / CALCULATION_STATE_UNKNOWN | blocker | CALCULATION_STATE | tender (одна агрегированная) |
| FX_RATE_MISSING | blocker | CURRENCY | tender (одна на валюту, `affected_count` + переход к первой строке) |
| PARENT_NOT_FOUND / PARENT_CROSS_POSITION / PARENT_NOT_WORK_ITEM / PARENT_SELF_REFERENCE | blocker | RELATIONS | boq_item |
| REDISTRIBUTION_LEGACY_SNAPSHOT / REDISTRIBUTION_INPUT_REVISION_CHANGED | blocker | REDISTRIBUTION | tender |
| APPROVAL_ON_STALE_CALCULATION | blocker | APPROVAL | tender (детект повреждённых legacy-данных) |
| BOQ_TOTAL_AMOUNT_MISMATCH / POSITION_TOTALS_MISMATCH / CACHED_GRAND_TOTAL_MISMATCH | blocker | DERIVED_CONSISTENCY | boq_item / client_position / tender — ТОЛЬКО при status=calculated и совпадающих ревизиях (при stale расхождение ожидаемо и покрыто CALCULATION_STALE) |
| QUANTITY_ZERO / UNIT_RATE_ZERO / UNIT_CODE_MISSING / DETAIL_COST_CATEGORY_MISSING | warning | BOQ_INPUT | boq_item |
| DESCRIPTION_EMPTY | information | BOQ_INPUT | boq_item |
| EXACT_DUPLICATE_GROUP | warning | DUPLICATES | boq_item (одна на группу) |

Обязательность полей взята из фактической модели (DB-констрейнты, validator
tags, требования calc), не из названий. Ожидаемые суммы считаются ТОЛЬКО
существующими ядрами `backend/internal/calc`
(`CalculateBoqItemTotalAmount`, `CalculateCachedTenderGrandTotal`,
`CalculateInsuranceTotalDecimal`); допуск сравнения — 0,01 (копейка);
`cached_grand_total` сравнивается канонической decimal-строкой.

## 4–5. Completeness (две метрики, без «магических весов»)

`filled applicable required fields / all applicable required fields × 100`,
округление до 0,1%; пустой тендер → 100% (не NaN).

- **Calculation completeness**: quantity>0, unit_rate>0 на строку; для валютной
  строки дополнительно положительный курс её валюты (у RUB-строк курс
  неприменим и в знаменатель не входит).
- **Review completeness**: calculation-поля + unit_code +
  detail_cost_category_id.

## 6. Exact duplicates

Только точные/нормализованные дубли внутри одной client position. Ключ:
`boq_item_type + name_id + normalized(description) + unit_code + currency +
unit_rate + parent_work_item_id + detail_cost_category_id`. Нормализация
текста: trim + lowercase + схлопывание пробелов (Unicode-safe); цифры, марки,
размеры и артикулы сохраняются («Кирпич М150» ≠ «Кирпич М200»). Одинаковая
цена сама по себе — не дубль. Группа → одна warning: количество, IDs, суммарная
стоимость, первая строка — navigation target. Ничего не удаляется/не
объединяется.

## 7. Почему нет единого score 0–100

Усреднение прячет блокеры за высоким процентом полноты. Панель показывает
blockers/warnings раздельно и никогда не «зелёная» при blockers > 0.

## 8. Почему без AI/fuzzy в MVP

Точные проверки дают детерминированный, объяснимый и дешёвый результат без
инфраструктуры embeddings; fuzzy-дубли/аномалии цен требуют эталонов и порогов —
это осознанно вынесено в backlog (см. §12).

## 9. API

`GET /api/v1/tenders/{tenderId}/quality` (существующая auth-политика; 401/404;
internal-ошибки не утекают). Ответ: `data.{tender_id,
financial_input_revision, financial_calculation_revision,
financial_calculation_status, generated_at, summary{blockers, warnings,
information, calculation_completeness_percent, review_completeness_percent,
positions_total, boq_items_total, boq_items_with_issues}, categories[],
issues[]}`. Issue ID детерминирован: `sha256(code|entity_type|entity_id|field)[:16]`.
Ревизия в ответе позволяет фронту понять, к какой версии данных относится
аналитика.

## 10. Как добавить новый check

1. Новая функция `(e *evaluator) checkXxx()` в `backend/internal/quality`
   поверх готового `Snapshot` (или расширить Snapshot+loader одним batched-полем);
2. issue через `e.add(...)` со стабильным code;
3. Для денежных ожиданий вызывать существующее ядро `calc` — копировать формулы
   запрещено (§15 этапа);
4. unit-тест на позитив/негатив + при необходимости integration-фикстура.

## 11. Performance / query model

Один snapshot = **5 фиксированных запросов** в одной `REPEATABLE READ READ
ONLY` транзакции: tender(+generated_at), positions, boq_items, redistribution
metadata, insurance+commercial агрегаты (`::text`). N+1 нет: parent-валидация и
дубли — по in-memory картам. Perf-тест: 5000 строк < 2 s, контроль отсутствия
квадратичности на 10 000. Redis/кэша нет (MVP).

Redistribution в quality — облегчённые признаки из metadata (legacy /
revision marker); полные prepared-проверки остаются на странице
«Перераспределение».

## 12. Связанные инструменты

Ценовые отклонения (исторический benchmark) — отдельная страница и методика:
см. [PRICE_BENCHMARK_ANALYTICS.md](PRICE_BENCHMARK_ANALYTICS.md) (этап 1.2).

## 13. Backlog следующего этапа

price anomaly detection · historical benchmarks · fuzzy duplicates ·
quote freshness (+обязательность quote_link — сейчас модель его не требует) ·
AI explanation · automated task generation · подпись позиций человекочитаемым
номером в фильтре панели · deep-link фокус конкретного поля в формах.
