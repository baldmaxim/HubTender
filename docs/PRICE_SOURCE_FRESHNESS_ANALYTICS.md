# Price Source Coverage & Freshness — MVP (этап 1.3)

## 1. Цель

Страница **«Источники цен»** (`/analytics/price-sources`): для каждой
price-bearing BOQ-строки текущего тендера — есть ли источник цены
(`quote_link`), какова дата подтверждения цены и срок её действия, сколько
строк/денег опирается на актуальные источники. **Устаревший или отсутствующий
источник — предупреждение «требует проверки», не установленная ошибка цены**:
цена может быть подтверждена устно, рамочным договором или недавним рынком.
Severity — warning/information, никогда blocker; согласование не блокируется.

## 2. Модель источника (аудит §1 — вариант B)

Источник живёт прямо на `boq_items` (новая универсальная таблица источников НЕ
вводится):

- `quote_link text` — существующее поле: URL или свободный текст («КП
  Поставщик-X от 01.07»);
- `quote_price_date date NULL` — **дата подтверждения цены поставщиком** (НЕ
  дата загрузки файла и НЕ `created_at`/`updated_at` строки);
- `quote_valid_until date NULL` — срок действия предложения.

Миграция: `db/yandex/incremental/2026_07_boq_quote_source_dates.sql` +
baseline `db/yandex/sql/03_tables.sql`. CHECK
`boq_items_quote_dates_check (quote_valid_until >= quote_price_date)` — без
`CURRENT_DATE` в CHECK (актуальность — вычисляемое состояние, не констрейнт).

## 3. Семантика metadata-only (ключевой инвариант)

Правка ТОЛЬКО `quote_link` / `quote_price_date` / `quote_valid_until` — **не
финансовое изменение**: `financial_input_revision` не двигается, согласование
не снимается, recalc не запускается (`isQuoteMetadataOnlyPatch` в
`backend/internal/repository/boq_mutate.go`). `updated_at` строки при этом
двигается (пользовательский ETag). Любой смешанный patch (дата + количество)
— финансовый и проходит полный 0-F2-путь.

## 4. Классификация (pure engine)

`backend/internal/analytics/pricesource/engine.go`, канонический порядок:

1. `NOT_APPLICABLE` — строка не price-bearing (`quantity <= 0` или
   `unit_rate <= 0`); исключается из знаменателя покрытия;
2. `SOURCE_MISSING` — пустой `quote_link`;
3. `INVALID_SOURCE_DATES` — незаполнимый формат, `price_date` в будущем
   (относительно server as-of) или `valid_until < price_date`;
4. `EXPIRED` — `valid_until < as_of`;
5. `PRICE_DATE_MISSING` — источник есть, даты цены нет;
6. `STALE` — возраст `as_of − price_date > max_age_days` (приоритет над
   EXPIRING_SOON);
7. `EXPIRING_SOON` — `0 ≤ valid_until − as_of ≤ expiring_soon_days`;
8. `FRESH`.

Дефолты: `max_age_days = 90`, `expiring_soon_days = 14`. Разрешённые
`max_age_days`: 30/60/90/180/365 (иное → 400). **As-of дата — только серверная
(`CURRENT_DATE` из репозитория); клиентское «сегодня» не authority.**

## 5. Severity

`warning`: SOURCE_MISSING, PRICE_DATE_MISSING, STALE, EXPIRED,
INVALID_SOURCE_DATES. `information`: EXPIRING_SOON. `none`: FRESH,
NOT_APPLICABLE. Blocker не существует.

## 6. Покрытие

Row-метрики (всегда доступны): `source_coverage_percent` = строки с источником
/ price-bearing строки; `current_source_coverage_percent` = FRESH +
EXPIRING_SOON / price-bearing. Пустое множество price-bearing строк → 100%
(политика «нечего покрывать»), никаких NaN.

## 7. Amount-метрики

Считаются от authoritative `total_amount` и доступны ТОЛЬКО когда
`financial_calculation_status = 'calculated'` и
`financial_calculation_revision = financial_input_revision`
(`amount_metrics_status: available | unavailable` + `amount_metrics_note`).
При stale-расчёте строки и их статусы ПОКАЗЫВАЮТСЯ (даты не зависят от
расчёта), скрываются только денежные значения.

## 8. API

`GET /api/v1/tenders/{id}/price-source-quality` — read-only, один снапшот
(REPEATABLE READ READ ONLY, 2 фиксированных запроса, без N+1). Параметры:
`max_age_days` (30/60/90/180/365), `status`
(all/fresh/expiring/stale/expired/missing_source/missing_date/invalid),
`position_id`, `boq_item_type`, `search`, `sort`
(status/age_desc/amount_desc/position), `page`, `page_size` (≤200). `all`
скрывает NOT_APPLICABLE. 404 — тендер не найден.

