# Smart Import Memory (этап 2.3, MVP)

Персональная память «Умного импорта BOQ»: профили сопоставления колонок и
подтверждённые номенклатурные соответствия. Сокращает повторяющуюся ручную
работу при импорте типовых Excel-файлов.

> Память и deterministic retrieval не зависят от AI-провайдера: настройка
> OpenRouter (этап 2.5, [OPENROUTER_AI_ADMINISTRATION.md](OPENROUTER_AI_ADMINISTRATION.md))
> ничего в этом контуре не меняет; exact/alias-совпадения провайдера не вызывают.
> Пилотный live-путь этапа 2.6 — [CONTROLLED_AI_ROLLOUT.md](CONTROLLED_AI_ROLLOUT.md).

## 1-2. Цель и scope

Система запоминает **только явно подтверждённые пользователем решения** и
применяет их **только этому же пользователю** (`user_id` из JWT; tenant/org
scope в проекте отсутствует — псевдоорганизация не создавалась). Shared/team
profiles — backlog.

## 3-6. Mapping profiles

Таблица `boq_import_mapping_profiles`: `user_id`, `name`,
`normalized_header_signature`, `mapping_schema_version`,
`normalization_version`, `mapping jsonb` (field → колонка/`=фикс`),
`fixed_options jsonb` (ТОЛЬКО `default_currency`/`default_boq_type` —
подтверждение формул профилем не переносится), hints листа/строки, `is_active`,
use-счётчики.

**Header signature** (`importmemory.BuildImportHeaderSignature`) — SHA-256 от
упорядоченного списка нормализованных заголовков + позиций значимых колонок +
версий. НЕ зависит от значений строк, имени файла, даты, workbook fingerprint
и количества строк. **Matching — только exact** (без fuzzy): один профиль →
предложение; несколько → обязательный выбор пользователя (никогда не по
`last_used_at`).

Применение профиля — только явное (`mapping_profile_id`), backend повторно
валидирует: сигнатура совпадает, версия текущая, колонки существуют
(отсутствующая → поле unresolved, required не обходится, дубль колонки
отбрасывается), source-метка `saved_profile` видна в ответе. Иная
`mapping_schema_version`/`normalization_version` → `requires_review`, профиль
не применяется молча.

## 7-8. Approved nomenclature aliases

Таблица `nomenclature_import_aliases`: `user_id`, `catalog_kind`
(`material|work`), ровно один FK (`material_name_id` XOR `work_name_id` —
CHECK), `normalized_source_text`, `canonical_boq_item_type`,
`normalized_unit_code` (nullable = любой), `detail_cost_category_id`
(nullable), `normalization_version`, `is_active`, счётчики.

**Alias key** = user + kind + normalized text + canonical type + unit +
category. В ключе НЕТ цены, quantity, валюты, total, тендера, workbook,
номера строки, URL и AI confidence. Один активный ключ → одна номенклатура
(partial unique index). Прежнее соответствие при замене деактивируется, не
переписывается молча.

## 9. Порядок сопоставления

`exact canonical match` → `user-approved alias` → `deterministic candidates
(2.2)` → `optional AI rerank` → `manual`. Exact всегда выше alias. Alias
применяется только при полном совпадении текста/типа и совместимости
unit/категории; несколько разных целей → blocker
`NOMENCLATURE_ALIAS_CONFLICT` (система не выбирает сама). Provenance строки:
`match_method=user_approved_alias`, alias_id, catalog_id, saved_at, use_count,
label «Подтверждено вами ранее» — решение видимо и изменяемо.

## 10-11. Remember-семантика

Alias создаётся только из manual selection или подтверждённого AI-предложения
с явным флагом `remember_selection` (checkbox «Запомнить для следующих
импортов», **по умолчанию выключен**; bulk-подтверждение НЕ подразумевает
запоминание — отдельный opt-in в диалоге). Неподтверждённое AI-предложение не
сохраняется никогда. Default выключен, чтобы память не наполнялась случайными
решениями без осознанного выбора инженера.

