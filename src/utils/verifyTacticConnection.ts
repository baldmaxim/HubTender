/**
 * Проверка связи между тендером и тактикой наценок
 */

import { supabase } from '../lib/supabase';

export async function verifyTacticConnection(tenderId?: string) {
  console.log('=== ПРОВЕРКА СВЯЗИ ТЕНДЕР -> ТАКТИКА НАЦЕНОК ===\n');

  try {
    // 1. Получаем список тендеров для проверки
    console.log('1. ТЕНДЕРЫ В СИСТЕМЕ:');
    const { data: tenders, error: tendersError } = await supabase
      .from('tenders')
      .select('id, tender_number, title, markup_tactic_id')
      .limit(10);

    if (tendersError) {
      console.error('❌ Ошибка загрузки тендеров:', tendersError);
      return;
    }

    if (!tenders || tenders.length === 0) {
      console.log('❌ Нет тендеров в БД');
      return;
    }

    console.log(`Найдено тендеров: ${tenders.length}\n`);

    tenders.forEach(tender => {
      const tacticStatus = tender.markup_tactic_id ? '✓' : '✗';
      console.log(`${tacticStatus} ${tender.tender_number}: ${tender.title}`);
      if (tender.markup_tactic_id) {
        console.log(`  └─ markup_tactic_id: ${tender.markup_tactic_id}`);
      } else {
        console.log(`  └─ ⚠️ НЕТ ТАКТИКИ`);
      }
    });

    // Выбираем тендер для детальной проверки
    const targetTenderId = tenderId || tenders[0]?.id;
    const targetTender = tenders.find(t => t.id === targetTenderId);

    if (!targetTender) {
      console.log('\n❌ Тендер не найден');
      return;
    }

    console.log(`\n2. ДЕТАЛЬНАЯ ПРОВЕРКА ТЕНДЕРА: ${targetTender.tender_number}`);
    console.log(`   ID: ${targetTender.id}`);
    console.log(`   markup_tactic_id: ${targetTender.markup_tactic_id || 'НЕТ'}`);

    if (!targetTender.markup_tactic_id) {
      console.log('\n❌ У ТЕНДЕРА НЕТ ПРИВЯЗАННОЙ ТАКТИКИ!');

      // Проверяем доступные тактики
      console.log('\n3. ДОСТУПНЫЕ ТАКТИКИ В СИСТЕМЕ:');
      const { data: tactics } = await supabase
        .from('markup_tactics')
        .select('id, name, created_at')
        .limit(10);

      if (tactics && tactics.length > 0) {
        console.log(`Найдено тактик: ${tactics.length}\n`);
        tactics.forEach(tactic => {
          console.log(`  • ${tactic.id}`);
          console.log(`    Название: ${tactic.name || 'Без названия'}`);
          console.log(`    Создана: ${new Date(tactic.created_at).toLocaleString('ru-RU')}`);
        });

        console.log('\nРЕШЕНИЕ: Привяжите одну из тактик к тендеру:');
        console.log(`UPDATE tenders SET markup_tactic_id = '${tactics[0].id}' WHERE id = '${targetTender.id}';`);
      } else {
        console.log('❌ В системе нет ни одной тактики наценок!');
        console.log('\nРЕШЕНИЕ: Создайте тактику через кнопку "Тест" или в конструкторе тактик');
      }

      return;
    }

    // 3. Загружаем полную информацию о тактике
    console.log('\n3. ТАКТИКА НАЦЕНОК:');
    const { data: tactic, error: tacticError } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('id', targetTender.markup_tactic_id)
      .single();

    if (tacticError || !tactic) {
      console.error(`❌ Тактика ${targetTender.markup_tactic_id} не найдена!`, tacticError);
      console.log('\nПРОБЛЕМА: В тендере указан ID несуществующей тактики');
      return;
    }

    console.log(`✓ Тактика загружена: ${tactic.name || 'Без названия'}`);
    console.log(`  ID: ${tactic.id}`);
    console.log(`  Глобальная: ${tactic.is_global ? 'Да' : 'Нет'}`);
    console.log(`  Создана: ${new Date(tactic.created_at).toLocaleString('ru-RU')}`);

    // 4. Проверяем sequences
    console.log('\n4. ПОСЛЕДОВАТЕЛЬНОСТИ ОПЕРАЦИЙ (sequences):');

    if (!tactic.sequences) {
      console.error('❌ Поле sequences пустое!');
      return;
    }

    const sequences = typeof tactic.sequences === 'string'
      ? JSON.parse(tactic.sequences)
      : tactic.sequences;

    const requiredTypes = ['мат', 'раб', 'суб-мат', 'суб-раб', 'мат-комп.', 'раб-комп.'];

    console.log('Проверка наличия последовательностей для всех типов:\n');

    requiredTypes.forEach(type => {
      const sequence = sequences[type];
      if (sequence && Array.isArray(sequence)) {
        console.log(`✓ "${type}": ${sequence.length} операций`);

        // Показываем первую операцию для примера
        if (sequence.length > 0 && sequence[0]) {
          const firstOp = sequence[0];
          console.log(`    └─ Первая операция: ${firstOp.action1} ${firstOp.operand1Type}`);
          if (firstOp.operand1Type === 'number') {
            console.log(`       Значение: ${firstOp.operand1Key}`);
          }
        }
      } else {
        console.log(`✗ "${type}": НЕТ последовательности`);
      }
    });

    // 5. Проверяем base_costs
    console.log('\n5. БАЗОВЫЕ СТОИМОСТИ (base_costs):');

    if (tactic.base_costs) {
      const baseCosts = typeof tactic.base_costs === 'string'
        ? JSON.parse(tactic.base_costs)
        : tactic.base_costs;

      requiredTypes.forEach(type => {
        const cost = baseCosts[type];
        console.log(`  ${type}: ${cost || 0}`);
      });
    } else {
      console.log('  Используются стоимости из элементов BOQ (base_costs не заданы)');
    }

    // 6. Проверяем элементы BOQ
    console.log('\n6. ЭЛЕМЕНТЫ BOQ ТЕНДЕРА:');

    const { data: boqStats } = await supabase
      .from('boq_items')
      .select('boq_item_type, total_amount')
      .eq('tender_id', targetTender.id);

    if (boqStats && boqStats.length > 0) {
      const typeStats = new Map<string, { count: number; hasAmount: number }>();

      boqStats.forEach(item => {
        const stats = typeStats.get(item.boq_item_type) || { count: 0, hasAmount: 0 };
        stats.count++;
        if (item.total_amount && item.total_amount > 0) {
          stats.hasAmount++;
        }
        typeStats.set(item.boq_item_type, stats);
      });

      console.log(`Всего элементов: ${boqStats.length}\n`);

      typeStats.forEach((stats, type) => {
        const hasSequence = sequences[type] && sequences[type].length > 0;
        const readyStatus = hasSequence && stats.hasAmount > 0 ? '✓' : '✗';

        console.log(`${readyStatus} ${type}: ${stats.count} элементов`);
        console.log(`    С базовой стоимостью: ${stats.hasAmount}`);
        console.log(`    Последовательность: ${hasSequence ? 'Есть' : 'НЕТ'}`);

        if (!hasSequence) {
          console.log(`    ⚠️ Нужна последовательность для типа "${type}"`);
        }
        if (stats.hasAmount === 0) {
          console.log(`    ⚠️ Нет базовых стоимостей для расчета`);
        }
      });
    } else {
      console.log('❌ Нет элементов BOQ для этого тендера');
    }

    // 7. Итоговый статус
    console.log('\n7. ИТОГОВЫЙ СТАТУС:');

    const canCalculate = tactic && sequences && Object.keys(sequences).length > 0;

    if (canCalculate) {
      console.log('✓✓✓ СИСТЕМА ГОТОВА К РАСЧЕТУ КОММЕРЧЕСКИХ СТОИМОСТЕЙ');
      console.log('\nДля расчета нажмите кнопку "Пересчитать" на странице Коммерция');
    } else {
      console.log('❌ СИСТЕМА НЕ ГОТОВА К РАСЧЕТУ');
      console.log('\nНеобходимо:');
      if (!tactic) console.log('  • Создать тактику наценок');
      if (!sequences || Object.keys(sequences).length === 0) {
        console.log('  • Настроить последовательности операций в тактике');
      }
    }

    console.log('\n=== КОНЕЦ ПРОВЕРКИ ===');

  } catch (error) {
    console.error('Критическая ошибка:', error);
  }
}

// Экспортируем в window для вызова из консоли
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).verifyTacticConnection = verifyTacticConnection;
  console.log('Для проверки связи тендер-тактика выполните:');
  console.log('window.verifyTacticConnection() или window.verifyTacticConnection("ID_ТЕНДЕРА")');
}