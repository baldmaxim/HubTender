import { Button, AutoComplete } from 'antd';
import { DeleteOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';

interface CostOption {
  value: string;
  id: string;
  label: string;
}

interface ItemsToolbarProps {
  isDeleteMode: boolean;
  selectedDeleteCount: number;
  isBulkDeleting: boolean;
  onBulkDelete: () => void;
  onCancelDeleteMode: () => void;
  costSearchText: string;
  setCostSearchText: (v: string) => void;
  setSelectedCostCategoryId: (v: string | null) => void;
  selectedCostCategoryId: string | null;
  getCostCategoryOptions: () => CostOption[];
  onApplyCostToAll: () => void;
  onOpenImport: () => void;
  onClearAll: () => void;
  itemsCount: number;
  disabled: boolean;
  totalSum: number | null;
}

/** Тулбар карточки «Элементы позиции» (десктоп/планшет). На телефоне не рендерится. */
const ItemsToolbar: React.FC<ItemsToolbarProps> = ({
  isDeleteMode,
  selectedDeleteCount,
  isBulkDeleting,
  onBulkDelete,
  onCancelDeleteMode,
  costSearchText,
  setCostSearchText,
  setSelectedCostCategoryId,
  selectedCostCategoryId,
  getCostCategoryOptions,
  onApplyCostToAll,
  onOpenImport,
  onClearAll,
  itemsCount,
  disabled,
  totalSum,
}) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span>Элементы позиции</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {isDeleteMode ? (
        <>
          {selectedDeleteCount > 0 && (
            <Button type="primary" danger icon={<DeleteOutlined />} loading={isBulkDeleting} onClick={onBulkDelete}>
              Удалить ({selectedDeleteCount})
            </Button>
          )}
          <Button onClick={onCancelDeleteMode}>Отменить выбор</Button>
        </>
      ) : (
        <>
          <AutoComplete
            value={costSearchText}
            onChange={(value) => setCostSearchText(value)}
            onSelect={(_value, option: { id?: string; label?: string }) => {
              setSelectedCostCategoryId(option.id ?? null);
              setCostSearchText(option.label ?? '');
            }}
            options={getCostCategoryOptions()}
            placeholder="Выберите затрату на строительство"
            style={{ width: 525 }}
            allowClear
            onClear={() => {
              setCostSearchText('');
              setSelectedCostCategoryId(null);
            }}
            filterOption={false}
            disabled={disabled}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={onApplyCostToAll}
            disabled={!selectedCostCategoryId || itemsCount === 0 || disabled}
          >
            Распространить затрату на все строки
          </Button>
          <Button
            type="default"
            icon={<UploadOutlined />}
            onClick={onOpenImport}
            disabled={disabled}
            style={{ backgroundColor: '#10b981', borderColor: '#10b981', color: 'white' }}
          >
            Импорт из Excel
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onClearAll} disabled={itemsCount === 0 || disabled}>
            Очистить все
          </Button>
        </>
      )}
      <div style={{ fontSize: 16, fontWeight: 'bold' }}>
        Итого: <span style={{ color: '#10b981' }}>{totalSum == null ? '—' : Math.round(totalSum).toLocaleString('ru-RU')}</span>
      </div>
    </div>
  </div>
);

export default ItemsToolbar;
