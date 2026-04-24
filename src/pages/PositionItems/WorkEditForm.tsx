import { useState } from 'react';
import { Button, Select, AutoComplete, InputNumber, Input, message } from 'antd';
import { CloseOutlined, SaveOutlined } from '@ant-design/icons';
import type { BoqItemFull, CurrencyType, WorkName } from '../../lib/supabase';

interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

interface WorkEditFormProps {
  record: BoqItemFull;
  workNames: WorkName[];
  costCategories: CostCategoryOption[];
  currencyRates: { usd: number; eur: number; cny: number };
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
  readOnly?: boolean;
}

// Компонент для заголовка поля с опциональной звездочкой
const FieldLabel: React.FC<{ label: string; required?: boolean; align?: 'left' | 'center' }> = ({ label, required, align = 'center' }) => (
  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px', textAlign: align }}>
    {required && <span style={{ color: 'red', marginRight: '4px' }}>*</span>}
    {label}
  </div>
);

// Функция для получения цвета border на основе типа работы
const getBorderColor = (type: string) => {
  switch (type) {
    case 'раб':
      return '#ff9800';
    case 'суб-раб':
      return '#9c27b0';
    case 'раб-комп.':
      return '#f44336';
    default:
      return '#d9d9d9';
  }
};

const WorkEditForm: React.FC<WorkEditFormProps> = ({
  record,
  workNames,
  costCategories,
  currencyRates,
  onSave,
  onCancel,
  readOnly,
}) => {
  const [formData, setFormData] = useState<any>({
    boq_item_type: record.boq_item_type,
    work_name_id: record.work_name_id,
    unit_code: record.unit_code,
    quantity: record.quantity || 0,
    unit_rate: record.unit_rate || 0,
    currency_type: record.currency_type || 'RUB',
    detail_cost_category_id: record.detail_cost_category_id,
    quote_link: record.quote_link || '',
    description: record.description || '',
  });

  const [workSearchText, setWorkSearchText] = useState<string>(record.work_name || '');
  const [costSearchText, setCostSearchText] = useState<string>(record.detail_cost_category_full || '');

  // Функция для получения курса валюты
  const getCurrencyRate = (currency: CurrencyType): number => {
    switch (currency) {
      case 'USD':
        return currencyRates.usd;
      case 'EUR':
        return currencyRates.eur;
      case 'CNY':
        return currencyRates.cny;
      case 'RUB':
      default:
        return 1;
    }
  };

  // Вычисление суммы (полная точность без округления)
  const calculateTotal = (): number => {
    const rate = getCurrencyRate(formData.currency_type);
    const total = formData.quantity * formData.unit_rate * rate;
    return total; // Используем все 5 знаков после запятой, округление только для отображения
  };

  // Обработчик сохранения
  const handleSave = async () => {
    if (!formData.work_name_id) {
      message.error('Выберите наименование работы');
      return;
    }

    if (!formData.quantity || formData.quantity <= 0) {
      message.error('Введите количество');
      return;
    }

    if (!formData.detail_cost_category_id) {
      message.error('Выберите затрату на строительство');
      return;
    }

    const totalAmount = calculateTotal();

    await onSave({
      ...formData,
      total_amount: totalAmount,
    });
  };

  // Получить опции для AutoComplete затрат
  const getCostCategoryOptions = () => {
    return costCategories
      .filter((c) => c.label.toLowerCase().includes(costSearchText.toLowerCase()))
      .map((c) => ({
        value: c.label,
        id: c.value,
        label: c.label,
      }));
  };

  // Получить опции для AutoComplete наименований работ
  const getWorkNameOptions = () => {
    const searchText = workSearchText || '';
    if (searchText.length < 2) return [];

    return workNames
      .filter((w) => w.name.toLowerCase().includes(searchText.toLowerCase()))
      .map((w) => ({
        value: w.id,
        label: w.name,
        id: w.id,
        unit: w.unit,
      }));
  };

  return (
    <fieldset disabled={readOnly} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div style={{ padding: '16px', border: `2px solid ${getBorderColor(formData.boq_item_type)}`, borderRadius: '4px' }}>
      {/* Строка 1: Тип | Наименование | Кол-во | Ед.изм | Валюта | Цена */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <div style={{ width: '120px' }}>
          <FieldLabel label="Тип" />
          <Select
            value={formData.boq_item_type}
            onChange={(value) => setFormData({ ...formData, boq_item_type: value })}
            style={{ width: '100%' }}
            size="small"
            options={[
              { value: 'раб', label: 'раб' },
              { value: 'суб-раб', label: 'суб-раб' },
              { value: 'раб-комп.', label: 'раб-комп.' },
            ]}
          />
        </div>

        <div style={{ flex: 1 }}>
          <FieldLabel label="Наименование" required />
          <AutoComplete
            value={workSearchText}
            onChange={(value) => {
              setWorkSearchText(value);
              // Сбросить work_name_id при изменении текста вручную
              setFormData({
                ...formData,
                work_name_id: null,
                unit_code: null,
              });
            }}
            onSelect={(_value, option: any) => {
              setFormData({
                ...formData,
                work_name_id: option.id,
                unit_code: option.unit,
              });
              setWorkSearchText(option.label);
            }}
            onClear={() => {
              setWorkSearchText('');
              setFormData({
                ...formData,
                work_name_id: null,
                unit_code: null,
              });
            }}
            options={getWorkNameOptions()}
            placeholder="Выберите работу"
            style={{ width: '100%' }}
            size="small"
            filterOption={false}
            allowClear
          />
        </div>

        <div style={{ width: '100px' }}>
          <FieldLabel label="Кол-во" required />
          <InputNumber
            value={formData.quantity}
            onChange={(value) => setFormData({ ...formData, quantity: value || 0 })}
            placeholder="0.00000"
            precision={5}
            style={{ width: '100%' }}
            size="small"
            parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
          />
        </div>

        <div style={{ width: '60px' }}>
          <FieldLabel label="Ед.изм." />
          <Input
            value={formData.unit_code || '-'}
            disabled
            style={{ width: '100%' }}
            size="small"
          />
        </div>

        <div style={{ width: '80px' }}>
          <FieldLabel label="Валюта" />
          <Select
            value={formData.currency_type}
            onChange={(value) => setFormData({ ...formData, currency_type: value })}
            style={{ width: '100%' }}
            size="small"
            options={[
              { value: 'RUB', label: '₽' },
              { value: 'USD', label: '$' },
              { value: 'EUR', label: '€' },
              { value: 'CNY', label: '¥' },
            ]}
          />
        </div>

        <div style={{ width: '120px' }}>
          <FieldLabel label="Цена за ед." />
          <InputNumber
            value={formData.unit_rate}
            onChange={(value) => setFormData({ ...formData, unit_rate: value || 0 })}
            placeholder="0.00"
            precision={2}
            style={{ width: '100%' }}
            size="small"
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
            parser={(value) => value!.replace(/\s/g, '').replace(/,/g, '.')}
          />
        </div>

        <div style={{ width: '120px' }}>
          <FieldLabel label="Итого" />
          <InputNumber
            value={calculateTotal()}
            disabled
            placeholder="0.00"
            precision={2}
            style={{ width: '100%' }}
            size="small"
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
          />
        </div>
      </div>

      {/* Строка 2: Затрата на строительство (на всю ширину) */}
      <div style={{ marginBottom: '12px' }}>
        <FieldLabel label="Затрата на строительство" required />
        <AutoComplete
          value={costSearchText}
          onChange={(value) => {
            setCostSearchText(value);
          }}
          onSelect={(_value, option: any) => {
            setFormData({
              ...formData,
              detail_cost_category_id: option.id,
            });
            setCostSearchText(option.label);
          }}
          options={getCostCategoryOptions()}
          placeholder="Выберите затрату на строительство"
          style={{ width: '100%' }}
          size="small"
          filterOption={false}
          allowClear
          onClear={() => {
            setCostSearchText('');
            setFormData({
              ...formData,
              detail_cost_category_id: null,
            });
          }}
        />
      </div>

      {/* Строка 3: Ссылка на КП | Примечание (50/50) */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <div style={{ flex: 1 }}>
          <FieldLabel label="Ссылка на КП" align="left" />
          <Input
            value={formData.quote_link}
            onChange={(e) => setFormData({ ...formData, quote_link: e.target.value })}
            placeholder="Ссылка на коммерческое предложение"
            style={{ width: '100%' }}
            size="small"
            allowClear
          />
        </div>
        <div style={{ flex: 1 }}>
          <FieldLabel label="Примечание" align="left" />
          <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Примечание к элементу"
            style={{ width: '100%' }}
            size="small"
            allowClear
          />
        </div>
      </div>

      {/* Кнопки действий */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <Button size="small" icon={<CloseOutlined />} onClick={onCancel}>
          Отмена
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          onClick={handleSave}
          style={{ background: '#10b981' }}
        >
          Сохранить
        </Button>
      </div>
    </div>
    </fieldset>
  );
};

export default WorkEditForm;
