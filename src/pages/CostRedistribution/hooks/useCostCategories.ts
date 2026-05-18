/**
 * Хук для загрузки иерархии категорий затрат
 */

import { useState, useEffect, useMemo } from 'react';
import { message } from 'antd';
import {
  listCostCategories,
  listAllDetailCostCategoriesByOrder,
} from '../../../lib/api/costs';
import type { CostCategory, DetailCostCategory } from '../types';

export function useCostCategories() {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<CostCategory[]>([]);
  const [detailCategories, setDetailCategories] = useState<DetailCostCategory[]>([]);

  useEffect(() => {
    loadCostCategories();
  }, []);

  const loadCostCategories = async () => {
    setLoading(true);
    try {
      // Go отдаёт всё; .order('name') исходника воспроизводим клиентом.
      const byName = (a: { name: string | null }, b: { name: string | null }) =>
        (a.name || '').localeCompare(b.name || '');

      const categoriesData = (await listCostCategories())
        .slice()
        .sort(byName) as unknown as CostCategory[];

      const detailData = (await listAllDetailCostCategoriesByOrder())
        .slice()
        .sort(byName) as unknown as DetailCostCategory[];

      setCategories(categoriesData || []);

      // Формируем full_name для каждой детализированной категории
      const categoriesMap = new Map(
        (categoriesData || []).map(cat => [cat.id, cat.name])
      );

      const detailWithFullName = (detailData || []).map(detail => ({
        ...detail,
        full_name: `${categoriesMap.get(detail.cost_category_id) || ''} / ${detail.name}${
          detail.location ? ` / ${detail.location}` : ''
        }`,
      }));

      setDetailCategories(detailWithFullName);
    } catch (error) {
      console.error('Ошибка загрузки категорий затрат:', error);
      message.error('Не удалось загрузить категории затрат');
    } finally {
      setLoading(false);
    }
  };

  // Группировка детализированных категорий по категориям
  const categoriesHierarchy = useMemo(() => {
    const hierarchy = new Map<string, DetailCostCategory[]>();

    for (const detail of detailCategories) {
      if (!hierarchy.has(detail.cost_category_id)) {
        hierarchy.set(detail.cost_category_id, []);
      }
      hierarchy.get(detail.cost_category_id)!.push(detail);
    }

    return hierarchy;
  }, [detailCategories]);

  // Получить детализированные категории для конкретной категории
  const getDetailCategories = (categoryId: string): DetailCostCategory[] => {
    return categoriesHierarchy.get(categoryId) || [];
  };

  // Найти детализированную категорию по ID
  const findDetailCategory = (detailId: string): DetailCostCategory | undefined => {
    return detailCategories.find(detail => detail.id === detailId);
  };

  return {
    loading,
    categories,
    detailCategories,
    categoriesHierarchy,
    getDetailCategories,
    findDetailCategory,
    loadCostCategories,
  };
}
