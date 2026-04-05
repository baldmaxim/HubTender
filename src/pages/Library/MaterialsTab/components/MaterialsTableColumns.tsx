import { Button, Space, Popconfirm, Tooltip, Tag } from 'antd';
import { DeleteOutlined, SaveOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { MaterialLibraryFull, ItemType, MaterialType, CurrencyType, UnitType, DeliveryPriceType } from '../../../../lib/supabase';

interface GetColumnsParams {
  currentPage: number;
  pageSize: number;
  isEditing: (record: MaterialLibraryFull) => boolean;
  onEdit: (record: Partial<MaterialLibraryFull>) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  editingKey: string;
  selectedUnit: UnitType | null;
}

const currencySymbols: Record<CurrencyType, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥'
};

export const getMaterialsTableColumns = (params: GetColumnsParams): any[] => {
  const { currentPage, pageSize, isEditing, onEdit, onSave, onCancel, onDelete, editingKey, selectedUnit } = params;

  return [
    {
      title: '№',
      dataIndex: 'index',
      width: 50,
      editable: true,
      align: 'center' as const,
      render: (_: any, __: any, index: number) => (currentPage - 1) * pageSize + index + 1,
    },
    {
      title: 'Вид материала',
      dataIndex: 'item_type',
      width: 110,
      editable: true,
      align: 'center' as const,
      render: (text: ItemType) => {
        let bgColor = '';
        let textColor = '';
        switch (text) {
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
        return <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none' }}>{text}</Tag>;
      },
    },
    {
      title: 'Тип материала',
      dataIndex: 'material_type',
      width: 110,
      editable: true,
      align: 'center' as const,
      render: (text: MaterialType) => {
        const bgColor = text === 'основн.' ? 'rgba(255, 152, 0, 0.12)' : 'rgba(21, 101, 192, 0.12)';
        const textColor = text === 'основн.' ? '#fb8c00' : '#1976d2';
        return <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none' }}>{text}</Tag>;
      },
    },
    {
      title: 'Наименование материала',
      dataIndex: 'material_name',
      width: 250,
      editable: true,
      align: 'center' as const,
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Ед.изм',
      dataIndex: 'unit',
      width: 80,
      editable: true,
      align: 'center' as const,
      render: (text: UnitType, record: MaterialLibraryFull) => {
        if (isEditing(record)) {
          return selectedUnit || text || '-';
        }
        return text;
      },
    },
    {
      title: 'Коэфф. расхода',
      dataIndex: 'consumption_coefficient',
      width: 120,
      editable: true,
      align: 'center' as const,
      render: (value: number) => value?.toFixed(4),
    },
    {
      title: 'Цена за ед.',
      dataIndex: 'unit_rate',
      width: 100,
      editable: true,
      align: 'center' as const,
      render: (value: number) => value?.toFixed(2),
    },
    {
      title: 'Валюта',
      dataIndex: 'currency_type',
      width: 100,
      editable: true,
      align: 'center' as const,
      render: (value: CurrencyType) => currencySymbols[value] || value,
    },
    {
      title: 'Тип доставки',
      dataIndex: 'delivery_price_type',
      width: 120,
      editable: true,
      align: 'center' as const,
      render: (text: DeliveryPriceType) => text,
    },
    {
      title: 'Сумма доставки',
      dataIndex: 'delivery_amount',
      width: 110,
      editable: true,
      align: 'center' as const,
      render: (value: number, record: MaterialLibraryFull) => {
        if (record.delivery_price_type === 'суммой') {
          return value?.toFixed(2);
        }
        if (record.delivery_price_type === 'не в цене') {
          const unitRate = record.unit_rate || 0;
          return (unitRate * 0.03).toFixed(2);
        }
        return '-';
      },
    },
    {
      title: 'Действия',
      dataIndex: 'operation',
      width: 100,
      editable: true,
      align: 'center' as const,
      render: (_: unknown, record: MaterialLibraryFull) => {
        const editable = isEditing(record);
        return editable ? (
          <Space size="small">
            <Tooltip title="Сохранить">
              <Button
                type="text"
                icon={<SaveOutlined />}
                onClick={() => onSave(record.id)}
              />
            </Tooltip>
            <Tooltip title="Отмена">
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={onCancel}
              />
            </Tooltip>
          </Space>
        ) : (
          <Space size="small">
            <Tooltip title="Редактировать">
              <Button
                type="text"
                icon={<EditOutlined />}
                disabled={editingKey !== ''}
                onClick={() => onEdit(record)}
              />
            </Tooltip>
<Tooltip title="Удалить">
              <Popconfirm
                title="Удалить?"
                onConfirm={() => onDelete(record.id)}
                okText="Да"
                cancelText="Нет"
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={editingKey !== ''}
                />
              </Popconfirm>
            </Tooltip>
          </Space>
        );
      },
    },
  ];
};
