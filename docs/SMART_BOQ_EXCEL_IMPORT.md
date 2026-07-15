# Smart BOQ Excel Import — MVP (этап 2.1)

## 1. Цель

Мастер **«Умный импорт»** на странице «Позиции заказчика»: загрузка Excel →
автоматический выбор листа, поиск строки заголовков, предложение mapping
колонок с объяснимой уверенностью, нормализация чисел/валют/единиц, точное
сопоставление номенклатуры, raw/normalized preview с blockers — и импорт через
СУЩЕСТВУЮЩИЙ server-authoritative контур 0-F1. Анализ только предлагает и
нормализует входы; `total_amount`, position totals, commercial и cached grand
total считает сервер. Ни Excel, ни frontend, ни preview не являются
источником финансового результата.

## 2-4. Analyze/execute lifecycle и fingerprint

- `POST /api/v1/tenders/{id}/boq-import/analyze` (multipart: file, sheet_name?,
  header_row?, locale?, mapping?, confirmed_options?) → полный анализ
  (fingerprint, листы, header, mapping+candidates+reasons, форматы, summary,
  preview_rows, issues).
- `POST /api/v1/tenders/{id}/boq-import/execute` (те же поля +
  workbook_fingerprint) → сервер ПОВТОРНО вычисляет SHA-256 файла, сравнивает
  с переданным, ПОВТОРНО парсит workbook той же pure-границей, повторно
  проверяет mapping и передаёт нормализованные raw-входы в существующий
  import service. Preview/normalized rows от frontend НЕ принимаются.

**Файл передаётся повторно** и не хранится между вызовами: нет серверного
файлового хранилища, stale upload-токенов, cleanup-задач и новых persistence-
таблиц. Fingerprint (SHA-256 исходных bytes) в БД не сохраняется.

## 5. Target fields

Registry (`importanalysis.FieldRegistry`): position_ref (существующая позиция
тендера), boq_item_type, description, nomenclature, unit_code, quantity,
base_quantity, conversion/consumption coefficients, unit_rate, currency_type,
delivery type/amount, detail_cost_category, parent_ref/temp_id, quote_link,
quote-даты (даты в текущем import DTO не персистятся — backlog). **Не
принимаются как authoritative**: total_amount (только diagnostic-поле «Сумма»
→ существующий mismatch-report), commercial-поля, cached grand total,
position totals, redistribution.

## 6. Sheet/header detection

Анализируются первые `HeaderScanRows = 50` строк листа: алиасы заголовков,
уникальность, данные ниже, отсутствие footer-маркеров. Sheet score =
header-score + объём данных; hidden-листы ×0.5; первый лист не выбирается «за
первенство». Близкие score (`CloseSheetScoreDelta = 15%`) → sheet_confidence
medium и подтверждение пользователем. Без AI.

## 7. Column mapping и confidence

Прединдексированные exact-алиасы (русские/сокращения/английские; слишком
общие исключены) + value profile (доля чисел/дат/текста) + конфликты (одна
колонка — одному полю) + candidates при неоднозначности (без случайного
выбора). Confidence: high/medium/low/unresolved + человекочитаемые reasons.
Override пользователя: колонка либо `=фиксированное значение` (тип/валюта для
всего диапазона).

## 8. Normalization

- Числа: `1 234,56` (пробел/NBSP), `1,234.56`/`1.234,56` (однозначные),
  `1234.56`, проценты, отрицательные; неоднозначное `1,234` без ru-профиля →
  issue NUMBER_AMBIGUOUS (не угадывается).
- Валюты: RUB/RUR/₽/руб., USD/$, EUR/€, CNY/¥/юань → canonical enum; иное →
  blocker.
- Единицы: exact-реестр поверх units проекта; `м²/м^2 → м2`, `м³ → м3`;
  предметно разные не объединяются.
- Типы BOQ: только явные алиасы (раб/мат/суб-*/…); классификация по описанию
  запрещена; при отсутствии колонки — подтверждённый пользователем тип для
  диапазона либо blocker.
- Номенклатура: ТОЛЬКО exact normalized unique match; ambiguous → blocker;
  missing → blocker (авто-создание запрещено).
- Даты: Excel/ISO/`дд.мм.гггг`; будущая дата цены → blocker.
Каждая трансформация видима: raw → normalized + код + сообщение.

## 9. Formula policy

