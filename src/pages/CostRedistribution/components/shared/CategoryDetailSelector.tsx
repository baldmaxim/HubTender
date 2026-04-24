/**
 * Селектор для выбора категории ИЛИ детализации (два отдельных Select)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Select, Space, Form } from 'antd';
import type { CostCategory, DetailCostCategory } from '../../types';

interface CategoryDetailSelectorProps {
  categories: CostCategory[];
  detailCategories: DetailCostCategory[];
  value?: { level: 'category' | 'detail'; id: string };
  onChange?: (id: string, fullName: string, level: 'category' | 'detail') => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const CategoryDetailSelector: React.FC<CategoryDetailSelectorProps> = ({
  categories,
  detailCategories,
  value,
  onChange,
  disabled = false,
  style,
}) => {
  const [selectionLevel, setSelectionLevel] = useState<'category' | 'detail' | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedDetailId, setSelectedDetailId] = useState<string | undefined>();

  // Обновление состояния при изменении value prop
  useEffect(() => {
    if (value) {
      setSelectionLevel(value.level);
      if (value.level === 'category') {
        setSelectedCategoryId(value.id);
        setSelectedDetailId(undefined);
      } else {
        setSelectedDetailId(value.id);
        setSelectedCategoryId(undefined);
      }
    } else {
      setSelectionLevel(null);
      setSelectedCategoryId(undefined);
      setSelectedDetailId(undefined);
    }
  }, [value]);

  const handleCategorySelect = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (category) {
      setSelectionLevel('category');
      setSelectedCategoryId(categoryId);
      setSelectedDetailId(undefined);
      onChange?.(category.id, category.name, 'category');
    }
  };

  const handleDetailSelect = (detailId: string) => {
    const detail = detailCategories.find(d => d.id === detailId);
    if (detail) {
      setSelectionLevel('detail');
      setSelectedDetailId(detailId);
      setSelectedCategoryId(undefined);
      onChange?.(detail.id, detail.full_name, 'detail');
    }
  };

  const handleCategoryClear = () => {
    setSelectionLevel(null);
    setSelectedCategoryId(undefined);
    onChange?.('', '', 'category');
  };

  const handleDetailClear = () => {
    setSelectionLevel(null);
    setSelectedDetailId(undefined);
    onChange?.('', '', 'detail');
  };

  // Стабильные options для Select — иначе Ant Design считает их новыми и
  // перерисовывает dropdown-виртуализацию при каждом рендере родителя.
  const categoryOptions = useMemo(
    () => categories.map(cat => ({ label: cat.name, value: cat.id })),
    [categories]
  );
  const detailOptions = useMemo(
    () => detailCategories.map(detail => ({ label: detail.full_name, value: detail.id })),
    [detailCategories]
  );

  return (
    <Space direction="vertical" style={{ width: '100%', ...style }}>
      <Form.Item label="Категория" style={{ marginBottom: 0 }}>
        <Select
          style={{ width: '100%' }}
          placeholder="Выбрать категорию целиком"
          value={selectedCategoryId}
          onChange={handleCategorySelect}
          onClear={handleCategoryClear}
          disabled={disabled || selectionLevel === 'detail'}
          allowClear
          showSearch
          optionFilterProp="children"
          filterOption={(input, option) =>
            (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={categoryOptions}
        />
      </Form.Item>

      <Form.Item label="или Детализация" style={{ marginBottom: 0 }}>
        <Select
          style={{ width: '100%' }}
          placeholder="Выбрать конкретную детализацию"
          value={selectedDetailId}
          onChange={handleDetailSelect}
          onClear={handleDetailClear}
          disabled={disabled || selectionLevel === 'category'}
          allowClear
          showSearch
          optionFilterProp="children"
          filterOption={(input, option) =>
            (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={detailOptions}
        />
      </Form.Item>
    </Space>
  );
};
