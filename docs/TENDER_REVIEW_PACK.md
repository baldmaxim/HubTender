# Tender Review Pack XLSX — MVP (этап 1.6)

## 1. Цель

Страница **«Отчёт для проверки»** (`/analytics/review-pack`) и серверный
XLSX-файл: один документ для передачи руководителю/согласующему, собирающий в
согласованном снимке финансовый статус, качество расчёта, план действий,
ценовые отклонения, актуальность источников, изменения между версиями и
методологию. Пользователь не собирает данные из пяти экранов вручную.

## 2. Источники данных

ТОЛЬКО готовые движки этапов 0-1.5: quality (1.1), price benchmark (1.2),
price source freshness (1.3), action plan (1.4), change impact (1.5) +
approval-метаданные тендера. Никаких новых аналитических формул; Excel не
рассчитывает деньги.

## 3. Consistent snapshot

`ReviewPackRepo.LoadSnapshot` — одна REPEATABLE READ READ ONLY транзакция:
те же `loadQualitySnapshotTx`/`loadBenchmarkSnapshotTx`/`loadSourceSnapshotTx`/
`loadChangeImpactSnapshotTx`, что у собственных endpoints, + 1 запрос
реквизитов/approval. Фиксированное число запросов, без N+1 и HTTP-to-HTTP.
Транзакция закрывается ДО генерации XLSX: renderer работает только с готовой
immutable-моделью.

## 4. Financial calculation gate

Отчёт формируется только для актуальной ревизии: `calculated` и совпадающие
`financial_input_revision`/`financial_calculation_revision`. Иначе preview
возвращает 409 и скачивание блокируется кодом
`REVIEW_REPORT_CALCULATION_NOT_READY`. **Quality blockers download НЕ
блокируют** — отчёт и нужен для их проверки. Отсутствие baseline тоже не
блокирует (секция `baseline_not_available`).

## 5. Metadata

`report_schema_version=1`, реквизиты тендера (id/номер/версия/label), ревизии
и статус расчёта, approval (approved_by label + approved_at), generated_at,
as_of_date, параметры (`benchmark_period_months`, `source_max_age_days`),
выбранный baseline, `calculation_source="server"`, cached grand total.

## 6. Fingerprint

SHA-256 канонической строки `tender|revision|schema|period|maxage|baseline|
as-of`. НЕ зависит от generated_at/пагинации/UUID; меняется при смене ревизии
или параметров. Смысл: «Отчёт сформирован для финансовой ревизии N». В БД не
сохраняется.

## 7. Preview API

`GET /api/v1/tenders/{id}/review-report` — параметры
`benchmark_period_months` (6/12/24/36, default 24), `source_max_age_days`
(30/60/90/180/365, default 90), `baseline_tender_id` (optional; default —
политика Change Impact). Ответ: status, metadata, component statuses
(`available|no_data|baseline_not_available|calculation_not_ready|unavailable`),
executive_summary, download_url. Expected no-data — статус секции; неожиданная
внутренняя ошибка — 500 (не «чистый» отчёт).

## 8. XLSX API

`GET /api/v1/tenders/{id}/review-report.xlsx` — те же параметры; ответ:
XLSX MIME, `Content-Disposition: attachment` (RFC 5987 UTF-8 имя + ASCII
fallback), `Cache-Control: no-store, private`. Имя файла — `SafeFilename`
(без `/ \ : * ? " < > |`, control chars, traversal; ≤120 рун; сохраняет номер
тендера): `Tender_<номер>_v<версия>_Review_<as-of>.xlsx`. POST не нужен —
экспорт read-only.

## 9. Структура листов (фиксированный порядок)

`Сводка` → `План действий` → `Качество расчёта` → `Ценовые отклонения` →
`Источники цен` → `Изменения расчёта` → `Методика`. Отдельных листов на
позицию нет.

## 10. Executive summary

Значения копируются из ГОТОВЫХ summary движков (blockers/warnings/полнота;
blocking/high/amount requiring review; outliers/coverage; source coverage/
stale/expired/missing; baseline version/дельты/сверка). Единый score не
строится; заголовок — «Расчёт готов к проверке» / «Обнаружены блокирующие
проблемы» / «Требуются дополнительные проверки» (никогда «тендер корректен»).