Формулы НИКОГДА не исполняются (guard запрещает CalcCellValue/evaluator).
Аудит excelize: `GetRows` отдаёт cached-результат, `GetCellFormula` — текст;
файл, сохранённый без пересчёта, имеет пустой cache. Policy: формула в
authoritative numeric поле без cached value → blocker
`FORMULA_NO_CACHED_VALUE`; с cached value → blocker `FORMULA_CACHED_VALUE` до
явного подтверждения `accept_formula_cached` (execute повторно проверяет то же
cached-значение через повторный parse). `.xlsm`/vbaProject отклоняются.

## 10. Parent policy

Только детерминированные источники: колонки «ID строки»/«Родитель» → temp-id
контур существующего импорта. Проверки анализа: родитель существует выше в
файле, является работой, не self (forward-ссылка/цикл невозможны по
построению). Финальная валидация — существующая server-side политика 0-F1.
Никакого угадывания по описанию/indentation.

## 11-12. Row issues и пропуски

Blockers: несопоставленное обязательное поле, нераспознанные qty/rate,
неизвестные валюта/единица/тип, ambiguous/missing номенклатура, invalid
parent/дата, формула без подтверждения, дубль temp-id, позиция не найдена.
Warnings: diagnostic total, подтверждённая формула/валюта по умолчанию,
пропуск служебной строки. Information: нормализация, exact-совпадение
номенклатуры. Issue ID стабилен: `fingerprint|sheet|row|field|code`.
Пропуски (§12): пустые, повторный header, footer (точный маркер «итого/всего/
total» + отсутствие qty/rate), section-rows; слово «итого» в описании при
заполненных qty/rate строку НЕ пропускает; каждый непустой пропуск виден в
preview с кодом SKIPPED_*.

## 13-14. Wizard и выполнение

Шаги: Файл → Лист и заголовки → Сопоставление колонок → Проверка строк →
Импорт → Результат. Кнопка импорта disabled при unresolved required, blockers,
неподтверждённых формулах, несоответствии файла. Execute возвращает
существующий import report (session, inserted, mismatches) + normalization
summary; revision/stale/approval/mismatch/audit — семантика 0-F1/0-F2 без
изменений. Preview не считается импортом.

## 15. Security и limits

Только `.xlsx` (ZIP-подпись + [Content_Types].xml + xl/workbook.xml; не по
расширению); `.xls/.xlsm/произвольный ZIP` отклоняются. Preflight до полного
parse: ≤20 MB файл, ≤500 zip-записей, ≤200 MB распакованного, ratio ≤400×,
≤20 листов, ≤60 000 строк, ≤120 колонок, ячейка ≤32 767 символов
(документированные константы). Превышение → 413
`BOQ_IMPORT_FILE_TOO_LARGE`/`BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED`. Файл живёт
только в памяти запроса (temp-файлы не используются); внешние ссылки/objects
не извлекаются; внешних HTTP-запросов нет.

## 16. Performance

Прединдексация алиасов/номенклатуры/units; батч-загрузка справочников
(5 запросов, без запросов на строку); один parse; batch execute. Тест
10 000×30 со смешанными форматами: ~9.4 с, файл ~0.7 MB, без квадратичности.

## 17. Ограничения MVP

Только xlsx; без OCR/PDF/LLM/fuzzy; без сохранённых mapping-профилей; позиции
заказчика должны существовать заранее; quote-даты из файла валидируются, но в
import DTO не персистятся.

## 18. Backlog (следующий AI-этап — поверх детерминированного preview)

AI-assisted column mapping · пользовательские mapping-профили · PDF/КП
extraction · multi-file import · автоматическая привязка документов ·
quote-даты в import DTO.

**Реализовано этапом 2.2**: AI-подбор номенклатуры для unresolved-строк
(двухэтапная модель, provider-neutral, execute-контракт `nomenclature_selections`)
— см. [AI_NOMENCLATURE_MATCHING.md](AI_NOMENCLATURE_MATCHING.md).

**Реализовано этапом 2.3**: персональная память импорта — профили сопоставления
колонок и подтверждённые номенклатурные соответствия — см.
[SMART_IMPORT_MEMORY.md](SMART_IMPORT_MEMORY.md).

## 19. Тесты и guard

Юнит (53 пункта §17): листы/header, алиасы/конфликты/reasons, числа/валюты/
единицы/типы/даты/номенклатура, footer/повторный header/«итого», parent,
формулы, fingerprint, stable issue IDs, детерминизм, no-mutation, 10k perf.
Интеграционные A-V: analyze+execute на живой БД, override, fingerprint guard,
diagnostic total, parent link, revision/approval, formula block, invalid/
limits, quote-поля. Guard `smartBoqImportSafety.check.mjs` (18 правил) + 7
негативных self-checks; focused `smartImportFrontendPolicy.check.mjs` (22).
