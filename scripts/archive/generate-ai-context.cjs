/**
 * Генератор AI-контекста для Claude Code
 * Создает компактные выжимки из схемы БД для улучшения работы ИИ
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPORTS_DIR = path.join(__dirname, '../supabase/exports');
const AI_CONTEXT_DIR = path.join(__dirname, '../supabase/ai_context');
const PROD_SQL_PATH = path.join(__dirname, '../supabase/schemas/prod.sql');

// Создание директории ai_context если не существует
if (!fs.existsSync(AI_CONTEXT_DIR)) {
  fs.mkdirSync(AI_CONTEXT_DIR, { recursive: true });
}

/**
 * Вычисление SHA256 хэша файла
 */
function getFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Загрузка JSON файла
 */
function loadJSON(filename) {
  const filePath = path.join(EXPORTS_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Сохранение JSON с форматированием
 */
function saveJSON(filename, data) {
  const filePath = path.join(AI_CONTEXT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ Создан: ${filename}`);
}

/**
 * 1. Генерация ai_manifest.json
 */
function generateManifest() {
  const manifest = {
    generated_at: new Date().toISOString(),
    version: "1.0.0",
    source_files: {
      prod_sql: getFileHash(PROD_SQL_PATH),
      tables_json: getFileHash(path.join(EXPORTS_DIR, 'tables.json')),
      indexes_json: getFileHash(path.join(EXPORTS_DIR, 'indexes.json')),
      triggers_json: getFileHash(path.join(EXPORTS_DIR, 'triggers.json')),
      functions_json: getFileHash(path.join(EXPORTS_DIR, 'functions.json')),
      enums_json: getFileHash(path.join(EXPORTS_DIR, 'enums.json'))
    }
  };

  saveJSON('ai_manifest.json', manifest);
  return manifest;
}

/**
 * 2. Генерация ai_tables_min.json - компактная схема таблиц
 */
function generateTablesMin() {
  const tables = loadJSON('tables.json');
  const minTables = {};

  for (const [fullName, table] of Object.entries(tables)) {
    // Пропускаем системные таблицы auth, storage, realtime
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.')) {
      continue;
    }

    const columns = table.columns.map(col => ({
      name: col.name,
      type: col.data_type,
      nullable: col.is_nullable,
      default: col.default
    }));

    const constraints = table.constraints || [];
    const pk = constraints.find(c => c.type === 'PRIMARY KEY');
    const fks = constraints.filter(c => c.type === 'FOREIGN KEY').map(fk => ({
      column: fk.column,
      references: `${fk.foreign_table_schema}.${fk.foreign_table}.${fk.foreign_column}`
    }));

    minTables[fullName] = {
      schema: table.schema,
      name: table.name,
      comment: table.comment || null,
      columns,
      primary_key: pk ? pk.column : null,
      foreign_keys: fks
    };
  }

  saveJSON('ai_tables_min.json', minTables);
  return minTables;
}

/**
 * 3. Генерация ai_relations.json - FK связи между таблицами
 */
function generateRelations() {
  const tables = loadJSON('tables.json');
  const relations = [];

  for (const [fullName, table] of Object.entries(tables)) {
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.')) {
      continue;
    }

    const constraints = table.constraints || [];
    const fks = constraints.filter(c => c.type === 'FOREIGN KEY');

    for (const fk of fks) {
      relations.push({
        from_table: fullName,
        from_column: fk.column,
        to_table: `${fk.foreign_table_schema}.${fk.foreign_table}`,
        to_column: fk.foreign_column,
        constraint_name: fk.name
      });
    }
  }

  saveJSON('ai_relations.json', relations);
  return relations;
}

/**
 * 4. Генерация ai_functions_min.json - сигнатуры функций
 */
function generateFunctionsMin() {
  const functions = loadJSON('functions.json');
  const minFunctions = {};

  for (const [fullName, func] of Object.entries(functions)) {
    // Пропускаем системные функции
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.') || fullName.startsWith('pgsodium.') || fullName.startsWith('extensions.')) {
      continue;
    }

    // Извлекаем сигнатуру и назначение из SQL
    const sql = func.sql || '';
    const purposeMatch = sql.match(/COMMENT ON FUNCTION.*?'(.*?)'/);
    const purpose = purposeMatch ? purposeMatch[1] : (func.comment || 'Function');

    minFunctions[fullName] = {
      schema: func.schema,
      name: func.name,
      returns: func.return_type || 'void',
      purpose: purpose.split('\n')[0] // Первая строка комментария
    };
  }

  saveJSON('ai_functions_min.json', minFunctions);
  return minFunctions;
}

/**
 * 5. Генерация ai_triggers_min.json - триггеры
 */
function generateTriggersMin() {
  const triggers = loadJSON('triggers.json');
  const minTriggers = [];

  for (const [fullName, trigger] of Object.entries(triggers)) {
    // Пропускаем системные триггеры
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.')) {
      continue;
    }

    // Извлекаем функцию из SQL
    const sql = trigger.sql || '';
    const funcMatch = sql.match(/EXECUTE FUNCTION (\w+)\(/);
    const functionName = funcMatch ? funcMatch[1] : 'unknown';

    // Извлекаем событие и момент
    const timingMatch = sql.match(/(BEFORE|AFTER) (INSERT|UPDATE|DELETE)/);
    const timing = timingMatch ? timingMatch[1] : null;
    const event = timingMatch ? timingMatch[2] : null;

    minTriggers.push({
      trigger_name: trigger.name,
      table: `${trigger.schema}.${trigger.table_name}`,
      timing: timing,
      event: event,
      function: functionName
    });
  }

  saveJSON('ai_triggers_min.json', minTriggers);
  return minTriggers;
}

/**
 * 6. Генерация ai_enums_min.json - перечисления
 */
function generateEnumsMin() {
  const enums = loadJSON('enums.json');
  const minEnums = {};

  for (const [fullName, enumType] of Object.entries(enums)) {
    // Пропускаем системные enums
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.')) {
      continue;
    }

    minEnums[fullName] = {
      schema: enumType.schema,
      name: enumType.name,
      values: enumType.values,
      comment: enumType.comment || null
    };
  }

  saveJSON('ai_enums_min.json', minEnums);
  return minEnums;
}

/**
 * 7. Генерация ai_tables_full.json - полная схема с индексами
 */
function generateTablesFull() {
  const tables = loadJSON('tables.json');
  const indexes = loadJSON('indexes.json');
  const fullTables = {};

  for (const [fullName, table] of Object.entries(tables)) {
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.')) {
      continue;
    }

    const tableIndexes = Object.entries(indexes)
      .filter(([idxName]) => idxName.startsWith(`${fullName}.`))
      .map(([_, idx]) => ({
        name: idx.name,
        unique: idx.unique || false,
        columns: idx.column ? [idx.column] : []
      }));

    const constraints = table.constraints || [];
    const checkConstraints = constraints.filter(c => c.type === 'CHECK').map(ck => ({
      name: ck.name,
      definition: ck.definition || 'N/A'
    }));

    const uniqueConstraints = constraints.filter(c => c.type === 'UNIQUE').map(u => ({
      name: u.name,
      column: u.column
    }));

    fullTables[fullName] = {
      schema: table.schema,
      name: table.name,
      comment: table.comment || null,
      columns: table.columns.map(col => ({
        name: col.name,
        type: col.data_type,
        nullable: col.is_nullable,
        default: col.default,
        comment: col.comment || null
      })),
      indexes: tableIndexes,
      check_constraints: checkConstraints,
      unique_constraints: uniqueConstraints
    };
  }

  saveJSON('ai_tables_full.json', fullTables);
  return fullTables;
}

/**
 * 8. Генерация ai_functions_full.json - расширенное описание функций
 */
function generateFunctionsFull() {
  const functions = loadJSON('functions.json');
  const fullFunctions = {};

  for (const [fullName, func] of Object.entries(functions)) {
    if (fullName.startsWith('auth.') || fullName.startsWith('storage.') || fullName.startsWith('realtime.') || fullName.startsWith('pgsodium.') || fullName.startsWith('extensions.')) {
      continue;
    }

    const sql = func.sql || '';

    // Извлекаем таблицы, упоминаемые в функции
    const tableMatches = sql.match(/(?:FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM)\s+(\w+)/gi) || [];
    const affectedTables = [...new Set(tableMatches.map(m => m.split(/\s+/).pop()))];

    // Определяем побочные эффекты
    const sideEffects = [];
    if (sql.includes('INSERT INTO')) sideEffects.push('INSERT');
    if (sql.includes('UPDATE')) sideEffects.push('UPDATE');
    if (sql.includes('DELETE FROM')) sideEffects.push('DELETE');

    fullFunctions[fullName] = {
      schema: func.schema,
      name: func.name,
      returns: func.return_type || 'void',
      comment: func.comment || null,
      affected_tables: affectedTables,
      side_effects: sideEffects,
      is_trigger_function: sql.includes('RETURNS TRIGGER')
    };
  }

  saveJSON('ai_functions_full.json', fullFunctions);
  return fullFunctions;
}

/**
 * 9. Генерация ai_examples.sql - примеры запросов
 */
function generateExamples() {
  const examples = `-- AI Context Examples для TenderHUB
-- Примеры корректных SQL-запросов с учётом триггеров и бизнес-логики

-- ========================================
-- 1. СОЗДАНИЕ ТЕНДЕРА
-- ========================================
-- Тендер - основная сущность, содержит информацию о проекте
INSERT INTO public.tenders (
  title,
  client_name,
  version,
  usd_rate,
  eur_rate,
  cny_rate
) VALUES (
  'Реконструкция офисного здания',
  'ООО "СтройИнвест"',
  1,
  95.50,
  105.20,
  13.10
)
RETURNING id;

-- ========================================
-- 2. СОЗДАНИЕ БИБЛИОТЕК МАТЕРИАЛОВ И РАБОТ
-- ========================================
-- Сначала создаём наименование материала
INSERT INTO public.material_names (name, unit_code)
VALUES ('Цемент М500', 'кг')
RETURNING id;

-- Затем создаём запись в библиотеке материалов с ценами
INSERT INTO public.materials_library (
  material_name_id,
  material_price,
  material_type,
  location_id
) VALUES (
  '...', -- id из material_names
  850.00,
  'основн.',
  '...'  -- id локации
);

-- Аналогично для работ
INSERT INTO public.work_names (name, unit_code)
VALUES ('Кладка кирпича', 'м3')
RETURNING id;

INSERT INTO public.works_library (
  work_name_id,
  work_price,
  location_id
) VALUES (
  '...', -- id из work_names
  4500.00,
  '...'
);

-- ========================================
-- 3. СОЗДАНИЕ ПОЗИЦИЙ ЗАКАЗЧИКА (CLIENT POSITIONS)
-- ========================================
-- Иерархическая структура с parent_id
-- Родительская позиция (раздел)
INSERT INTO public.client_positions (
  tender_id,
  position_number,
  work_name,
  item_no,
  hierarchy_level,
  parent_id
) VALUES (
  '...', -- tender_id
  1,
  'Общестроительные работы',
  '1',
  0,
  NULL
)
RETURNING id;

-- Дочерняя позиция
INSERT INTO public.client_positions (
  tender_id,
  position_number,
  work_name,
  item_no,
  hierarchy_level,
  parent_id,
  manual_volume,
  unit_code
) VALUES (
  '...', -- tender_id
  2,
  'Кладка наружных стен',
  '1.1',
  1,
  '...', -- id родительской позиции
  450.5,
  'м3'
);

-- ========================================
-- 4. СОЗДАНИЕ BOQ ITEMS (WORKS/MATERIALS)
-- ========================================
-- BOQ item с автоматическим расчётом цен через триггеры
INSERT INTO public.boq_items (
  tender_id,
  client_position_id,
  boq_item_type,  -- 'раб', 'мат', 'суб-раб', 'суб-мат', 'раб-комп.', 'мат-комп.'
  work_library_id,
  quantity,
  sort_number
) VALUES (
  '...',  -- tender_id
  '...',  -- client_position_id
  'раб',
  '...',  -- work_library_id
  450.5,
  0
);
-- Триггер автоматически рассчитает:
-- - initial_price (из библиотеки)
-- - calculated_price (с наценками)
-- - total_price (calculated_price * quantity)

-- ========================================
-- 5. СОЗДАНИЕ СХЕМЫ НАЦЕНОК
-- ========================================
-- Тактика наценок
INSERT INTO public.markup_tactics (name, is_global)
VALUES ('Базовая схема наценок', true)
RETURNING id;

-- Параметры наценок (выполняются в порядке order_number)
INSERT INTO public.markup_parameters (
  markup_tactic_id,
  order_number,
  parameter_name,
  base_value,
  coefficient,
  is_percentage
) VALUES
  ('...', 1, 'Материалы базовые', 'Материалы', 1.15, false),
  ('...', 2, 'Работы базовые', 'Работы', 1.25, false),
  ('...', 3, 'НДС 20%', 'Итого материалов + работ', 0.20, true);

-- Привязка тактики к тендеру
UPDATE public.tenders
SET markup_tactic_id = '...'
WHERE id = '...';

-- ========================================
-- 6. ЗАПРОСЫ С УЧЁТОМ ТРИГГЕРОВ
-- ========================================
-- Получение коммерческих стоимостей позиций
SELECT
  cp.id,
  cp.work_name,
  cp.item_no,
  cp.manual_volume,
  SUM(bi.total_price) FILTER (WHERE bi.boq_item_type IN ('мат', 'суб-мат', 'мат-комп.')) AS material_cost_total,
  SUM(bi.total_price) FILTER (WHERE bi.boq_item_type IN ('раб', 'суб-раб', 'раб-комп.')) AS work_cost_total,
  SUM(bi.total_price) AS commercial_total
FROM public.client_positions cp
LEFT JOIN public.boq_items bi ON cp.id = bi.client_position_id
WHERE cp.tender_id = '...'
GROUP BY cp.id, cp.work_name, cp.item_no, cp.manual_volume
ORDER BY cp.position_number;

-- ========================================
-- 7. РАБОТА С ШАБЛОНАМИ
-- ========================================
-- Создание шаблона
INSERT INTO public.templates (name, cost_category_id)
VALUES ('Стандартная кладка стен', '...')
RETURNING id;

-- Добавление работ и материалов в шаблон
INSERT INTO public.template_items (
  template_id,
  kind,  -- 'work' или 'material'
  work_library_id,
  quantity,
  position,
  parent_id
) VALUES (
  '...',
  'work',
  '...',  -- work_library_id
  1.0,
  0,
  NULL
);

INSERT INTO public.template_items (
  template_id,
  kind,
  material_library_id,
  quantity,
  position,
  parent_work_item_id,  -- привязка материала к работе
  conversion_coefficient
) VALUES (
  '...',
  'material',
  '...',
  350.0,
  1,
  '...',  -- parent work item
  350.0   -- расход материала на единицу работы
);

-- ========================================
-- 8. ЗАТРАТЫ НА СТРОИТЕЛЬСТВО
-- ========================================
-- Создание категории затрат
INSERT INTO public.cost_categories (name, sort_number)
VALUES ('Общестроительные работы', 1)
RETURNING id;

-- Детализированная категория с локацией
INSERT INTO public.detail_cost_categories (
  category_id,
  detail_name,
  unit_code,
  location_id
) VALUES (
  '...',
  'Кладка кирпича',
  'м3',
  '...'
);

-- Объёмы работ по тендеру
INSERT INTO public.construction_cost_volumes (
  tender_id,
  detail_cost_category_id,
  work_volume
) VALUES (
  '...',
  '...',
  450.5
);

-- ========================================
-- 9. ОБНОВЛЕНИЕ С ТРИГГЕРАМИ updated_at
-- ========================================
-- При UPDATE автоматически обновляется updated_at
UPDATE public.client_positions
SET manual_volume = 500.0,
    manual_note = 'Корректировка объёма'
WHERE id = '...';
-- Триггер update_client_positions_updated_at автоматически установит updated_at = NOW()

-- ========================================
-- 10. ПЕРЕСЧЁТ КОММЕРЧЕСКИХ СТОИМОСТЕЙ
-- ========================================
-- После изменения тактики наценок пересчитать все BOQ items
UPDATE public.boq_items
SET calculated_price = initial_price -- Триггер пересчитает с новыми наценками
WHERE tender_id = '...';

-- ========================================
-- 11. ИСКЛЮЧЕНИЯ ДЛЯ РОСТА МАТЕРИАЛОВ СУБПОДРЯДА
-- ========================================
-- Создание исключения для конкретной детальной категории
INSERT INTO public.subcontract_growth_exclusions (
  markup_tactic_id,
  detail_cost_category_id,
  excluded
) VALUES (
  '...',  -- markup_tactic_id
  '...',  -- detail_cost_category_id
  true
);

-- ========================================
-- 12. КОМПЛЕКСНЫЙ ЗАПРОС: ФИНАНСОВЫЕ ПОКАЗАТЕЛИ
-- ========================================
SELECT
  t.id AS tender_id,
  t.title,
  t.client_name,
  COUNT(DISTINCT cp.id) AS positions_count,
  COUNT(bi.id) AS items_count,
  COALESCE(SUM(bi.total_amount), 0) AS base_cost,
  COALESCE(SUM(bi.total_price), 0) AS commercial_cost,
  COALESCE(SUM(bi.total_price) - SUM(bi.total_amount), 0) AS profit,
  CASE
    WHEN SUM(bi.total_amount) > 0
    THEN ((SUM(bi.total_price) - SUM(bi.total_amount)) / SUM(bi.total_amount) * 100)
    ELSE 0
  END AS profit_percentage
FROM public.tenders t
LEFT JOIN public.client_positions cp ON t.id = cp.tender_id
LEFT JOIN public.boq_items bi ON cp.id = bi.client_position_id
WHERE t.id = '...'
GROUP BY t.id, t.title, t.client_name;
`;

  const examplesPath = path.join(AI_CONTEXT_DIR, 'ai_examples.sql');
  fs.writeFileSync(examplesPath, examples, 'utf8');
  console.log('✓ Создан: ai_examples.sql');
}

/**
 * Главная функция генерации
 */
function main() {
  console.log('\n🤖 Генерация AI-контекста для Claude Code...\n');

  try {
    generateManifest();
    generateTablesMin();
    generateRelations();
    generateFunctionsMin();
    generateTriggersMin();
    generateEnumsMin();
    generateTablesFull();
    generateFunctionsFull();
    generateExamples();

    console.log('\n✅ Все файлы успешно созданы в supabase/ai_context/\n');

    // Статистика размеров
    console.log('📊 Размеры файлов:');
    const files = fs.readdirSync(AI_CONTEXT_DIR);
    files.forEach(file => {
      const filePath = path.join(AI_CONTEXT_DIR, file);
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`   ${file}: ${sizeKB} KB`);
    });

  } catch (error) {
    console.error('\n❌ Ошибка генерации:', error.message);
    process.exit(1);
  }
}

// Запуск
main();
