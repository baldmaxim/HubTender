# Price Benchmark Analytics — MVP (этап 1.2)

## 1. Цель

Страница **«Ценовые отклонения»** (`/analytics/price-benchmark`): для каждой
точно сопоставимой BOQ-строки текущего тендера — текущая прямая стоимость за
единицу против внутренней согласованной истории (медиана, P25–P75, min–max,
Tukey-границы, отклонение, количество тендеров, период, исторические примеры,
переход к строке). **Отклонение — аналитическое предупреждение «требует
проверки», не установленная ошибка**: высокая/низкая цена может быть обоснована
проектом, объёмом, срочностью, поставщиком, рынком. Поэтому severity — всегда
warning-класс, никогда blocker; согласование не блокируется.

## 2. Источник истории

Только внутренние тендеры HUBTender, одновременно: не текущий тендер;
`financial_approved = true`; `financial_calculation_status = 'calculated'`;
`financial_calculation_revision = financial_input_revision`;
`financial_approved_at` в выбранном периоде. Несогласованные тендеры НИКОГДА не
используются как fallback. Организация одна (tenant-scope в схеме отсутствует —
аудит §1), региона в схеме нет — региональное сопоставление не вводится.

## 3–4. Eligibility и benchmark key

Строка участвует, если: `quantity > 0`, authoritative `total_amount > 0`,
есть номенклатурная привязка и единица измерения. Ключ (единственный helper
`BuildPriceBenchmarkKey`, общий для текущих строк, SQL истории, тестов и
detail): **canonical boq_item_type + material/work_name_id + unit_code +
has_parent** (child-материал имеет derived-количество — со standalone не
смешивается). НЕ в ключе: unit_rate, total_amount, description, tender ID.
Description-fallback запрещён: без catalog-ID строка получает
`NOT_ELIGIBLE / INSUFFICIENT_IDENTITY`.

## 5. Метрика

`effective_direct_unit_cost_rub = authoritative total_amount / quantity`.
Server-total уже учитывает валюту (FX fail-closed этапа 0), доставку и
коэффициенты. **Commercial-поля (markup/НДС/распределение/insurance) в
исторической базовой цене не участвуют.** UI подписывает: «Историческая прямая
стоимость за единицу, включая действующие коэффициенты и доставку строки».

## 6. Одна observation на логический тендер

Логический тендер = `tender_number`; берётся ТОЛЬКО актуальная согласованная
версия (`DISTINCT ON (tender_number) ORDER BY version DESC`). Внутри тендера
строки одного ключа схлопываются в одну representative-точку — медиану их unit
costs (`percentile_cont(0.5)` в SQL): крупный тендер с сотней одинаковых строк
не доминирует в статистике. Возвращаются и `historical_tenders_count`, и
`historical_rows_count`.

## 7–9. Периоды, минимум, статистика

Периоды: 6/12/24/36 мес. (default 24). Минимум **5 логических тендеров**;
меньше → `INSUFFICIENT_HISTORY`. По representative-точкам: median, P25, P75
(детерминированная линейная интерполяция), IQR, Tukey-границы
`P25−1.5·IQR … P75+1.5·IQR`, min/max, период наблюдений. Денежный допуск
границ — 0,01 (копейка представления не создаёт warning); дополнительных
процентных порогов нет. IQR=0: границы совпадают с медианой, различие ≤0,01 —
равенство, больше — outlier (покрыто тестами). `median ≤ 0` → история
непригодна (`INSUFFICIENT_HISTORY`), deviation не считается, NaN/Inf исключены.
`deviation = (current − median)/median × 100`.

## 10–11. Статусы

`HIGH_OUTLIER` («Выше исторического диапазона — требует проверки»),
`LOW_OUTLIER`, `WITHIN_RANGE`, `INSUFFICIENT_HISTORY`, `NOT_ELIGIBLE`. Outlier
— не доказанная ошибка: статистика не знает об условиях проекта; она направляет
внимание расчётчика (review_hint перечисляет, что проверить).

## 12. Ограничения MVP

Без инфляционной индексации; без региона (нет поля); без fuzzy/embeddings/LLM;
без внешнего рынка/парсинга поставщиков; только согласованная внутренняя
история; benchmark не персистится (нет таблиц/materialized views).

## 13. API

`GET /api/v1/tenders/{id}/price-benchmarks?period_months=&status=&position_id=&boq_item_type=&search=&sort=&page=&page_size=`
(page_size ≤ 200) — сводка + строки + пагинация; ревизии в ответе.
`GET /api/v1/tenders/{id}/price-benchmarks/{itemId}/history?period_months=&limit=`
(limit ≤ 50) — текущая строка + до 50 per-tender observations + методика.
**Fail-closed**: stale/calculating/failed/ревизии разошлись → **409
FINANCIAL_CALCULATION_NOT_READY** («Для анализа цен сначала дождитесь
актуального расчёта тендера») — последний рассчитанный итог не выдаётся за
текущую benchmark-цену.

## 14. Performance / query model

Три фиксированных запроса в одной `REPEATABLE READ READ ONLY` tx: tender-state;
текущие строки (+имена одним JOIN); set-based historical SQL (current_keys →
latest_versions → per-tender representative через `percentile_cont` → JOIN по
ключам текущего тендера). Никаких запросов на строку/ключ; статистика по
observations — в Go pure-слое (детерминированная интерполяция). Perf-тест:
3000 строк × история < 2 s + анти-квадратичный контроль.

## 15. Связанные инструменты

Актуальность источников цен (quote coverage & freshness) — отдельная страница
и методика: см.
[PRICE_SOURCE_FRESHNESS_ANALYTICS.md](PRICE_SOURCE_FRESHNESS_ANALYTICS.md)
(этап 1.3); из бенчмарка ведёт компактная ссылка «Проверить источник текущей
цены». Endpoints не объединены.

## 16. Следующий уровень (backlog)

regional benchmark (после появления поля региона) · inflation normalization ·
supplier quote freshness · fuzzy nomenclature matching · external market data ·
персистентные benchmark-снимки для трендов.
