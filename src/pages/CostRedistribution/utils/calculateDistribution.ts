/**
 * Утилита для расчета перераспределения стоимости работ между затратами
 */

export interface SourceRule {
  category_id?: string; // ID категории (если выбрана вся категория)
  detail_cost_category_id?: string; // ID детализированной категории (если выбрана конкретная)
  category_name: string;
  percentage: number;
  level: 'category' | 'detail'; // Уровень выбора
}

export interface TargetCost {
  category_id?: string; // ID категории (если выбрана вся категория)
  detail_cost_category_id?: string; // ID детализированной категории (если выбрана конкретная)
  category_name: string;
  level: 'category' | 'detail'; // Уровень выбора
}

export interface BoqItemWithCosts {
  id: string;
  client_position_id: string;
  detail_cost_category_id: string | null;
  boq_item_type: string;
  total_commercial_work_cost: number;
  total_commercial_material_cost: number;
}

export interface RedistributionResult {
  boq_item_id: string;
  original_work_cost: number;
  deducted_amount: number;
  added_amount: number;
  final_work_cost: number;
}

export interface RedistributionCalculationResult {
  results: RedistributionResult[];
  totalDeducted: number;
  totalAdded: number;
  isBalanced: boolean;
}

// Индексы для быстрого поиска items по категории. Строятся один раз
// в calculateRedistribution и передаются во все helpers.
interface BoqItemIndex {
  byDetailId: Map<string, BoqItemWithCosts[]>;
  byCategoryId: Map<string, BoqItemWithCosts[]>;
  byId: Map<string, BoqItemWithCosts>;
}

function buildBoqItemIndex(
  boqItems: BoqItemWithCosts[],
  detailCategoriesMap?: Map<string, string>
): BoqItemIndex {
  const byDetailId = new Map<string, BoqItemWithCosts[]>();
  const byCategoryId = new Map<string, BoqItemWithCosts[]>();
  const byId = new Map<string, BoqItemWithCosts>();

  for (const item of boqItems) {
    byId.set(item.id, item);
    const did = item.detail_cost_category_id;
    if (!did) continue;

    const detailList = byDetailId.get(did);
    if (detailList) detailList.push(item);
    else byDetailId.set(did, [item]);

    const cid = detailCategoriesMap?.get(did);
    if (!cid) continue;
    const catList = byCategoryId.get(cid);
    if (catList) catList.push(item);
    else byCategoryId.set(cid, [item]);
  }

  return { byDetailId, byCategoryId, byId };
}

/**
 * Шаг 1: Вычисление сумм вычета для каждого правила
 */
export function calculateDeductions(
  boqItems: BoqItemWithCosts[],
  sourceRules: SourceRule[],
  detailCategoriesMap?: Map<string, string>, // detail_cost_category_id -> cost_category_id
  index?: BoqItemIndex
): Map<string, { deductedAmount: number; affectedItems: string[] }> {
  const deductions = new Map<string, { deductedAmount: number; affectedItems: string[] }>();
  const idx = index ?? buildBoqItemIndex(boqItems, detailCategoriesMap);

  for (const rule of sourceRules) {
    let itemsInCategory: BoqItemWithCosts[] = [];

    if (rule.level === 'detail' && rule.detail_cost_category_id) {
      // Выбрана конкретная detail категория
      itemsInCategory = idx.byDetailId.get(rule.detail_cost_category_id) ?? [];
    } else if (rule.level === 'category' && rule.category_id) {
      // Выбрана вся категория - все items под её detail-ами уже преиндексированы
      itemsInCategory = idx.byCategoryId.get(rule.category_id) ?? [];
    }

    if (itemsInCategory.length === 0) {
      // Пустая категория - пропускаем правило
      continue;
    }

    // Суммировать стоимость работ
    const totalCost = itemsInCategory.reduce(
      (sum, item) => sum + item.total_commercial_work_cost,
      0
    );

    // Рассчитать сумму к вычету
    const deductedAmount = (totalCost * rule.percentage) / 100;

    // Используем уникальный ключ в зависимости от уровня
    const key = rule.level === 'detail' ? rule.detail_cost_category_id! : `cat_${rule.category_id}`;

    deductions.set(key, {
      deductedAmount,
      affectedItems: itemsInCategory.map((item) => item.id),
    });
  }

  return deductions;
}

/**
 * Шаг 2: Применение вычетов равномерно к элементам
 */
