# Tender Change Impact Analytics — MVP (этап 1.5)

## 1. Цель

Страница **«Изменения расчёта»** (`/analytics/change-impact`): сравнение
текущей рассчитанной версии тендера с предыдущей согласованной. Отвечает на
«что изменилось?» и «какие изменения сильнее всего повлияли на итог?»:
итог/прямая стоимость/коммерческие материалы и работы/страхование, добавленные,
удалённые и изменённые строки, изменённые входные поля, изменения конфигурации,
позиции с наибольшим вкладом, точная сверка дельты, переход к текущим строкам.
Аналитика **не утверждает точную причинную стоимость отдельного поля** — без
calculation snapshots это недоказуемо.

## 2. Baseline policy

По умолчанию — последняя более ранняя версия того же `tender_number`, у
которой одновременно `financial_approved = true`,
`financial_calculation_status = 'calculated'` и
`financial_input_revision = financial_calculation_revision`. Нет такой версии →
HTTP 200 со `status = BASELINE_NOT_AVAILABLE` и пустым diff-контрактом
(несогласованная версия НИКОГДА не подставляется молча). Явный
`baseline_tender_id` разрешён только для более ранней согласованной
рассчитанной версии того же логического тендера; текущий тендер, более новая
версия, чужой tender_number, stale/failed → 409
`CHANGE_IMPACT_BASELINE_NOT_READY`. В ответе — `baseline_candidates`
(tender_id, version, approved_at, cached_grand_total, label) внутри основного
response (отдельного endpoint нет).

## 3. Financial state

Current обязан быть `calculated` с совпадающими ревизиями, иначе 409
`CHANGE_IMPACT_CALCULATION_NOT_READY`. Никаких «последних рассчитанных итогов»
stale-тендера, legacy commercial values, client totals, redistribution preview.
Recalc из analytics endpoint не запускается.

## 4-6. Exact matching policy

Persisted lineage в модели НЕТ (аудит §1: transfer-карта old→new транзиентна),
поэтому только детерминированные exact-ключи; fuzzy/similarity/embeddings
запрещены.

- **Позиция**: `norm(item_no) | norm(work_name) | norm(unit_code)`
  (`BuildPositionComparisonKey`). `position_number` не в ключе (сдвигается при
  вставках), UUID не в ключе (пере-генерируется при transfer).
- **BOQ-строка** внутри matched-позиции: `boq_item_type |
  material/work_name_id | norm(unit_code) | detail_cost_category_id |
  parent-идентичность (type|name|unit родителя, не UUID) | norm(description)`
  (`BuildBoqComparisonKey`). Финансовые поля (quantity/rate/totals) в identity
  НЕ входят.
- Нормализация: trim + lowercase + collapse whitespace, Unicode-safe; цифры,
  размеры, марки, артикулы сохраняются.

## 7. Ambiguous groups

Несколько строк/позиций с одинаковым exact-ключом НЕ связываются попарно
случайно: сравниваются агрегатом как `AMBIGUOUS_GROUP` («Несколько одинаково
идентифицируемых строк сравниваются как группа») с current/baseline ID-списками
и counts. Это не ошибка, а честная границa идентичности.

## 8. Change statuses

`UNCHANGED | MODIFIED | ADDED | REMOVED | AMBIGUOUS_GROUP`. MODIFIED = exact-
сопоставлена и изменился хотя бы один вход или authoritative-сумма. Для matched
строк возвращается `changed_fields` (quantity, unit_rate, currency, unit,
коэффициенты, base_quantity, доставка, номенклатура/категория — identity-поля
меняют ключ и дают ADDED+REMOVED, — parent-контекст, description,
quote-метаданные c пометкой `evidence_only`, total_amount, commercial mat/work).

## 9. Direct/commercial delta

Только server-authoritative сохранённые значения (`numeric::text` → `big.Rat`,
decimal-хелперы этапа 0): `direct_delta = current.total_amount −
baseline.total_amount`; commercial — по material/work; ADDED: baseline = 0;
REMOVED: current = 0; UNCHANGED: |Δ| ≤ 0.01; группы — агрегаты без фиктивных
индивидуальных дельт. Никакого повторного markup/insurance-на-строку/
redistribution prepared/benchmark median/hypothetical savings.

## 10-11. Reconciliation bridge и страхование

Точная сверка: `Σ BOQ commercial deltas (added + removed + modified +
ambiguous) + insurance delta = current.cached_grand_total −
baseline.cached_grand_total` (tolerance 0.01, exact rat-арифметика). Страхование
считается формулой этапа 0 (`CalculateInsuranceTotalDecimal`) и входит в bridge
**ровно один раз**. Response несёт baseline/current grand totals, grand/boq/
insurance/reconciled deltas, `reconciliation_residual`, `is_reconciled`.
Residual вне tolerance → явный `RECONCILIATION_MISMATCH`; он НЕ прячется в
«прочее», UI пишет «Изменение итоговой суммы не удалось полностью
согласовать». Это bridge по строкам, а не причинное разложение по полям.