## 12-13. Post-success persistence

Порядок execute: повторный parse → повторная валидация (профиль применяется к
opts тем же путём, что и analyze) → authoritative import → **только после
успеха**: use-счётчики применённого профиля и aliases, явно запрошенные новые
profile/aliases. Policy A: memory persistence — отдельная транзакция; её сбой
НЕ откатывает импортированный BOQ, ответ содержит warning
`IMPORT_MEMORY_SAVE_FAILED` и `memory_saved=false`. Неуспешный импорт не
создаёт и не обновляет память.

## 14. Stale/archived targets

FK aliases — `ON DELETE CASCADE`: hard delete каталога не блокируется, alias
исчезает вместе с целью (dangling ID невозможен). Если цель недоступна в
текущих справочниках — warning `NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE`, строка
остаётся неразрешённой. Другая `normalization_version` →
`NOMENCLATURE_ALIAS_REQUIRES_REVIEW`, alias не применяется, но не удаляется.

## 15. Management

`GET/PATCH/DELETE /api/v1/boq-import/mapping-profiles[/{id}]`,
`GET/DELETE /api/v1/boq-import/nomenclature-aliases[/{id}]` — user-scoped,
чужой ID = 404. PATCH профиля — только `name`/`is_active`; mapping и catalog
target через generic PATCH неизменяемы (новое соответствие — только через
Smart Import после успешного импорта). DELETE = soft deactivate. UI — drawer
«Сохранённые настройки импорта» (вкладки «Профили колонок» и «Соответствия
номенклатуры»), деактивация через confirm-диалог; после изменения текущий
анализ перезапрашивается.

## 16-17. Privacy и что НЕ сохраняется

Все запросы фильтруют `user_id` текущего пользователя; frontend `user_id` не
передаёт. Память не отправляется AI-провайдеру: alias-разрешённая строка в AI
не попадает вовсе. НЕ сохраняются: workbook bytes, fingerprint, preview rows,
цены/qty/totals/курсы, tender identity, AI prompt/response, candidate lists,
неподтверждённые предложения.

## 18. Почему aliases — не AI training

Alias — детерминированная exact-подстановка подтверждённого выбора конкретного
инженера. Никакого обучения модели, embeddings, fine-tuning или переноса
решений между пользователями не происходит; AI по-прежнему получает только
текущую строку + серверный candidate set (этап 2.2).

## 19. Metrics/provenance

Execute возвращает `memory`-блок: `mapping_profile{applied, profile_id,
profile_name, saved, updated}`, `nomenclature{exact_matches,
approved_alias_matches, ai_confirmed_matches, manual_matches,
aliases_requested_to_save, aliases_saved, aliases_failed}`, `warnings[]`,
`memory_saved`. Одна строка = один финальный метод сопоставления. Логи — только
безопасные поля (счётчики/статусы), без raw-текста строк и меток каталога.

## 20. Ограничения MVP

Только персональный scope · без fuzzy profile/alias matching · без shared
memory · без автоматического обучения · без сохранения workbook · без live AI
provider (см. [AI_NOMENCLATURE_MATCHING.md](AI_NOMENCLATURE_MATCHING.md)).

## 21. Backlog

Team-shared approved profiles + approval workflow · подсказки профилей по
похожим (не exact) заголовкам · feedback dataset export · provider evaluation ·
calibrated confidence · user-approved synonym catalog.

## Проверки

Unit: `internal/importmemory` (signature/matching/alias index/perf),
`internal/services` (remember/persist/failure policy), importanalysis
(alias-ветка). Integration: `-run ImportMemoryIntegration` (A-Y, включая
CASCADE, конфликт, изоляцию пользователей, 10k строк + 5k aliases). Guard:
`scripts/checks/smartImportMemorySafety.check.mjs` (20 правил) + 8 негативных
self-check'ов; frontend: `smartImportMemoryFrontendPolicy.check.mjs` (24).