export function applyDeductions(
  boqItems: BoqItemWithCosts[],
  deductions: Map<string, { deductedAmount: number; affectedItems: string[] }>,
  boqItemsById?: Map<string, BoqItemWithCosts>
): Map<string, { original: number; deducted: number }> {
  const itemDeductions = new Map<string, { original: number; deducted: number }>();

  // Инициализация для всех элементов
  for (const item of boqItems) {
    itemDeductions.set(item.id, {
      original: item.total_commercial_work_cost,
      deducted: 0,
    });
  }

  // Переиспользуем готовый индекс из calculateRedistribution, если передан.
  const boqItemsMap = boqItemsById ?? new Map(boqItems.map(item => [item.id, item]));

  // Применяем вычеты ПРОПОРЦИОНАЛЬНО стоимости каждого элемента
  for (const [, { deductedAmount, affectedItems }] of deductions) {
    if (affectedItems.length === 0) continue;

    // Рассчитать общую стоимость затронутых элементов
    const totalCost = affectedItems.reduce((sum, itemId) => {
      const item = boqItemsMap.get(itemId);
      return sum + (item?.total_commercial_work_cost || 0);
    }, 0);

    if (totalCost === 0) {
      // Деление на ноль - равномерное распределение как fallback
      const deductPerItem = deductedAmount / affectedItems.length;
      for (const itemId of affectedItems) {
        const current = itemDeductions.get(itemId)!;
        itemDeductions.set(itemId, {
          ...current,
          deducted: current.deducted + deductPerItem,
        });
      }
      continue;
    }

    // Пропорциональное распределение по стоимости
    for (const itemId of affectedItems) {
      const item = boqItemsMap.get(itemId);
      if (!item) continue;

      const proportion = item.total_commercial_work_cost / totalCost;
      const deductForItem = deductedAmount * proportion;

      const current = itemDeductions.get(itemId)!;
      itemDeductions.set(itemId, {
        ...current,
        deducted: current.deducted + deductForItem,
      });
    }
  }

  return itemDeductions;
}

/**
 * Шаг 3: Пропорциональное добавление к целевым затратам
 */
export function calculateAdditions(
  boqItems: BoqItemWithCosts[],
  targetCosts: TargetCost[],
  totalDeduction: number,
  detailCategoriesMap?: Map<string, string>, // detail_cost_category_id -> cost_category_id
  index?: BoqItemIndex
): Map<string, number> {
  const itemAdditions = new Map<string, number>();

  // Инициализация для всех элементов
  for (const item of boqItems) {
    itemAdditions.set(item.id, 0);
  }

  if (totalDeduction === 0 || targetCosts.length === 0) {
    return itemAdditions;
  }

  // Найти все элементы в целевых категориях — идём через преиндекс вместо
  // boqItems.filter(...) с вложенным targetCosts.some(...).
  const idx = index ?? buildBoqItemIndex(boqItems, detailCategoriesMap);
  const targetItems: BoqItemWithCosts[] = [];
  const seenIds = new Set<string>();
  for (const target of targetCosts) {
    let bucket: BoqItemWithCosts[] = [];
    if (target.level === 'detail' && target.detail_cost_category_id) {
      bucket = idx.byDetailId.get(target.detail_cost_category_id) ?? [];
    } else if (target.level === 'category' && target.category_id) {
      bucket = idx.byCategoryId.get(target.category_id) ?? [];
    }
    for (const it of bucket) {
      if (seenIds.has(it.id)) continue;
      seenIds.add(it.id);
      targetItems.push(it);
    }
  }

  if (targetItems.length === 0) {
    return itemAdditions;
  }

  // Рассчитать общую базу для пропорционального распределения
  const totalTargetCost = targetItems.reduce(
    (sum, item) => sum + item.total_commercial_work_cost,
    0
  );

  if (totalTargetCost === 0) {
    // Деление на ноль - равномерное распределение
    const addPerItem = totalDeduction / targetItems.length;
    for (const item of targetItems) {
      itemAdditions.set(item.id, addPerItem);
    }
    return itemAdditions;
  }

  // Пропорциональное распределение
  for (const item of targetItems) {
    const proportion = item.total_commercial_work_cost / totalTargetCost;
    const addAmount = totalDeduction * proportion;
    itemAdditions.set(item.id, addAmount);
  }

  return itemAdditions;
}

/**
 * Главная функция: полный расчет перераспределения
 */
export function calculateRedistribution(
  boqItems: BoqItemWithCosts[],
  sourceRules: SourceRule[],
  targetCosts: TargetCost[],
  detailCategoriesMap?: Map<string, string> // detail_cost_category_id -> cost_category_id
): RedistributionCalculationResult {
  // Преиндекс: строим byDetailId / byCategoryId / byId один раз и передаём
  // во все helpers. Убирает O(rules × items) и пересборку Map внутри applyDeductions.
  const index = buildBoqItemIndex(boqItems, detailCategoriesMap);

  // Шаг 1: Рассчитать вычеты
  const deductions = calculateDeductions(boqItems, sourceRules, detailCategoriesMap, index);

  // Шаг 2: Применить вычеты
  const itemDeductions = applyDeductions(boqItems, deductions, index.byId);

  // Рассчитать общую сумму вычета
  const totalDeducted = Array.from(itemDeductions.values()).reduce(
    (sum, { deducted }) => sum + deducted,
    0
  );

  // Шаг 3: Рассчитать добавления
  const itemAdditions = calculateAdditions(boqItems, targetCosts, totalDeducted, detailCategoriesMap, index);

  // Рассчитать общую сумму добавления
  const totalAdded = Array.from(itemAdditions.values()).reduce((sum, added) => sum + added, 0);

  // Шаг 4: Сформировать результаты
  const results: RedistributionResult[] = boqItems.map((item) => {
    const deduction = itemDeductions.get(item.id)!;
    const addition = itemAdditions.get(item.id) || 0;

    return {
      boq_item_id: item.id,
      original_work_cost: deduction.original,
      deducted_amount: deduction.deducted,
      added_amount: addition,
      final_work_cost: deduction.original - deduction.deducted + addition,
    };
  });

  // Проверка баланса с толерантностью 0.01
  const isBalanced = Math.abs(totalDeducted - totalAdded) < 0.01;

  return {
    results,
    totalDeducted,
    totalAdded,
    isBalanced,
  };
}
