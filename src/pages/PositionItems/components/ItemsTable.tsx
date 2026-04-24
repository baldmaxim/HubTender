import { Table, Button, Space, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, DeleteOutlined, LinkOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import type { BoqItemFull, CurrencyType } from '../../../lib/supabase';

const currencySymbols: Record<CurrencyType, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
};

interface ItemsTableProps {
  items: BoqItemFull[];
  loading: boolean;
  expandedRowKeys: string[];
  onExpandedRowsChange: (keys: string[]) => void;
  onEditClick: (record: BoqItemFull) => void;
  onStartDelete: (id: string) => void;
  onToggleDeleteSelection: (id: string) => void;
  onMoveItem: (itemId: string, direction: 'up' | 'down') => void;
  getCurrencyRate: (currency: CurrencyType) => number;
  expandedRowRender: (record: BoqItemFull) => React.ReactNode;
  readOnly?: boolean;
  isDeleteMode?: boolean;
  selectedDeleteIds?: Set<string>;
}

const ItemsTable: React.FC<ItemsTableProps> = ({
  items,
  loading,
  expandedRowKeys,
  onExpandedRowsChange,
  onEditClick,
  onStartDelete,
  onToggleDeleteSelection,
  onMoveItem,
  getCurrencyRate,
  expandedRowRender,
  readOnly,
  isDeleteMode = false,
  selectedDeleteIds = new Set(),
}) => {
  const getRowClassName = (record: BoqItemFull): string => {
    const itemType = record.boq_item_type;

    switch (itemType) {
      case 'раб':
        return 'boq-row-rab';
      case 'суб-раб':
        return 'boq-row-sub-rab';
      case 'раб-комп.':
        return 'boq-row-rab-comp';
      case 'мат':
        return 'boq-row-mat';
      case 'суб-мат':
        return 'boq-row-sub-mat';
      case 'мат-комп.':
        return 'boq-row-mat-comp';
      default:
        return '';
    }
  };

  const canMoveItemUp = (record: BoqItemFull, index: number): boolean => {
    // Привязанный материал
    if (record.parent_work_item_id) {
      const workIndex = items.findIndex(i => i.id === record.parent_work_item_id);
      return index > workIndex + 1;
    }

    // Работа с материалами
    const hasMaterials = items.some(m => m.parent_work_item_id === record.id);
    if (hasMaterials) {
      const firstWorkWithMats = items.findIndex(i =>
        ['раб', 'суб-раб', 'раб-комп.'].includes(i.boq_item_type) &&
        items.some(m => m.parent_work_item_id === i.id)
      );
      return index > firstWorkWithMats;
    }

    // Непривязанный элемент
    const firstUnlinked = items.findIndex(i =>
      !i.parent_work_item_id && !items.some(m => m.parent_work_item_id === i.id)
    );
    return index > firstUnlinked;
  };

  const canMoveItemDown = (record: BoqItemFull, index: number): boolean => {
    // Привязанный материал
    if (record.parent_work_item_id) {
      const lastMaterialIndex = items.findLastIndex(i =>
        i.parent_work_item_id === record.parent_work_item_id
      );
      return index < lastMaterialIndex;
    }

    // Работа с материалами
    const hasMaterials = items.some(m => m.parent_work_item_id === record.id);
    if (hasMaterials) {
      const lastLinkedMaterialIndex = items.findLastIndex(i => i.parent_work_item_id);
      return index < lastLinkedMaterialIndex;
    }

    // Непривязанный элемент
    return index < items.length - 1;
  };

  const calculateTotal = (record: BoqItemFull): number => {
    return record.total_amount || 0;
  };

  const columns: ColumnsType<BoqItemFull> = [
    {
      title: '',
      key: 'sort',
      width: 60,
      align: 'center',
      fixed: 'left',
      render: (_: unknown, record: BoqItemFull, index: number) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Tooltip title="Переместить вверх">
            <Button
              type="text"
              size="small"
              icon={<UpOutlined style={{ fontSize: 12 }} />}
              disabled={readOnly || isDeleteMode || !canMoveItemUp(record, index)}
              onClick={(e) => {
                e.stopPropagation();
                onMoveItem(record.id, 'up');
              }}
              style={{ padding: '2px 4px', height: 20 }}
            />
          </Tooltip>
          <Tooltip title="Переместить вниз">
            <Button
              type="text"
              size="small"
              icon={<DownOutlined style={{ fontSize: 12 }} />}
              disabled={readOnly || isDeleteMode || !canMoveItemDown(record, index)}
              onClick={(e) => {
                e.stopPropagation();
                onMoveItem(record.id, 'down');
              }}
              style={{ padding: '2px 4px', height: 20 }}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Тип</div>,
      key: 'type',
      width: 80,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(record.boq_item_type);
        const itemType = record.boq_item_type;

        let bgColor = '';
        let textColor = '';

        if (['раб', 'суб-раб', 'раб-комп.'].includes(itemType)) {
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

        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none', margin: 0 }}>
              {itemType}
            </Tag>
            {isMaterial && record.material_type && (
              <Tag
                style={{
                  backgroundColor: record.material_type === 'основн.' ? 'rgba(255, 152, 0, 0.12)' : 'rgba(21, 101, 192, 0.12)',
                  color: record.material_type === 'основн.' ? '#fb8c00' : '#1976d2',
                  border: 'none',
                  margin: 0,
                  fontSize: 11,
                }}
              >
                {record.material_type}
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Затрата на стр-во</div>,
      key: 'cost_category',
      width: 150,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        if (!record.detail_cost_category_full || record.detail_cost_category_full === '-') {
          return '-';
        }

        // Извлекаем только первый уровень (категорию)
        const parts = record.detail_cost_category_full.split(' / ');
        const categoryName = parts[0] || '-';

        return (
          <Tooltip title={record.detail_cost_category_full}>
            <span style={{ cursor: 'help' }}>{categoryName}</span>
          </Tooltip>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Наименование</div>,
      key: 'name',
      width: 200,
      render: (_: unknown, record: BoqItemFull) => {
        const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(record.boq_item_type);
        const parentWork = record.parent_work_item_id
          ? items.find(item => item.id === record.parent_work_item_id)
          : null;

        return (
          <div style={{ textAlign: 'left' }}>
            <div>{record.work_name || record.material_name}</div>
            {isMaterial && parentWork && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                <LinkOutlined style={{ marginRight: 4 }} />
                {parentWork.work_name}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>К перв</div>,
      dataIndex: 'conversion_coefficient',
      key: 'conversion',
      width: 70,
      align: 'center',
      render: (value: number) => value?.toFixed(4) || '-',
    },
    {
      title: <div style={{ textAlign: 'center' }}>К расх</div>,
      dataIndex: 'consumption_coefficient',
      key: 'consumption',
      width: 70,
      align: 'center',
      render: (value: number) => value?.toFixed(4) || '-',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Кол-во</div>,
      dataIndex: 'quantity',
      key: 'quantity',
      width: 90,
      align: 'center',
      render: (value: number, record: BoqItemFull) => {
        const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(record.boq_item_type);
        const displayValue = value?.toFixed(5) || '-';

        if (isMaterial && value) {
          let tooltipTitle = '';
          if (record.parent_work_item_id) {
            const parentWork = items.find(item => item.id === record.parent_work_item_id);
            const workQty = parentWork?.quantity || 0;
            const convCoef = record.conversion_coefficient || 1;
            const consCoef = record.consumption_coefficient || 1;
            tooltipTitle = `Кол-во = ${workQty.toFixed(5)} (кол-во работы) × ${convCoef.toFixed(4)} (К перв) × ${consCoef.toFixed(4)} (К расх) = ${displayValue}`;
          } else if (record.base_quantity) {
            const baseQty = record.base_quantity;
            const consCoef = record.consumption_coefficient || 1;
            tooltipTitle = `Кол-во = ${baseQty.toFixed(5)} (базовое кол-во)\nК расх ${consCoef.toFixed(4)} применяется к итоговой сумме`;
          }

          return (
            <Tooltip title={tooltipTitle}>
              <span style={{ cursor: 'help', borderBottom: '1px dotted' }}>{displayValue}</span>
            </Tooltip>
          );
        }

        return displayValue;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Ед.изм.</div>,
      dataIndex: 'unit_code',
      key: 'unit',
      width: 70,
      align: 'center',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Цена за ед.</div>,
      key: 'price',
      width: 100,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        const symbol = currencySymbols[record.currency_type || 'RUB'];
        return record.unit_rate
          ? `${record.unit_rate.toLocaleString('ru-RU')} ${symbol}`
          : '-';
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Доставка</div>,
      key: 'delivery',
      width: 110,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(record.boq_item_type);

        if (!isMaterial || !record.delivery_price_type) {
          return '-';
        }

        if (record.delivery_price_type === 'в цене') {
          return 'Включена';
        } else if (record.delivery_price_type === 'не в цене') {
          const unitRate = record.unit_rate || 0;
          const rate = getCurrencyRate(record.currency_type as CurrencyType);
          const unitPriceInRub = unitRate * rate;
          const deliveryAmount = unitPriceInRub * 0.03;

          const tooltipTitle = `${deliveryAmount.toFixed(2)} = ${unitPriceInRub.toFixed(2)} × 3%`;

          return (
            <Tooltip title={tooltipTitle}>
              <span style={{ cursor: 'help', borderBottom: '1px dotted' }}>
                {deliveryAmount.toFixed(2)}
              </span>
            </Tooltip>
          );
        } else if (record.delivery_price_type === 'суммой' && record.delivery_amount) {
          return `${record.delivery_amount.toLocaleString('ru-RU')}`;
        }

        return '-';
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      key: 'total',
      width: 100,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        const total = calculateTotal(record);
        const displayValue = total > 0 ? `${total.toLocaleString('ru-RU')}` : '-';

        if (total > 0) {
          const qty = record.quantity || 0;
          const price = record.unit_rate || 0;
          const rate = getCurrencyRate(record.currency_type || 'RUB');

          const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(record.boq_item_type);
          let tooltipTitle = '';

          if (isMaterial) {
            let deliveryPrice = 0;
            if (record.delivery_price_type === 'не в цене') {
              deliveryPrice = price * rate * 0.03;
            } else if (record.delivery_price_type === 'суммой') {
              deliveryPrice = record.delivery_amount || 0;
            }

            const consCoef = !record.parent_work_item_id ? (record.consumption_coefficient || 1) : 1;
            if (consCoef !== 1) {
              tooltipTitle = `${total.toFixed(2)} = ${qty.toFixed(5)} × ${consCoef.toFixed(4)} (К расх) × (${price.toFixed(2)} * ${rate.toFixed(2)} + ${deliveryPrice.toFixed(2)})`;
            } else {
              tooltipTitle = `${total.toFixed(2)} = ${qty.toFixed(5)} × (${price.toFixed(2)} * ${rate.toFixed(2)} + ${deliveryPrice.toFixed(2)})`;
            }
          } else {
            tooltipTitle = `${total.toFixed(2)} = ${qty.toFixed(5)} × (${price.toFixed(2)} * ${rate.toFixed(2)} + 0)`;
          }

          return (
            <Tooltip title={tooltipTitle}>
              <span style={{ cursor: 'help', borderBottom: '1px dotted' }}>{displayValue}</span>
            </Tooltip>
          );
        }

        return displayValue;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Ссылка на КП</div>,
      dataIndex: 'quote_link',
      key: 'quote_link',
      width: 100,
      align: 'center',
      render: (value: string) => {
        if (!value) return '-';

        const isUrl = value.startsWith('http://') || value.startsWith('https://');

        if (isUrl) {
          return (
            <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff' }}>
              Ссылка
            </a>
          );
        }

        return value;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Примечание</div>,
      dataIndex: 'description',
      key: 'description',
      width: 120,
      align: 'center',
      render: (value: string) => value || '-',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Действия</div>,
      key: 'actions',
      width: 100,
      align: 'center',
      render: (_: unknown, record: BoqItemFull) => {
        if (isDeleteMode) {
          const isSelected = selectedDeleteIds.has(record.id);
          return (
            <Tooltip title={isSelected ? 'Отменить выбор' : 'Выбрать для удаления'}>
              <Tag
                color={isSelected ? 'error' : 'default'}
                style={{
                  cursor: 'pointer',
                  margin: 0,
                  backgroundColor: isSelected ? '#ff4d4f' : undefined,
                  borderColor: isSelected ? '#ff4d4f' : undefined,
                  color: isSelected ? '#fff' : undefined,
                }}
                onClick={(e) => { e.stopPropagation(); onToggleDeleteSelection(record.id); }}
              >
                <DeleteOutlined />
              </Tag>
            </Tooltip>
          );
        }

        return (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEditClick(record)}
              disabled={readOnly || (expandedRowKeys.length > 0 && !expandedRowKeys.includes(record.id))}
            />
            <Tooltip title="Удалить">
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                disabled={readOnly}
                onClick={(e) => { e.stopPropagation(); onStartDelete(record.id); }}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={items}
      rowKey="id"
      rowClassName={getRowClassName}
      loading={loading}
      pagination={false}
      scroll={{ y: 'calc(100vh - 500px)' }}
      size="small"
      expandable={{
        showExpandColumn: false,
        expandedRowKeys: expandedRowKeys,
        onExpand: (expanded, record) => {
          onExpandedRowsChange(expanded ? [record.id] : []);
        },
        expandedRowRender,
      }}
    />
  );
};

export default ItemsTable;
