import { Button, Space, Popconfirm, Tooltip, Tag } from 'antd';
import { DeleteOutlined, SaveOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { WorkLibraryFull, WorkItemType, CurrencyType, UnitType } from '../../../../lib/supabase';

interface GetColumnsParams {
  currentPage: number;
  pageSize: number;
  isEditing: (record: WorkLibraryFull) => boolean;
  onEdit: (record: Partial<WorkLibraryFull>) => void;
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

export const getWorksTableColumns = (params: GetColumnsParams): any[] => {
  const { currentPage, pageSize, isEditing, onEdit, onSave, onCancel, onDelete, editingKey, selectedUnit } = params;

  return [
    {
      title: '№',
      dataIndex: 'index',
      width: 25,
      editable: true,
      align: 'center' as const,
      render: (_: any, __: any, index: number) => (currentPage - 1) * pageSize + index + 1,
    },
    {
      title: 'Вид работы',
      dataIndex: 'item_type',
      width: 110,
      editable: true,
      align: 'center' as const,
      render: (text: WorkItemType) => {
        let bgColor = '';
        let textColor = '';
        switch (text) {
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
        return <Tag style={{ backgroundColor: bgColor, color: textColor, border: 'none' }}>{text}</Tag>;
      },
    },
    {
      title: 'Наименование работы',
      dataIndex: 'work_name',
      width: 325,
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
      render: (text: UnitType, record: WorkLibraryFull) => {
        if (isEditing(record)) {
          return selectedUnit || text || '-';
        }
        return text;
      },
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
      width: 80,
      editable: true,
      align: 'center' as const,
      render: (value: CurrencyType) => currencySymbols[value] || value,
    },
    {
      title: 'Действия',
      dataIndex: 'operation',
      width: 100,
      editable: true,
      align: 'center' as const,
      render: (_: unknown, record: WorkLibraryFull) => {
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