## 11. Почему Excel не рассчитывает деньги

Все суммы server-authoritative (decimal-контракт этапа 0). Формулы в файле
пересчитывались бы клиентским Excel по неполным данным и расходились бы с
сервером; поэтому renderer пишет только значения — правило закреплено guard'ом
(SetCellFormula запрещён; арифметика над money-полями модели в renderer
запрещена).

## 12. Formula injection

Единый helper `SafeExcelText`: строка, начинающаяся (после trim-left) с
`=`, `+`, `-`, `@`, нейтрализуется видимым префиксом `'`; control chars
(кроме `\n`, `\t`) удаляются; HTML-escaping не используется; числовые
server-ячейки не экранируются как текст. Применяется ко ВСЕМУ user-controlled
тексту (описания, названия, сообщения, метки источников).

## 13. Safe hyperlinks

Hyperlink создаётся только для source URL, прошедшего allow-list https/http
(`pricesource.SafeSourceURL` этапа 1.3) — единственный `SetCellHyperLink` в
коде. Небезопасный URL остаётся видимым обычным текстом. «Ссылка в HUBTender» —
внутренний typed-путь как текст. Внешние URL при генерации не загружаются.

## 14. Размер и память

Генерация in-memory (excelize v2.9); safety-лимит `MaxDetailRowsPerSheet =
50 000` (Excel-предел 1 048 576; типичный BOQ проекта — тысячи строк).
Превышение → HTTP 413 `REVIEW_REPORT_TOO_LARGE` без частично повреждённого
файла. Ориентир: 5 000 строк ≈ 300 KB, < 1 с, память — единицы MB на файл
(см. TestLargeWorkbook). Временные файлы не пишутся; StreamWriter отложен в
backlog (текущие объёмы не требуют).

## 15. Access и security

Та же auth-политика, что у остальных analytics endpoints (JWT). В workbook нет
JWT/паролей/stack traces/путей ФС; internal UUID присутствуют только в
навигационных путях-ссылках (нужны для перехода), пользовательские колонки —
label'ы. Внутренние SQL-ошибки не раскрываются (RFC 7807 + серверный лог).

## 16. UI

`src/pages/ReviewPack/ReviewPack.tsx`: параметры (период истории, возраст
источника), готовность компонентов, сводка (blockers/high/amount/outliers/
sources/Δ итога), metadata (ревизия, дата, fingerprint, согласование), кнопка
«Скачать Excel» (disabled при not-ready + Alert со ссылкой на План действий).
Frontend не пересчитывает summary и не строит Excel — использует JSON preview
и авторизованное скачивание blob.

## 17. Ограничения MVP

Нет PDF/подписей/архива отчётов/истории скачиваний/email/расписаний/фоновых
jobs; отчёт не сохраняется; formирование только для актуальной ревизии; один
формат (XLSX, русский).

## 18. Backlog

PDF-версия · stored report archive · электронные подписи · email-доставка ·
scheduled generation · approval package · двуязычные отчёты · custom
templates · StreamWriter для сверхбольших выгрузок.

## 19. Тесты и guard

Юнит (`model_test.go`): metadata, fingerprint (стабильность/зависимости),
mapping всех summary, no-data/unavailable, injection (= + - @ / control
chars), SafeFilename, row-limit. Workbook (`render_test.go`): 7 листов и
порядок, revision/fingerprint в «Сводке», server rank, numeric money, date
cells, НИ ОДНОЙ formula-ячейки, нейтрализация инъекций, safe/unsafe hyperlink,
freeze/autofilter, baseline no-data и reconciliation mismatch видимы, пустой и
большой workbook, renderer не мутирует модель. Интеграционные
(`review_pack_integration_test.go`): полный отчёт, stale→409, no baseline,
реакция секций/fingerprint на изменения, injection/unsafe URL из БД, имя
файла, повторяемость, консистентный снапшот. Guard
`scripts/checks/reviewPackSafety.check.mjs` (18 правил) + 7 негативных
self-checks; focused `reviewPackFrontendPolicy.check.mjs` (21).
