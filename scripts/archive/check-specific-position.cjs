const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function computeLeafPositions(positions) {
  const leafIds = new Set();

  positions.forEach((position, index) => {
    if (index === positions.length - 1) {
      leafIds.add(position.id);
      return;
    }

    const currentLevel = position.hierarchy_level || 0;
    let nextIndex = index + 1;

    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    if (nextIndex >= positions.length) {
      leafIds.add(position.id);
      return;
    }

    const nextLevel = positions[nextIndex].hierarchy_level || 0;
    if (currentLevel >= nextLevel) {
      leafIds.add(position.id);
    }
  });

  return leafIds;
}

async function checkPosition() {
  try {
    const { data: tender } = await supabase
      .from('tenders')
      .select('id')
      .eq('title', 'ЖК События 6.2')
      .eq('version', 1)
      .single();

    const { data: allPositions } = await supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tender.id)
      .order('position_number', { ascending: true });

    const searchName = 'Устройство монолитных ж/б лестничных маршей и площадок надземной части';
    const position = allPositions.find(p => p.work_name && p.work_name.includes(searchName));

    if (!position) {
      console.log('Позиция не найдена');
      return;
    }

    const leafIds = computeLeafPositions(allPositions);
    const isLeaf = leafIds.has(position.id);

    // Проверить BOQ items
    const { data: boqItems } = await supabase
      .from('boq_items')
      .select('id, total_amount')
      .eq('client_position_id', position.id);

    const hasBOQItems = boqItems && boqItems.length > 0;
    const totalAmount = hasBOQItems
      ? boqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0)
      : null;

    console.log('=== Анализ позиции ===\n');
    console.log(`Номер: ${position.position_number}`);
    console.log(`item_no: ${position.item_no || position.position_number}`);
    console.log(`Название: ${position.work_name}`);
    console.log(`Уровень иерархии: ${position.hierarchy_level || 0}`);
    console.log(`\nЛистовая позиция: ${isLeaf ? 'ДА' : 'НЕТ'}`);
    console.log(`Есть BOQ items: ${hasBOQItems ? 'ДА' : 'НЕТ'} (${boqItems?.length || 0} шт)`);
    console.log(`totalAmount: ${totalAmount}`);
    console.log(`\nДолжна быть красной: ${isLeaf && totalAmount === null ? 'ДА' : 'НЕТ'}`);

    // Проверить логику из styles.ts
    const itemNoStr = String(position.item_no || position.position_number);
    const dotCount = (itemNoStr.match(/\./g) || []).length;
    console.log(`\nПроверка логики подсветки:`);
    console.log(`itemNo: "${itemNoStr}"`);
    console.log(`Точек в номере: ${dotCount}`);
    console.log(`dotCount >= 2: ${dotCount >= 2}`);
    console.log(`\nБудет подсвечена красным (текущая логика): ${isLeaf && totalAmount === null && dotCount >= 2 ? 'ДА' : 'НЕТ'}`);

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

checkPosition();
