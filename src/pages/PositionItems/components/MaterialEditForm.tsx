import { Button, Select, AutoComplete, InputNumber, Input, Tag } from 'antd';
import { CloseOutlined, SaveOutlined, LinkOutlined } from '@ant-design/icons';
import type { BoqItemFull, MaterialName } from '../../../lib/types';
import { useMaterialEditForm } from '../hooks/useMaterialEditForm';
import { FieldLabel, type CostCategoryOption } from './editFormShared';
import { getBorderColor, getWorkTypeColor } from './editFormColors';

interface MaterialEditFormProps {
  record: BoqItemFull;
  materialNames: MaterialName[];
  workItems: BoqItemFull[]; // Список работ для привязки
  costCategories: CostCategoryOption[];
  currencyRates: { usd: number; eur: number; cny: number };
  gpVolume: number; // Количество ГП из позиции заказчика
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  readOnly?: boolean;
}

const MaterialEditForm: React.FC<MaterialEditFormProps> = ({
  record,
  materialNames,
  workItems,
  costCategories,
  currencyRates,
  gpVolume,
  onSave,
  onCancel,
  readOnly,
}) => {
  const {
    formData,
    setFormData,
    materialSearchText,
    setMaterialSearchText,
    costSearchText,
    setCostSearchText,
    setIsManualQuantity,
    calculateTotal,
    handleSave,
    getCostCategoryOptions,
    getMaterialNameOptions,
  } = useMaterialEditForm({
    record,
    materialNames,
    workItems,
    costCategories,
    currencyRates,
    gpVolume,
    onSave,
  });

  return (
    <fieldset disabled={readOnly} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div style={{ padding: '16px', border: `2px solid ${getBorderColor(formData.boq_item_type)}`, borderRadius: '4px' }}>
      {/* Строка 1: Тип | Вид | Наименование | Привязка */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <div style={{ width: '120px' }}>
          <FieldLabel label="Тип" />
          <Select
            value={formData.boq_item_type}
            onChange={(value) => setFormData({ ...formData, boq_item_type: value })}
            style={{ width: '100%' }}
            size="small"
            options={[
              { value: 'мат', label: 'мат' },
              { value: 'суб-мат', label: 'суб-мат' },
              { value: 'мат-комп.', label: 'мат-комп.' },
            ]}
          />
        </div>

        <div style={{ width: '120px' }}>
          <FieldLabel label="Вид" />
          <Select
            value={formData.material_type}
            onChange={(value) => setFormData({ ...formData, material_type: value })}
            style={{ width: '100%' }}
            size="small"
            options={[
              { value: 'основн.', label: 'основн.' },
              { value: 'вспомогат.', label: 'вспомогат.' },
            ]}
          />
        </div>

        <div style={{ flex: 2 }}>
          <FieldLabel label="Наименование" required />
          <AutoComplete
            value={materialSearchText}
            onChange={(value) => {
              setMaterialSearchText(value);
              // Сбросить material_name_id при изменении текста вручную
              setFormData({
                ...formData,
                material_name_id: null,
                unit_code: null,
              });
            }}
            onSelect={(_value, option: { id?: string; label?: string; unit?: string }) => {
              setFormData({
                ...formData,
                material_name_id: option.id ?? null,
                unit_code: option.unit ?? null,
              });
              setMaterialSearchText(option.label ?? '');
            }}
            onClear={() => {
              setMaterialSearchText('');
              setFormData({
                ...formData,
                material_name_id: null,
                unit_code: null,
              });
            }}
            options={getMaterialNameOptions()}
            placeholder="Выберите материал"
            style={{ width: '100%' }}
            size="small"
            filterOption={false}
            allowClear
          />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px', textAlign: 'center' }}>
            <LinkOutlined style={{ marginRight: 4 }} />
            Привязка
          </div>
          <Select
            value={formData.parent_work_item_id}
            onChange={(value) => {
              // При отвязке сбрасываем conversion_coefficient
              setFormData({
                ...formData,
                parent_work_item_id: value || null,
                conversion_coefficient: value ? formData.conversion_coefficient : 1,
              });
            }}
            style={{ width: '100%' }}
            size="small"
            allowClear
            placeholder="Без привязки"
            optionLabelProp="label"
            options={workItems.map((w) => ({
              value: w.id,
              label: w.work_name,
              boqItemType: w.boq_item_type,
            }))}
            optionRender={(option) => {
              const workItem = workItems.find(w => w.id === option.data.value);
              if (!workItem) return option.data.label;
              const typeColor = getWorkTypeColor(workItem.boq_item_type);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>{option.data.label}</span>
                  <Tag
                    style={{
                      margin: 0,
                      fontSize: '11px',
                      color: typeColor,
                      backgroundColor: `${typeColor}20`,
                      borderColor: `${typeColor}40`,
                    }}
                  >
                    {workItem.boq_item_type}
                  </Tag>
                </div>
              );
            }}
          />
        </div>
      </div>

      {/* Строка 2: К перев | К расх | Баз.кол-во | Кол-во | Ед.изм | Цена | Валюта | Доставка | Сум.дост. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>

        {/* К перев - показываем только если выбрана привязка */}
        {formData.parent_work_item_id && (
          <div style={{ width: '80px' }}>
            <FieldLabel label="К перев" />
            <InputNumber
              value={formData.conversion_coefficient}
              onChange={(value) => setFormData({ ...formData, conversion_coefficient: value || 1 })}
              placeholder="1.00000"
              precision={5}
              style={{ width: '100%' }}
              size="small"
              decimalSeparator=","
              parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
            />
          </div>
        )}

        <div style={{ width: '80px' }}>
          <FieldLabel label="К расх" required />
          <InputNumber
            value={formData.consumption_coefficient}
            onChange={(value) => setFormData({ ...formData, consumption_coefficient: value || 1 })}
            placeholder="1.00000"
            precision={5}
            min={1.0}
            style={{ width: '100%' }}
            size="small"
            decimalSeparator=","
            parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
          />
        </div>

        <div style={{ width: '100px' }}>
          <FieldLabel label="Кол-во" />
          <InputNumber
            value={formData.quantity}
            disabled={!!formData.parent_work_item_id}
            onChange={(value) => {
              // Установить флаг ручного ввода для непривязанных материалов
              if (!formData.parent_work_item_id) {
                setIsManualQuantity(true);
                setFormData({ ...formData, quantity: value || 0 });
              }
            }}
            placeholder="0.00000"
            precision={5}
            style={{ width: '100%' }}
            size="small"
            decimalSeparator=","
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

        <div style={{ width: '100px' }}>
          <FieldLabel label="Цена за ед." />
          <InputNumber
            value={formData.unit_rate}
            onChange={(value) => setFormData({ ...formData, unit_rate: value || 0 })}
            placeholder="0.00"
            precision={2}
            style={{ width: '100%' }}
            size="small"
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',')}
            parser={(value) => parseFloat(value!.replace(/\s/g, '').replace(/,/g, '.'))}
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
          <FieldLabel label="Доставка" />
          <Select
            value={formData.delivery_price_type}
            onChange={(value) => {
              // При смене типа доставки устанавливаем значение по умолчанию
              // Для 'не в цене' используется фиксированный 3%, поэтому delivery_amount = 0
              // Для 'суммой' нужна сумма, по умолчанию 100
              // Для 'в цене' доставка включена, поэтому delivery_amount = 0
              const newDeliveryAmount = value === 'суммой' ? 100 : 0;
              setFormData({ ...formData, delivery_price_type: value, delivery_amount: newDeliveryAmount });
            }}
            style={{ width: '100%' }}
            size="small"
            options={[
              { value: 'в цене', label: 'в цене' },
              { value: 'не в цене', label: 'не в цене' },
              { value: 'суммой', label: 'суммой' },
            ]}
          />
        </div>

        {/* Сумма доставки - показываем только если тип "суммой" */}
        {formData.delivery_price_type === 'суммой' && (
          <div style={{ width: '100px' }}>
            <FieldLabel label="Сум. дост." />
            <InputNumber
              value={formData.delivery_amount}
              onChange={(value) => setFormData({ ...formData, delivery_amount: value || 0 })}
              placeholder="0.00"
              precision={2}
              style={{ width: '100%' }}
              size="small"
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',')}
              parser={(value) => parseFloat(value!.replace(/\s/g, '').replace(/,/g, '.'))}
            />
          </div>
        )}

        <div style={{ width: '120px' }}>
          <FieldLabel label="Итого" />
          <InputNumber
            value={calculateTotal()}
            disabled
            placeholder="0.00"
            precision={2}
            style={{ width: '100%' }}
            size="small"
            decimalSeparator=","
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',')}
          />
        </div>

        {/* Затрата на строительство (flex для заполнения остального пространства) */}
        <div style={{ flex: 1 }}>
          <FieldLabel label="Затрата на строительство" required />
          <AutoComplete
            value={costSearchText}
            onChange={(value) => {
              setCostSearchText(value);
            }}
            onSelect={(_value, option: { id?: string; label?: string }) => {
              setFormData({
                ...formData,
                detail_cost_category_id: option.id ?? null,
              });
              setCostSearchText(option.label ?? '');
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

export default MaterialEditForm;
