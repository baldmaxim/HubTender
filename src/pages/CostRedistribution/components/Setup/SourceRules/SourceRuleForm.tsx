/**
 * Форма добавления правила вычитания
 */

import React, { useState } from 'react';
import { Form, InputNumber, Button, Card, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { CategoryDetailSelector } from '../../shared/CategoryDetailSelector';
import type { CostCategory, DetailCostCategory } from '../../../types';
import type { SourceRule } from '../../../utils';

const BOQ_TYPE_OPTIONS = [
  { value: 'раб', label: 'раб (основная работа)' },
  { value: 'суб-раб', label: 'суб-раб (субподряд)' },
  { value: 'раб-комп.', label: 'раб-комп. (компонент)' },
  { value: 'мат', label: 'мат (основной материал)' },
  { value: 'суб-мат', label: 'суб-мат (субподряд)' },
  { value: 'мат-комп.', label: 'мат-комп. (компонент)' },
];

interface SourceRuleFormProps {
  categories: CostCategory[];
  detailCategories: DetailCostCategory[];
  onAdd: (rule: SourceRule) => void;
  existingRules: SourceRule[];
}

export const SourceRuleForm: React.FC<SourceRuleFormProps> = ({
  categories,
  detailCategories,
  onAdd,
  existingRules,
}) => {
  const [form] = Form.useForm();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<'category' | 'detail'>('detail');

  const handleCategoryChange = (id: string, fullName: string, level: 'category' | 'detail') => {
    setSelectedCategoryId(id);
    setSelectedCategoryName(fullName);
    setSelectedLevel(level);
    form.setFieldValue('category', id);
  };

  const handleAdd = () => {
    form.validateFields().then(() => {
      const percentage = form.getFieldValue('percentage');
      const boqItemTypes: string[] | undefined = form.getFieldValue('boq_item_types');

      if (!selectedCategoryId) {
        return;
      }

      // Проверка на дубликат
      const isDuplicate = existingRules.some(rule => {
        if (selectedLevel === 'category') {
          return rule.level === 'category' && rule.category_id === selectedCategoryId;
        } else {
          return rule.level === 'detail' && rule.detail_cost_category_id === selectedCategoryId;
        }
      });

      if (isDuplicate) {
        form.setFields([
          {
            name: 'category',
            errors: ['Эта затрата уже добавлена'],
          },
        ]);
        return;
      }

      const rule: SourceRule = {
        category_id: selectedLevel === 'category' ? selectedCategoryId : undefined,
        detail_cost_category_id: selectedLevel === 'detail' ? selectedCategoryId : undefined,
        category_name: selectedCategoryName,
        percentage,
        level: selectedLevel,
        boq_item_types: boqItemTypes && boqItemTypes.length > 0 ? boqItemTypes : undefined,
      };

      onAdd(rule);

      // Очистка формы
      form.resetFields();
      setSelectedCategoryId('');
      setSelectedCategoryName('');
    });
  };

  return (
    <Card title="Добавить затрату для вычитания" size="small">
      <Form form={form} layout="vertical">
        <CategoryDetailSelector
          categories={categories}
          detailCategories={detailCategories}
          value={
            selectedCategoryId
              ? { level: selectedLevel, id: selectedCategoryId }
              : undefined
          }
          onChange={handleCategoryChange}
        />

        <Form.Item
          label="Процент вычета"
          name="percentage"
          rules={[
            { required: true, message: 'Укажите процент' },
          ]}
          initialValue={10}
        >
          <InputNumber
            style={{ width: '100%' }}
            min={0.00001}
            max={100}
            step={0.01}
            precision={5}
            addonAfter="%"
            decimalSeparator=","
          />
        </Form.Item>

        <Form.Item
          label="Типы элементов (опционально)"
          name="boq_item_types"
          help="Если не выбрано — правило применяется ко всем типам в категории. Чтобы перераспределять только работы, выберите 'раб', 'суб-раб' и 'раб-комп.'"
        >
          <Select
            mode="multiple"
            placeholder="Все типы"
            options={BOQ_TYPE_OPTIONS}
            allowClear
          />
        </Form.Item>

        <Form.Item>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} block>
            Добавить затрату
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};