## 9. Ввод данных (write-path)

Поля опциональны; сегодняшняя дата НЕ подставляется автоматически. PATCH
`/api/v1/items/{id}` принимает `quote_price_date`/`quote_valid_until`
(YYYY-MM-DD; `""` = очистить). Валидация до записи (`validateQuoteDates`):
формат, `price_date` не в будущем, `valid_until >= price_date` (частичный
patch проверяется против старых значений) → 400 `INVALID_QUOTE_DATES`.
Прошедший `valid_until` при вводе допустим (историческая правда → EXPIRED).
Копирование позиции и версионный перенос переносят все три поля. Даты в
Excel-импорте BOQ — backlog (см. §16).

## 10. UI

`src/pages/PriceSourceQuality/PriceSourceQuality.tsx`: селектор тендера и
`max_age_days`; сводка (покрытие, актуальное покрытие, сумма к проверке,
счётчики статусов, число источников); фильтры/поиск/сортировка; таблица со
статусом (текст + иконка, не только цвет), безопасной ссылкой источника,
датами, возрастом; модальная правка источника (metadata-only, DatePicker
блокирует будущую дату цены); футер со снапшотом. При недоступных
amount-метриках — явное пояснение, что статусы источников доступны и сейчас.

## 11. Deep links и безопасность URL

«К строке» → `/positions/{posId}/items?tenderId=&positionId=&itemId=&field=quote_link`
(механизм подсветки этапа 1.1). Ссылка источника открывается ТОЛЬКО если URL
проходит allow-list `https:`/`http:` (`SafeSourceURL` на бэке, `safeSourceUrl`
на фронте); `javascript:`/`data:`/`file:` и свободный текст показываются как
текст. Открытие — `target="_blank" rel="noopener noreferrer"`.

## 12. Связанные инструменты

- «Качество расчёта» — [TENDER_QUALITY_ANALYTICS.md](TENDER_QUALITY_ANALYTICS.md)
  (этап 1.1); со страницы качества ведёт ссылка «Проверить актуальность
  источников цен».
- «Ценовые отклонения» — [PRICE_BENCHMARK_ANALYTICS.md](PRICE_BENCHMARK_ANALYTICS.md)
  (этап 1.2); из бенчмарка — компактная ссылка «Проверить источник текущей
  цены». Endpoints НЕ объединены: у экранов разные snapshot-инварианты.
- Единый «План действий» по трём аналитикам —
  [TENDER_REVIEW_ACTION_PLAN.md](TENDER_REVIEW_ACTION_PLAN.md) (этап 1.4).
- Серверный XLSX «Отчёт для проверки» —
  [TENDER_REVIEW_PACK.md](TENDER_REVIEW_PACK.md) (этап 1.6).

## 13. Тесты

- Юнит (30): `backend/internal/analytics/pricesource/engine_test.go` — границы
  возраста/сроков, приоритет STALE над EXPIRING_SOON, invalid-даты, политика
  пустого множества, gate amount-метрик, детерминированный порядок, URL
  safety, perf 5000 строк.
- Интеграционные (Docker/live PG):
  `backend/internal/repository/price_source_integration_test.go` — статусы
  A–F, DB CHECK + write-валидация, shared source, покрытие, amount
  available/unavailable, **metadata-only правка не двигает
  ревизию/approval**, копирование переносит даты, серверный as-of.
- Frontend focused (20): `scripts/checks/priceSourceFrontendPolicy.check.mjs`.

## 14. Guard

`scripts/checks/priceSourceFreshnessSafety.check.mjs` — 10 правил:
created_at/updated_at не дата цены; endpoint read-only; метаданные не пишут
деньги; metadata-only не двигает ревизию; серверный as-of; unsafe URL
блокируются; amount-метрики закрыты при stale; не blocker; без OCR/AI/внешних
цен; без новой таблицы источников. 5 негативных self-checks обязаны ронять
guard.

## 15. Ограничения MVP

Один `quote_link` на строку (без множественных предложений); свободный текст в
`quote_link` допустим (без ссылки); отсутствие источника не запрещает
согласование; статус пересчитывается только при просмотре (без фоновых
джобов); `max_age_days` — параметр запроса, не сохраняемая настройка тендера.

## 16. Backlog (осознанно НЕ в этапе 1.3)

- Разбор PDF/КП (OCR/AI) и автозаполнение дат — запрещено в MVP.
- Импорт `quote_price_date`/`quote_valid_until` из Excel BOQ.
- Сравнение поставщиков и внешние прайс-агрегаторы.
- Уведомления об истечении срока и автосоздание задач.
- Проверка «ставка соответствует документу источника».
- Отдельная сущность источников с многими предложениями на строку.
