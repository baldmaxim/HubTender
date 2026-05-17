# scripts/yandex-preflight

Локальный **безопасный read-only preflight** для Yandex Managed PostgreSQL target.

Только проверяет готовность target-кластера. **НЕ** мигрирует, **НЕ** импортирует данные,
**НЕ** создаёт таблицы/триггеры, **НЕ** включает расширения, **НЕ** меняет `DATABASE_URL`.

Контекст: [docs/yandex-migration/00_SOURCE_OF_TRUTH.md](../../docs/yandex-migration/00_SOURCE_OF_TRUTH.md),
[01_YANDEX_TARGET_INVENTORY.md](../../docs/yandex-migration/01_YANDEX_TARGET_INVENTORY.md),
[05_CUTOVER_RULES.md](../../docs/yandex-migration/05_CUTOVER_RULES.md).

## Файлы

| Файл | Назначение |
|---|---|
| `.env.yandex-preflight.example` | Шаблон env (только placeholders) |
| `.env.yandex-preflight` | Реальные значения от оператора — **git-ignored, не коммитить** |
| `00_check_yandex_target.mjs` | Read-only preflight-скрипт |
| `../../docs/yandex-migration/06_YANDEX_PREFLIGHT.md` | Отчёт (генерируется скриптом) |

## Использование

```bash
cp scripts/yandex-preflight/.env.yandex-preflight.example \
   scripts/yandex-preflight/.env.yandex-preflight
# заполнить значениями от оператора Yandex-кластера
npm run yandex:preflight
```

Если env не заполнен — скрипт выдаёт понятную ошибку (без stack trace) и выходит с кодом 2.

## Что проверяется

1. Подключение к Yandex PostgreSQL.
2. SSL: строгий TLS (`verify-full` — CA из `YANDEX_SSL_ROOT_CERT` существует, `rejectUnauthorized`).
3. Read-only запросы: `version()`, `server_version`, `TimeZone`, `current_database()`, `current_user`, список расширений.
4. PostgreSQL major == `YANDEX_EXPECTED_PG_MAJOR` (по умолчанию 17).
5. Required extensions: `pgcrypto`, `uuid-ossp` (если нет — blocker, не включаем сами).
6. Пустой/готовый target (user-таблицы; если есть — warning, ничего не удаляем).
7. `LISTEN rowchange` / `UNLISTEN rowchange` через direct/session-safe соединение.
8. Pooler endpoint (только connectivity; transaction-pooler НЕ для LISTEN/NOTIFY).

## Безопасность

- Read-only: только `SELECT` / `SHOW` / `LISTEN` / `UNLISTEN`.
- В вывод/отчёт **никогда** не попадают DSN, пароли, токены, содержимое сертификата;
  host маскируется (`***.mdb.yandexcloud.net`).
- Без CA-файла подключение **не выполняется** (никакого insecure-downgrade).

## Финальные статусы

| Статус | Когда |
|---|---|
| `YANDEX_PREFLIGHT_OK` | connection OK, major == ожидаемой, SSL OK, `pgcrypto`+`uuid-ossp` enabled, target пуст, LISTEN/NOTIFY доступен |
| `YANDEX_PREFLIGHT_OK_WITH_WARNINGS` | блокеров нет, но есть warnings (напр. target не пустой, direct DSN не задан) |
| `YANDEX_PREFLIGHT_FAILED` | есть блокеры (нет связи / SSL / версии / расширений / LISTEN) |

Exit codes: `0` — OK/WITH_WARNINGS, `1` — FAILED, `2` — env не сконфигурирован.

## Проверки самого скрипта

```bash
node --check scripts/yandex-preflight/00_check_yandex_target.mjs
npm run yandex:preflight   # при пустом env — понятная ошибка, не stack trace
```
