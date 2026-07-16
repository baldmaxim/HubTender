# AI Pilot Acceptance Report (этап 2.6|0)

Приёмочный отчёт обязательного live-гейта. Заполнен по результатам
`go run ./cmd/ai-nomenclature-eval --mode live --dataset synthetic
--confirm-live-provider-cost --save-summary` и staging smoke
([CONTROLLED_AI_ROLLOUT.md](CONTROLLED_AI_ROLLOUT.md) §26), выполненных
скриптом `scripts/readiness/run-live-ai-gate.sh` против одноразовой БД
(production не затрагивался). Raw prompts/responses сюда не включаются.

## Live evaluation

| Поле | Значение |
| --- | --- |
| Selected model | `google/gemini-2.5-flash` (ZDR-endpoint Google; test passed) |
| Config hash | `d98042dc55b88e71f0ff0a6bf9a34542be767ef95d5ffbcc468df40c8fb922a6` |
| Prompt version | nomenclature-rerank-v1 |
| Dataset | synthetic, hash `4a179e9adb5b89e5`, size 21 (eligible 16) |
| Test date | 2026-07-16 (UTC+2) |
| Recall@20 / Top-1 / Top-3 | 100% / 100% / 100% |
| Abstention rate / correctness | 19% / 100% |
| High-conf coverage / precision / FP | 56% / 100% / 0 |
| Critical hard-negative FP | 0 |
| Unknown ID accepted / invalid | 0 / 0 |
| Timeouts / rate-limited | 0 / 0 |
| Latency p50/p95 | 7294 / 11178 ms |
| Tokens (prompt→completion) | 4106 → 3205 |
| Provider cost (unit) | 0.00881473 USD (кредиты OpenRouter); reservation не занижена |
| Gate result | **PASS** (все непонижаемые гейты) |

## Provider key status (без секрета)

| Поле | Значение |
| --- | --- |
| Key label | `sk-or-v1-66e...f5e` (маскированная форма из admin API) |
| Limit / remaining | 20.00 / 17.63 USD |
| Usage (month) | 0.134 USD |

## Staging smoke (§26 runbook)

| Шаг | Результат |
| --- | --- |
| evaluation → pilot_individual (test user, disposable DB) | ✅ гейты перехода пройдены после live eval |
| Один synthetic suggestion + ручное подтверждение + импорт в test tender | ✅ provider=available, `ai_request_id` выдан, execute успешен |
| Usage/cost ledger корректен | ✅ `completed` / `provider_reported` / actual cost записан / underestimate=false |
| Feedback после импорта | ✅ `accepted = 1`, финализация только после успешного execute |
| Emergency off + manual fallback | ✅ capability → `rollout_off`; повторный suggest без `ai_request_id`; счётчик провайдер-запросов не вырос |
| Rollout возвращён в off | ✅ `rollout_mode = off`; key/secret-колонок в ai-таблицах нет |

## Находки live-гейта (важно для эксплуатации)

1. **ZDR сужает каталог моделей.** Политика этапа 2.5 (`zdr:true`,
   `data_collection:deny`, `allow_fallbacks:false`, `require_parameters:true`)
   исключает модели без ZDR-endpoint'ов: `openai/gpt-4o-mini`,
   `openai/gpt-4.1-mini`, `anthropic/claude-3.5-haiku` недоступны (404 «No
   endpoints found matching your data policy»); `anthropic/claude-haiku-4.5`
   доступна через Bedrock, но не проходит model test (strict json_schema не
   поддержан endpoint'ом). Рабочие кандидаты на дату отчёта:
   `google/gemini-2.5-flash` (быстрая, рекомендована),
   `qwen/qwen3-235b-a22b-2507`, `deepseek/deepseek-chat-v3-0324`, `z-ai/glm-4.7`
   (медленная constrained-генерация ~10 ток/с — риск таймаутов).
2. **Размер провайдер-батча снижен 15 → 8** (`ainom.ProviderBatchSize`):
   live-замеры показали, что 15 строк не укладываются в 30s-таймаут политики у
   грамматика-провайдеров и упираются в `max_output_tokens=2000` у
   reasoning-моделей. Деградация при этом была корректной (partial assistance,
   гейты честно падали) — но 8 строк проходят с запасом у всех рабочих моделей.
3. Отказ провайдера в eval не даёт ложных подтверждений: соответствующие
   строки уходят в abstain, гейты `provider_ok`/`top-3` валят прогон
   (наблюдалось на ранних итерациях гейта — поведение подтверждено).

## Rollout mode после тестов

`off` (подтверждено финальной проверкой скрипта).

## Known limitations

См. CONTROLLED_AI_ROLLOUT.md §31: один провайдер, нет general availability,
no auto-confirm, acceptance rate — прокси-метрика.

## Owner manual production decisions

1. Выбор/подтверждение production-модели (или подтверждение протестированной
   `google/gemini-2.5-flash`).
2. Состав пилотной группы, бюджет и квоты.
3. Момент перехода pilot_individual в production.
4. Критерии и момент перехода pilot_bulk.
5. Решение об approved-aliases dataset (отдельное разрешение).
