import {
  Select,
  InputNumber,
  AutoComplete,
  Tag,
  Button,
  Popconfirm,
} from 'antd';
import {
  LinkOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { TemplateItemWithDetails } from '../hooks/useTemplateItems';

const currencySymbols: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
};

export const createTemplateColumns = (
  isCreating: boolean,
  currentItems: TemplateItemWithDetails[],
  templateId: string | undefined,
  isEditing: boolean,
  isAddingItems: boolean,
  currentTheme: string,
  handlers: {
    handleUpdateItemParent: (id: string, parentId: string | null, templateId?: string) => void;
    handleUpdateItemCoeff: (id: string, value: number | null, templateId?: string) => void;
    handleDeleteItem: (id: string) => void;
    handleDeleteTemplateItem: (templateId: string, itemId: string) => void;
    getCostCategoryOptions: (searchText: string) => { value: string; id: string; label: string }[];
    setTemplateItems: (items: TemplateItemWithDetails[]) => void;
    setEditingItems: (items: TemplateItemWithDetails[]) => void;
    setLoadedTemplateItems: (fn: (prev: Record<string, TemplateItemWithDetails[]>) => Record<string, TemplateItemWithDetails[]>) => void;
  }
) => {
  const workItemsForSelect = currentItems.filter((item) => item.kind === 'work');

  return [
    {
      title: 'Вид',
      key: 'item_type',
      width: 100,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        const itemType = record.kind === 'work' ? record.work_item_type : record.material_item_type;
        if (!itemType) return '-';

        let bgColor = '';
        let textColor = '';
        if (record.kind === 'work') {
          switch (itemType) {
            case 'раб':
              bgColor = 'rgba(239, 108, 0, 0.12)';
              textColor = '#f57c00';
              break;
            case 'суб-раб':
              bgColor = 'rgba(106, 27, 154, 0.12)';
              textColor = '#7b1fa2';
              break;
            case 'раб-комп.':
              bgColor = 'rgba(198, 40, 40, 0.12)';
              textColor = '#d32f2f';
              break;
          }
        } else {
          switch (itemType) {
            case 'мат':
              bgColor = 'rgba(21, 101, 192, 0.12)';
              textColor = '#1976d2';
              break;
            case 'суб-мат':
              bgColor = 'rgba(104, 159, 56, 0.12)';
              textColor = '#7cb342';
              break;
            case 'мат-комп.':
              bgColor = 'rgba(0, 105, 92, 0.12)';
              textColor = '#00897b';
              break;
          }
        }

        const materialType = record.kind === 'material' ? record.material_type : null;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none', margin: 0 }}>{itemType}</Tag>
            {materialType && (
              <Tag
                style={{
                  backgroundColor: materialType === 'основн.' ? 'rgba(255, 152, 0, 0.12)' : 'rgba(21, 101, 192, 0.12)',
                  color: materialType === 'основн.' ? '#fb8c00' : '#1976d2',
                  border: 'none',
                  margin: 0,
                  fontSize: 11,
                }}
              >
                {materialType}
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'Наименование',
      key: 'name',
      width: 220,
      align: 'center' as const,
      editable: true,
      render: (record: TemplateItemWithDetails) => {
        if (isCreating || isEditing || isAddingItems) {
          return (
            <div style={{ textAlign: 'left' }}>
              <div>{record.kind === 'work' ? record.work_name : record.material_name}</div>
              {record.kind === 'material' && (
                <Select
                  value={record.parent_work_item_id}
                  onChange={(value) => handlers.handleUpdateItemParent(record.id, value, templateId)}
                  placeholder="Привязка к работе"
                  allowClear
                  style={{ width: '100%', marginTop: 4 }}
                  size="small"
                >
                  {workItemsForSelect.map((work) => (
                    <Select.Option key={work.id} value={work.id}>
                      <LinkOutlined style={{ marginRight: 4 }} />
                      {work.work_name}
                    </Select.Option>
                  ))}
                </Select>
              )}
            </div>
          );
        } else {
          return (
            <div style={{ textAlign: 'left' }}>
              <div>{record.kind === 'work' ? record.work_name : record.material_name}</div>
              {record.kind === 'material' && record.parent_work_name && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  <LinkOutlined style={{ marginRight: 4 }} />
                  {record.parent_work_name}
                </div>
              )}
            </div>
          );
        }
      },
    },
    {
      title: 'Ед.изм',
      key: 'unit',
      width: 70,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) =>
        record.kind === 'work' ? record.work_unit : record.material_unit,
    },
    {
      title: 'Коэф.перев.',
      key: 'conversation_coeff',
      width: 100,
      align: 'center' as const,
      editable: true,
      render: (record: TemplateItemWithDetails) => {
        if (record.kind === 'work') return '-';

        if (isCreating || isEditing || isAddingItems) {
          return (
            <InputNumber
              value={record.conversation_coeff}
              onChange={(value) => handlers.handleUpdateItemCoeff(record.id, value, templateId)}
              placeholder="0.0000"
              precision={4}
              style={{ width: '100%' }}
              disabled={!record.parent_work_item_id}
              parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
            />
          );
        } else {
          return record.conversation_coeff ? record.conversation_coeff.toFixed(4) : '-';
        }
      },
    },
    {
      title: 'Коэф.расх.',
      key: 'consumption_coefficient',
      width: 90,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        if (record.kind === 'work') return '-';
        return record.material_consumption_coefficient
          ? record.material_consumption_coefficient.toFixed(4)
          : '-';
      },
    },
    {
      title: 'Цена',
      key: 'unit_rate',
      width: 80,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        const rate = record.kind === 'work' ? record.work_unit_rate : record.material_unit_rate;
        return rate ? rate.toFixed(2) : '-';
      },
    },
    {
      title: 'Вал.',
      key: 'currency_type',
      width: 60,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        const currency = record.kind === 'work' ? record.work_currency_type : record.material_currency_type;
        return currency ? currencySymbols[currency] || currency : '-';
      },
    },
    {
      title: 'Тип дост.',
      key: 'delivery_price_type',
      width: 90,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        if (record.kind === 'work') return '-';
        return record.material_delivery_price_type || '-';
      },
    },
    {
      title: 'Сумма дост.',
      key: 'delivery_amount',
      width: 90,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        if (record.kind === 'work') return '-';
        if (record.material_delivery_price_type === 'суммой') {
          return record.material_delivery_amount ? record.material_delivery_amount.toFixed(2) : '0.00';
        }
        if (record.material_delivery_price_type === 'не в цене') {
          const unitRate = record.material_unit_rate || 0;
          return (unitRate * 0.03).toFixed(2);
        }
        return '-';
      },
    },
    {
      title: 'Затрата на стр-во',
      key: 'detail_cost_category',
      width: 200,
      align: 'center' as const,
      editable: true,
      render: (record: TemplateItemWithDetails) => {
        if (isCreating || isEditing || isAddingItems) {
          const currentSearchText = record.detail_cost_category_full || '';
          const dynamicOptions = handlers.getCostCategoryOptions(currentSearchText);

          return (
            <AutoComplete
              value={record.detail_cost_category_full || ''}
              onChange={(value) => {
                const updatedItems = currentItems.map((item) => {
                  if (item.id === record.id) {
                    return { ...item, detail_cost_category_full: value };
                  }
                  return item;
                });
                if (isEditing) {
                  handlers.setEditingItems(updatedItems);
                } else if (templateId) {
                  handlers.setLoadedTemplateItems((prev) => ({
                    ...prev,
                    [templateId]: updatedItems,
                  }));
                } else {
                  handlers.setTemplateItems(updatedItems);
                }
              }}
              onSelect={(_value, option: { id?: string; label?: string }) => {
                const updatedItems = currentItems.map((item) => {
                  if (item.id === record.id) {
                    return {
                      ...item,
                      detail_cost_category_id: option.id,
                      detail_cost_category_full: option.label,
                      manual_cost_override: true,
                    };
                  }
                  return item;
                });
                if (isEditing) {
                  handlers.setEditingItems(updatedItems);
                } else if (templateId) {
                  handlers.setLoadedTemplateItems((prev) => ({
                    ...prev,
                    [templateId]: updatedItems,
                  }));
                } else {
                  handlers.setTemplateItems(updatedItems);
                }
              }}
              onClear={() => {
                const updatedItems = currentItems.map((item) => {
                  if (item.id === record.id) {
                    return {
                      ...item,
                      detail_cost_category_id: null,
                      detail_cost_category_full: undefined,
                      manual_cost_override: true,
                    };
                  }
                  return item;
                });
                if (isEditing) {
                  handlers.setEditingItems(updatedItems);
                } else if (templateId) {
                  handlers.setLoadedTemplateItems((prev) => ({
                    ...prev,
                    [templateId]: updatedItems,
                  }));
                } else {
                  handlers.setTemplateItems(updatedItems);
                }
              }}
              options={dynamicOptions}
              placeholder="Выберите затрату"
              style={{ width: '100%' }}
              size="small"
              filterOption={false}
              allowClear
              popupClassName={currentTheme === 'dark' ? 'autocomplete-dark' : ''}
            />
          );
        } else {
          return record.detail_cost_category_full || '-';
        }
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (record: TemplateItemWithDetails) => {
        if (isCreating || isEditing || isAddingItems) {
          return (
            <Popconfirm
              title="Удалить элемент?"
              onConfirm={() => isCreating ? handlers.handleDeleteItem(record.id) : handlers.handleDeleteTemplateItem(templateId!, record.id)}
              okText="Да"
              cancelText="Нет"
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          );
        }

        if (templateId) {
          return (
            <Popconfirm
              title="Удалить элемент?"
              onConfirm={() => handlers.handleDeleteTemplateItem(templateId, record.id)}
              okText="Да"
              cancelText="Нет"
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          );
        }

        return null;
      },
    },
  ];
};

export const getRowClassName = (record: TemplateItemWithDetails) => {
  const itemType = record.kind === 'work' ? record.work_item_type : record.material_item_type;

  if (record.kind === 'work') {
    switch (itemType) {
      case 'раб':
        return 'template-row-rab';
      case 'суб-раб':
        return 'template-row-sub-rab';
      case 'раб-комп.':
        return 'template-row-rab-comp';
      default:
        return '';
    }
  } else {
    switch (itemType) {
      case 'мат':
        return 'template-row-mat';
      case 'суб-мат':
        return 'template-row-sub-mat';
      case 'мат-комп.':
        return 'template-row-mat-comp';
      default:
        return '';
    }
  }
};
