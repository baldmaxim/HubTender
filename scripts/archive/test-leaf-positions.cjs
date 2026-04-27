const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Вычисляет листовые позиции (ТА ЖЕ логика что в useClientPositions и exportPositions)
 */
function computeLeafPositions(positions) {
  const leafIds = new Set();

  positions.forEach((position, index) => {
    // Последняя позиция всегда листовая
    if (index === positions.length - 1) {
      leafIds.add(position.id);
      return;
    }

    const currentLevel = position.hierarchy_level || 0;
    let nextIndex = index + 1;

    // Пропускаем ДОП работы при определении листового узла
    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    if (nextIndex >= positions.length) {
      leafIds.add(position.id);
      return;
    }

    const nextLevel = positions[nextIndex].hierarchy_level || 0;
    // Если текущий уровень >= следующего → листовая
    if (currentLevel >= nextLevel) {
      leafIds.add(position.id);
    }
  });

  return leafIds;
}

async function testLeafPositions() {
  try {
    // Найти тендер
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('id, title, version')
      .eq('title', 'ЖК События 6.2')
      .eq('version', 1)
      .single();

    if (tenderError || !tender) {
      console.error('Ошибка поиска тендера:', tenderError);
      return;
    }

    console.log(`Найден тендер: ${tender.title} Версия ${tender.version}`);
    console.log(`ID: ${tender.id}\n`);

    // Загрузить все позиции
    let allPositions = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('client_positions')
        .select('*')
        .eq('tender_id', tender.id)
        .order('position_number', { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Ошибка загрузки позиций:', error);
        return;
      }

      if (data && data.length > 0) {
        allPositions = [...allPositions, ...data];
        from += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`Загружено ${allPositions.length} позиций\n`);

    // Вычислить листовые позиции
    const leafIds = computeLeafPositions(allPositions);
    console.log(`Листовых позиций: ${leafIds.size}\n`);

    // Проверить конкретные позиции которые пользователь упомянул
    const testPositionNames = [
      'Устройство навесных и декоративных элементов, включая несущий металл',
      'Устройство навесных и декоративных элементов. Материалы уточняются по результатам согласования МОКАПа. Включая несущий металл',
      'Устройство монолитных ж/б стен подземной части толщиной 250, 300 мм (до отм. 0.000), бетон В40, W12, F150, армирование 260кг/м3',
    ];

    console.log('=== Проверка конкретных позиций ===\n');

    for (const testName of testPositionNames) {
      const position = allPositions.find(p =>
        p.work_name && p.work_name.includes(testName.substring(0, 30))
      );

      if (position) {
        const isLeaf = leafIds.has(position.id);
        const nextPosition = allPositions[allPositions.indexOf(position) + 1];

        console.log(`Позиция: ${position.position_number}`);
        console.log(`Название: ${position.work_name}`);
        console.log(`Уровень иерархии: ${position.hierarchy_level || 0}`);
        console.log(`Следующая позиция: ${nextPosition ? nextPosition.position_number : 'нет'}`);
        console.log(`Уровень следующей: ${nextPosition ? (nextPosition.hierarchy_level || 0) : 'н/д'}`);
        console.log(`Листовая: ${isLeaf ? 'ДА ✓' : 'НЕТ ✗'}`);
        console.log(`Должна быть листовой: ${isLeaf ? 'ДА' : 'НЕТ (это раздел)'}`);
        console.log('');
      } else {
        console.log(`Позиция не найдена: ${testName.substring(0, 50)}...\n`);
      }
    }

    // Показать статистику по уровням
    const levelStats = {};
    allPositions.forEach(p => {
      const level = p.hierarchy_level || 0;
      if (!levelStats[level]) {
        levelStats[level] = { total: 0, leaf: 0 };
      }
      levelStats[level].total++;
      if (leafIds.has(p.id)) {
        levelStats[level].leaf++;
      }
    });

    console.log('=== Статистика по уровням иерархии ===\n');
    Object.keys(levelStats).sort((a, b) => Number(a) - Number(b)).forEach(level => {
      const stats = levelStats[level];
      console.log(`Уровень ${level}: всего ${stats.total}, листовых ${stats.leaf} (${Math.round(stats.leaf/stats.total*100)}%)`);
    });

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

testLeafPositions();
