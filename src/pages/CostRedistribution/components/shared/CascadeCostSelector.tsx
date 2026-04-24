/**
 * Каскадный селектор для выбора затраты: Категория → Детализация → Локация
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Cascader } from 'antd';
import type { CascaderProps } from 'antd';
import type { CostCategory, DetailCostCategory } from '../../types';

interface Option {
  value: string;
  label: string;
  children?: Option[];
  isLeaf?: boolean;
}

interface CascadeCostSelectorProps {
  categories: CostCategory[];
  detailCategories: DetailCostCategory[];
  value?: string; // detail_cost_category_id или category_id
  onChange?: (id: string, fullName: string, level: 'category' | 'detail') => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const CascadeCostSelector: React.FC<CascadeCostSelectorProps> = ({
  categories,
  detailCategories,
  value,
  onChange,
  placeholder = 'Выберите затрату на строительство',
  disabled = false,
  style,
}) => {
  const [selectedValue, setSelectedValue] = useState<string[]>([]);

  // Иерархия опций — чистый derived-state через useMemo; useEffect+setOptions
  // заставлял рендериться дважды (сначала с [], потом с данными) и пересоздавал
  // массив даже когда categories/detailCategories не менялись.
  const options = useMemo<Option[]>(() => {
    // Преиндекс detailCategories по cost_category_id — O(n) вместо n*filter на каждую категорию.
    const detailsByCategory = new Map<string, DetailCostCategory[]>();
    for (const detail of detailCategories) {
      const bucket = detailsByCategory.get(detail.cost_category_id);
      if (bucket) bucket.push(detail);
      else detailsByCategory.set(detail.cost_category_id, [detail]);
    }

    return categories.map(category => {
      const details = detailsByCategory.get(category.id) ?? [];

      const detailGroups = new Map<string, DetailCostCategory[]>();
      for (const detail of details) {
        const list = detailGroups.get(detail.name);
        if (list) list.push(detail);
        else detailGroups.set(detail.name, [detail]);
      }

      const detailOptions: Option[] = Array.from(detailGroups.entries()).map(
        ([detailName, detailItems]) => {
          if (detailItems.length > 1 || detailItems[0].location) {
            return {
              value: `detail_${detailName}`,
              label: detailName,
              children: detailItems.map(item => ({
                value: item.id,
                label: item.location || 'Без локации',
                isLeaf: true,
              })),
            };
          }
          return {
            value: detailItems[0].id,
            label: detailName,
            isLeaf: true,
          };
        }
      );

      return {
        value: category.id,
        label: category.name,
        children: detailOptions,
      };
    });
  }, [categories, detailCategories]);

  // Обновление selectedValue при изменении value prop
  useEffect(() => {
    if (!value) {
      setSelectedValue([]);
      return;
    }

    // Найти путь к выбранной детализации
    const detail = detailCategories.find(d => d.id === value);
    if (!detail) {
      setSelectedValue([]);
      return;
    }

    const category = categories.find(c => c.id === detail.cost_category_id);
    if (!category) {
      setSelectedValue([]);
      return;
    }

    // Проверяем, есть ли у этой детализации локация
    const siblingsWithSameName = detailCategories.filter(
      d => d.cost_category_id === detail.cost_category_id && d.name === detail.name
    );

    if (siblingsWithSameName.length > 1 || detail.location) {
      // Есть локация - 3 уровня
      setSelectedValue([category.id, `detail_${detail.name}`, detail.id]);
    } else {
      // Нет локации - 2 уровня
      setSelectedValue([category.id, detail.id]);
    }
  }, [value, categories, detailCategories]);

  const handleChange: CascaderProps<Option>['onChange'] = (valueArray) => {
    if (!valueArray || valueArray.length === 0) {
      onChange?.('', '', 'detail');
      return;
    }

    const selectedId = valueArray[valueArray.length - 1] as string;

    // Проверяем уровень выбора
    if (valueArray.length === 1) {
      // Выбрана категория целиком
      const category = categories.find(c => c.id === selectedId);
      if (category) {
        onChange?.(category.id, category.name, 'category');
      }
    } else {
      // Выбрана детализация (с локацией или без)
      const detail = detailCategories.find(d => d.id === selectedId);
      if (detail) {
        onChange?.(detail.id, detail.full_name, 'detail');
      }
    }
  };

  return (
    <Cascader
      options={options}
      value={selectedValue}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      style={style}
      changeOnSelect={true}
      showSearch={{
        filter: (inputValue, path) =>
          path.some(
            option =>
              option.label?.toString().toLowerCase().includes(inputValue.toLowerCase())
          ),
      }}
    />
  );
};
