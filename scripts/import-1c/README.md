# Загрузка выгрузки 1С в HUBTender

Разовый перенос `Результаты.csv` (тендеры и версии в прямых затратах) через API Go BFF.
Суммы считает сервер; итог 1С отправляется только как контрольное значение (`total_mismatches`).

```bash
export TENDERHUB_API_URL=https://tender.su10.ru TENDERHUB_EMAIL=… TENDERHUB_PASSWORD=…

node scripts/import-1c/load.mjs                       # офлайн-разбор, без сети
node scripts/import-1c/load.mjs --api --replace 269   # пробный прогон: только чтение портала
node scripts/import-1c/load.mjs --api --commit --replace 269 --create-units [--only 299.2]
node scripts/import-1c/load.mjs --api --purge-old 269 [--yes]   # удалить «269-old» после проверки
node scripts/import-1c/rollback.mjs [--only 299.2] [--restore] [--yes]
node --test scripts/import-1c/*.test.mjs
```

Результаты и решения — в `scripts/import-1c/out/` (в git не попадает):

- `report-*.md` — сводка, блокеры, единицы, статьи затрат, ДОП без родителя, ошибки 1С;
- `*.auto.json` — автоподбор (перезаписывается каждым прогоном);
- `dop-review.xlsx` — разбор ДОП: лист «Не определены» (заполнить обязательно), «Проверить» (пусто —
  оставить автовыбор). В колонке «Решение»: `1`/`2`/`3` — кандидат, номер раздела родителя или `позиция`.
  Файл создаётся один раз и не перезаписывается; чтобы получить новый — удалите его;
- `dop-map.json` (необязательно) — те же решения в JSON, приоритетнее Excel:
  `{"<тендер>|<версия>|<pp_no>": {"parent": "<section_no>", "name": "<имя>"}}` или `"position"`;
- `cost-map.json` — `{"<код статьи 1С>": "<detail_cost_category_id>" | null}`;
- `units-map.json` — `{"items": {"<ед. 1С>": "<код>"}, "customer": {"<текст>": "<код>" | null}}`;
- `manifest.json` — всё созданное загрузкой (для отката).

Правила преобразования и решения пользователя — в плане `replicated-foraging-naur.md`
и памяти проекта `import-1c-loader`.
