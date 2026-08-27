#!/usr/bin/env node
/**
 * Тонкий CLI к API архива смет — для вызовов из терминала и из агента Cursor.
 *
 * Ключ берётся ТОЛЬКО из окружения: в аргументы командной строки он не
 * передаётся (иначе осел бы в истории шелла и в логах агента).
 *
 *   TENDERHUB_API_KEY=thk_...           обязателен
 *   TENDERHUB_API_URL=https://tender.su10.ru   по умолчанию
 *
 * Примеры:
 *   node scripts/archive-api.mjs search "устройство стяжки" --unit=м2 --limit=5
 *   node scripts/archive-api.mjs position <uuid>
 *   node scripts/archive-api.mjs tenders --search=ЖК --archived=false
 *   node scripts/archive-api.mjs positions <tender_id>
 *   node scripts/archive-api.mjs suggest "кладка стен" "монтаж дверей"
 *   node scripts/archive-api.mjs compose ./compose.json --dry-run
 */

const BASE = process.env.TENDERHUB_API_URL ?? 'https://tender.su10.ru';
const KEY = process.env.TENDERHUB_API_KEY;

if (!KEY) {
  console.error('Не задан TENDERHUB_API_KEY. Выпустите ключ: Настройки → Доступ к API.');
  process.exit(2);
}

const flags = new Map();
const positional = [];
for (const arg of process.argv.slice(3)) {
  if (arg.startsWith('--')) {
    const [name, value] = arg.slice(2).split('=');
    flags.set(name, value ?? 'true');
  } else {
    positional.push(arg);
  }
}

async function request(method, path, body) {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'X-API-Key': KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Самая частая ошибка первого запуска — недоступный адрес, а не отказ API.
    console.error(`Не удалось соединиться с ${BASE}: ${err.cause?.code ?? err.message}`);
    console.error('Проверьте TENDERHUB_API_URL, сеть и то, что бэкенд запущен.');
    process.exit(1);
  }
}

async function call(method, path, body) {
  const res = await request(method, path, body);

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // nginx и прочие прокси отвечают HTML — показываем как есть, не молчим.
    console.error(`HTTP ${res.status}, ответ не JSON:\n${text.slice(0, 500)}`);
    process.exit(1);
  }
  if (!res.ok) {
    const code = parsed.code ? ` [${parsed.code}]` : '';
    console.error(`HTTP ${res.status}${code}: ${parsed.detail ?? parsed.title ?? text}`);
    process.exit(1);
  }
  return parsed.data;
}

const command = process.argv[2];

switch (command) {
  case 'search': {
    const q = positional[0];
    if (!q) throw new Error('Укажите строку поиска');
    const params = new URLSearchParams({ q });
    // Слева — как пишут в командной строке, справа — имя параметра API.
    const map = {
      unit: 'unit_code', unit_code: 'unit_code', volume: 'volume', item_no: 'item_no',
      limit: 'limit', min_score: 'min_score', exclude: 'exclude_tender_id',
      exclude_tender_id: 'exclude_tender_id', period_months: 'period_months',
    };
    for (const [flag, param] of Object.entries(map)) {
      const value = flags.get(flag);
      if (value !== undefined) params.set(param, value);
    }
    console.log(JSON.stringify(await call('GET', `/api/v1/archive/positions/search?${params}`), null, 2));
    break;
  }

  case 'position': {
    const id = positional[0];
    if (!id) throw new Error('Укажите id позиции');
    console.log(JSON.stringify(await call('GET', `/api/v1/archive/positions/${id}`), null, 2));
    break;
  }

  case 'suggest': {
    if (positional.length === 0) throw new Error('Укажите одно или несколько названий');
    const body = {
      queries: positional.map((work_name, i) => ({ ref: String(i), work_name })),
      limit_per_query: Number(flags.get('limit') ?? 5),
    };
    console.log(JSON.stringify(await call('POST', '/api/v1/archive/positions/suggest', body), null, 2));
    break;
  }

  case 'compose': {
    const file = positional[0];
    if (!file) throw new Error('Укажите путь к JSON с телом запроса');
    const { readFile } = await import('node:fs/promises');
    const body = JSON.parse(await readFile(file, 'utf8'));
    // Безопасный дефолт: без явного --no-dry-run сборка только проверяется.
    body.dry_run = flags.get('no-dry-run') !== 'true';
    const verbose = flags.get('verbose') === 'true' ? '?verbose=1' : '';
    console.log(JSON.stringify(await call('POST', `/api/v1/archive/compose${verbose}`, body), null, 2));
    break;
  }

  case 'tenders': {
    // Узкий список тендеров — выбрать цель по номеру/названию. Требует области
    // tenders:read; ключ с ограничением по тендерам видит только свои.
    const params = new URLSearchParams();
    if (flags.get('search')) params.set('search', flags.get('search'));
    if (flags.has('archived')) params.set('is_archived', flags.get('archived'));
    const qs = params.toString();
    console.log(JSON.stringify(await call('GET', `/api/v1/tenders/brief${qs ? `?${qs}` : ''}`), null, 2));
    break;
  }

  case 'positions': {
    // Все позиции тендера (страницы склеиваются): сопоставить свои строки с id
    // существующих позиций, отобрать раздел по cost_category_name. Область
    // tenders:read. Порядок API — updated_at DESC, поэтому сортируем по номеру.
    const tenderId = positional[0];
    if (!tenderId) throw new Error('Укажите id тендера');
    const rows = [];
    let cursor = '';
    do {
      const res = await request('GET',
        `/api/v1/tenders/${tenderId}/positions?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = await res.json();
      if (!res.ok) {
        console.error(`HTTP ${res.status}${page.code ? ` [${page.code}]` : ''}: ${page.detail ?? page.title}`);
        process.exit(1);
      }
      rows.push(...page.data);
      cursor = page.next_cursor ?? '';
    } while (cursor);
    rows.sort((a, b) => a.position_number - b.position_number || a.id.localeCompare(b.id));
    const section = flags.get('section');
    console.log(JSON.stringify(
      section ? rows.filter((r) => (r.cost_category_name ?? '').toLowerCase().includes(section.toLowerCase())) : rows,
      null, 2,
    ));
    break;
  }

  case 'spec': {
    const res = await request('GET', '/api/v1/archive/openapi.yaml');
    console.log(await res.text());
    break;
  }

  default:
    console.error(`Команды: search | position | tenders | positions | suggest | compose | spec
  node scripts/archive-api.mjs search "устройство стяжки" --unit=м2 --limit=5
  node scripts/archive-api.mjs position <uuid>
  node scripts/archive-api.mjs tenders --search=ЖК --archived=false   # список тендеров (tenders:read)
  node scripts/archive-api.mjs positions <tender_id> --section=монолит # позиции тендера (tenders:read)
  node scripts/archive-api.mjs suggest "кладка стен" "монтаж дверей"
  node scripts/archive-api.mjs compose ./compose.json            # проба (dry_run)
  node scripts/archive-api.mjs compose ./compose.json --no-dry-run --verbose`);
    process.exit(2);
}