## 12-13. Configuration diff

Сравниваются: курсы USD/EUR/CNY, markup_tactic, apply_subcontract-флаги,
tender_markup_percentage (по label), pricing distribution (6 target-полей),
subcontract exclusions (канонический сортированный список), insurance-поля.
Каждое изменение: code/label/old/new/navigation. **Money-дельта конфигурации НЕ
приписывается** («Одновременно изменился курс USD», но не «курс увеличил итог
на 2 000 000 ₽») — причинную сумму без пересчёта доказать нельзя; config-diff —
объясняющий контекст.

## 14. API

`GET /api/v1/tenders/{id}/change-impact`. Параметры: `baseline_tender_id`
(optional), `status` (all/modified/added/removed/unchanged/ambiguous),
`position_id`, `boq_item_type`, `search`, `sort`
(impact_desc/impact_asc/direct_delta_desc/position), `page`, `page_size`
(default 50, max 200). Общая summary/bridge/config/top_contributors — по
ПОЛНОМУ сравнению (пагинация их не меняет); substantive-фильтры дают отдельную
`filtered_summary` (items, commercial/direct delta) и НЕ подменяют общий итог
(§15). 404 — тендер не найден; 409 — current/baseline не готовы; отсутствие
baseline — 200 `BASELINE_NOT_AVAILABLE`.

## 15. UI

`src/pages/ChangeImpact/ChangeImpact.tsx`: селектор тендера + baseline-селектор
(версия/дата/итог); сводка (итог было→стало→Δ, прямая, комм. материалы/работы,
страхование, счётчики added/removed/modified/групп); CSS-waterfall bridge (без
chart-библиотек); изменения конфигурации («Одновременно изменено: …» +
переходы); топ изменений; фильтры; таблица строк (статус, changed fields,
было/стало qty/rate, Δ прямая/коммерческая); detail drawer (old/new, поля,
IDs, source-метаданные как «доказательная информация»); empty-states (нет
baseline / версии идентичны / расчёт не готов / ошибка).

## 16. Навигация

Текущая строка → `/positions/{posId}/items?tenderId&positionId&itemId`.
REMOVED — текущей строки нет: только drawer, без ложной ссылки.
AMBIGUOUS_GROUP — drawer со списками ID (случайная строка не выбирается).
Конфигурация: FX → параметры тендера; тактика/проценты → наценки;
distribution → КП; exclusions → перераспределение; insurance → форма
страхования. Лёгкие ссылки на экран: из «Финансовых показателей», из «Плана
действий», из «Качества расчёта». Diff-endpoint из других страниц не грузится.

## 17. Performance

Один REPEATABLE READ READ ONLY снапшот, фиксированные запросы: current,
версии-кандидаты, позиции обеих версий (1 запрос), BOQ обеих версий (1 запрос),
конфиг (3 set-based). Matching — maps по exact-ключам, O(N log N); дубли —
группировкой без N². Perf-тест: 5000×5000 строк с добавлениями/удалениями/
изменениями/дублями (< 2 s, факт ~0.2 s) + анти-квадратичный контроль +
инвариантность к порядку входа.

## 18. Ограничения MVP

Только сохранённые версии (без истории внутри версии и произвольных дат); без
fuzzy matching; без calculation replay; без Shapley/причинного разложения;
без rollback/создания версий/принятия изменений; сравнение недоступно, пока
current не рассчитан.

Сравнение версий входит листом в серверный XLSX «Отчёт для проверки» —
[TENDER_REVIEW_PACK.md](TENDER_REVIEW_PACK.md) (этап 1.6).

## 19. Backlog

calculation-run comparison · intra-version audit timeline · exact causal
decomposition · сравнение произвольных дат · экспорт отчёта сравнения ·
approval change summary · persisted transfer lineage (source_item_id) для
точного row-mapping.

## 20. Тесты и guard

- Юнит: `engine_test.go` + `bridge_test.go` (46 пунктов §17: baseline policy,
  exact/ambiguous matching, changed fields, дельты, insurance, exact
  reconciliation + видимый mismatch, стабильность/permutation, decimal-границы,
  NaN-защита, 5000×5000 perf).
- Handler: `change_impact_test.go` (401, 409-коды, фильтры/пагинация/sort,
  filtered_summary отдельно от общей).
- Интеграционные: `change_impact_integration_test.go` (A-S: полный сценарий
  двух версий, пропуск непригодных baseline, дубль-группы, порча итога →
  mismatch, no-baseline контракт, stale current → 409; D/S — SKIPPED c
  причиной).
- Guard: `scripts/checks/changeImpactSafety.check.mjs` (15 правил) + 6
  негативных self-checks; frontend focused:
  `scripts/checks/changeImpactFrontendPolicy.check.mjs` (25 проверок).
