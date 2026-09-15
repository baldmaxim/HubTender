import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, message } from 'antd';
import {
  createBenchmarkRange,
  updateBenchmarkRange,
  type BenchmarkRange,
  type BenchmarkRangeInput,
} from '../../../lib/api/costBenchmarks';
import {
  listCostCategories,
  listDetailCostCategoriesWithCategory,
  type CostCategoryRow,
  type DetailCostCategoryWithJoinedCategory,
} from '../../../lib/api/costs';

interface Props {
  open: boolean;
  editing: BenchmarkRange | null;
  onClose: () => void;
  onSaved: () => void;
}

const HOUSING_CLASSES = ['комфорт', 'бизнес', 'премиум', 'делюкс'];
const SCOPES = ['генподряд', 'коробка', 'монолит'];

const EMPTY: BenchmarkRangeInput = {
  metric_kind: 'per_volume_unit',
  level: 'category',
  cost_category_id: null,
  detail_cost_category_id: null,
  housing_class: null,
  construction_scope: null,
  min_value: null,
  max_value: null,
  note: null,
};

/** Создание и правка эталонного диапазона. */
export const BenchmarkRangeForm: React.FC<Props> = ({ open, editing, onClose, onSaved }) => {
  const [form] = Form.useForm<BenchmarkRangeInput>();
  const [cats, setCats] = useState<CostCategoryRow[]>([]);
  const [dets, setDets] = useState<DetailCostCategoryWithJoinedCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const level = Form.useWatch('level', form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(editing ? { ...EMPTY, ...editing } : EMPTY);
    if (cats.length === 0) {
      void Promise.all([listCostCategories(), listDetailCostCategoriesWithCategory()])
        .then(([c, d]) => {
          setCats(c);
          setDets(d);
        })
        .catch((e) => {
          console.error('Ошибка загрузки категорий затрат:', e);
          message.error('Не удалось загрузить категории затрат');
        });
    }
  }, [open, editing, form, cats.length]);

  // У тендера целиком есть только ₽ на м² — переключаем показатель сами.
  useEffect(() => {
    if (level === 'total') form.setFieldValue('metric_kind', 'per_area_sp');
  }, [level, form]);

  const catOptions = useMemo(
    () => cats.map((c) => ({ value: c.id, label: `${c.name} (${c.unit})` })),
    [cats],
  );
  const detOptions = useMemo(
    () =>
      dets.map((d) => ({
        value: d.id,
        label: [d.cost_categories?.name, d.name, (d as { location?: string }).location]
          .filter(Boolean)
          .join(' · '),
      })),
    [dets],
  );

  const submit = async () => {
    const values = await form.validateFields();
    const input: BenchmarkRangeInput = {
      ...EMPTY,
      ...values,
      cost_category_id: values.level === 'category' ? values.cost_category_id : null,
      detail_cost_category_id: values.level === 'detail' ? values.detail_cost_category_id : null,
      note: values.note?.trim() ? values.note.trim() : null,
    };
    setSaving(true);
    try {
      if (editing) await updateBenchmarkRange(editing.id, input);
      else await createBenchmarkRange(input);
      message.success('Диапазон сохранён');
      onSaved();
    } catch (e) {
      const status = (e as { status?: number }).status;
      message.error(
        status === 409
          ? 'На эту цель, класс и объём строительства диапазон уже заведён'
          : (e as Error).message || 'Не удалось сохранить диапазон',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Правка диапазона' : 'Новый диапазон'}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="level" label="Цель" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'category', label: 'Категория затрат' },
              { value: 'detail', label: 'Детализация' },
              { value: 'total', label: 'Тендер целиком' },
            ]}
          />
        </Form.Item>
        {level === 'category' && (
          <Form.Item name="cost_category_id" label="Категория" rules={[{ required: true, message: 'Выберите категорию' }]}>
            <Select showSearch optionFilterProp="label" options={catOptions} />
          </Form.Item>
        )}
        {level === 'detail' && (
          <Form.Item
            name="detail_cost_category_id"
            label="Детализация"
            rules={[{ required: true, message: 'Выберите детализацию' }]}
          >
            <Select showSearch optionFilterProp="label" options={detOptions} />
          </Form.Item>
        )}
        <Form.Item name="metric_kind" label="Показатель" rules={[{ required: true }]}>
          <Select
            disabled={level === 'total'}
            options={[
              { value: 'per_volume_unit', label: '₽ за единицу объёма категории' },
              { value: 'per_area_sp', label: '₽ за м² общей площади по СП' },
            ]}
          />
        </Form.Item>
        <Form.Item name="housing_class" label="Класс жилья">
          <Select allowClear placeholder="любой" options={HOUSING_CLASSES.map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="construction_scope" label="Объём строительства">
          <Select allowClear placeholder="любой" options={SCOPES.map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item
          name="min_value"
          label="От, ₽"
          dependencies={['max_value']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, v) => {
                const max = getFieldValue('max_value');
                if (v == null && max == null) return Promise.reject(new Error('Задайте хотя бы одну границу'));
                if (v != null && max != null && v > max) return Promise.reject(new Error('«От» больше «До»'));
                return Promise.resolve();
              },
            }),
          ]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="max_value" label="До, ₽">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="Примечание">
          <Input.TextArea rows={2} placeholder="откуда ориентир, на какой уровень цен" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
