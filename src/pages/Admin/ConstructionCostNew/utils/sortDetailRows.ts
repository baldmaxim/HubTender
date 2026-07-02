import type { CostRow } from '../types';

// Кастомный порядок для отделочных работ
const finishingWorksOrder: Record<string, number> = {
  'Отделка полов': 1,
  'Отделка Стен': 2,
  'Отделка Потолков': 3,
  'навигация': 4,
  'Почтовые ящики': 5,
  'Лифтовые порталы': 6,
  'Мебель': 7,
};

// Кастомный порядок для дверей по локализациям
const doorsOrder: Record<string, Record<string, number>> = {
  'Автостоянка': {
    'Двери тех помещений': 1,
    'двери кладовых': 2,
    'ворота': 3,
    'противопожарные шторы': 4,
  },
  'МОПы': {
    'двери лифтового холла': 1,
    'двери лестничной клетки': 2,
    'двери квартирные': 3,
    'выход на кровлю': 4,
    'люки скрытые': 5,
    'Двери тех помещений': 6,
    'потолочные люки': 7,
  },
  '1-й этаж лобби': {
    'двери скрытого монтажа': 1,
    'двери входные': 2,
  },
};

// Функция для определения порядка отделочных работ по частичному совпадению
export const getFinishingWorkOrder = (name: string): number => {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('отделка полов')) return 1;
  if (lowerName.includes('отделка стен')) return 2;
  if (lowerName.includes('отделка потолков')) return 3;
  return finishingWorksOrder[name] || 999;
};

export const sortDetailRows = (rows: CostRow[], categoryName: string, locationName?: string): CostRow[] => {
  // Для отделочных работ - всегда первые 3 элемента в строгом порядке внутри любой локализации
  if (categoryName.toLowerCase().includes('отделочн')) {
    const priorityItems: CostRow[] = [];
    const otherItems: CostRow[] = [];

    // Разделяем на приоритетные (первые 3) и остальные
    rows.forEach(row => {
      const order = getFinishingWorkOrder(row.detail_category_name);
      if (order <= 3) {
        priorityItems.push(row);
      } else {
        otherItems.push(row);
      }
    });

    // Сортируем приоритетные в строгом порядке 1-2-3
    priorityItems.sort((a, b) => {
      const orderA = getFinishingWorkOrder(a.detail_category_name);
      const orderB = getFinishingWorkOrder(b.detail_category_name);
      return orderA - orderB;
    });

    // Сортируем остальные по своему порядку
    otherItems.sort((a, b) => {
      const orderA = getFinishingWorkOrder(a.detail_category_name);
      const orderB = getFinishingWorkOrder(b.detail_category_name);
      if (orderA !== orderB) return orderA - orderB;
      return (a.order_num || 0) - (b.order_num || 0);
    });

    // Объединяем: сначала приоритетные, потом остальные
    return [...priorityItems, ...otherItems];
  }

  if (categoryName.toLowerCase().includes('двер') && locationName) {
    const locationOrder = doorsOrder[locationName];
    if (locationOrder) {
      return [...rows].sort((a, b) => {
        const orderA = locationOrder[a.detail_category_name] || 999;
        const orderB = locationOrder[b.detail_category_name] || 999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.order_num || 0) - (b.order_num || 0);
      });
    }
  }

  return rows;
};
