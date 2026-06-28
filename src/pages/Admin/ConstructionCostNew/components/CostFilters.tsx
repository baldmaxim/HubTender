import React from 'react';
import { Space, Typography, Segmented, Button, Input } from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../../../hooks/useIsMobile';

const { Text } = Typography;

interface CostFiltersProps {
  costType: 'base' | 'commercial';
  viewMode: 'detailed' | 'summary' | 'simplified';
  searchText: string;
  onCostTypeChange: (value: 'base' | 'commercial') => void;
  onViewModeChange: (value: 'detailed' | 'summary' | 'simplified') => void;
  onSearchChange: (value: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExport: () => void;
  disableExport: boolean;
}

const CostFilters: React.FC<CostFiltersProps> = ({
  costType,
  viewMode,
  searchText,
  onCostTypeChange,
  onViewModeChange,
  onSearchChange,
  onExpandAll,
  onCollapseAll,
  onExport,
  disableExport,
}) => {
  const { isPhone, isPhoneDevice } = useIsMobile();

  const viewModeOptions = [
    { label: 'Детальное', value: 'detailed' },
    { label: 'Итоговое', value: 'summary' },
    { label: 'Упрощенное', value: 'simplified' },
  ];

  const expandButtons = (
    <Space>
      <Button size="small" onClick={onExpandAll}>
        Развернуть все
      </Button>
      <Button size="small" onClick={onCollapseAll}>
        Свернуть все
      </Button>
    </Space>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isPhone ? 'stretch' : 'flex-start',
          flexDirection: isPhone ? 'column' : 'row',
          gap: isPhone ? 12 : 0,
        }}
      >
        {/* Левая часть */}
        <Space direction="vertical" size="middle" style={isPhone ? { width: '100%' } : undefined}>
          <Space wrap>
            <Text>Тип затрат:</Text>
            <Segmented
              block={isPhone}
              options={[
                { label: 'Прямые затраты', value: 'base' },
                { label: 'Коммерческие затраты', value: 'commercial' },
              ]}
              value={costType}
              onChange={(value) => onCostTypeChange(value as 'base' | 'commercial')}
            />
          </Space>
          {isPhone ? (
            <>
              {/* Представление — отдельной строкой под «Тип затрат» (блочный сегмент) */}
              <Segmented
                block
                options={viewModeOptions}
                value={viewMode}
                onChange={(value) => onViewModeChange(value as 'detailed' | 'summary' | 'simplified')}
              />
              {expandButtons}
            </>
          ) : (
            <Space size="large" wrap>
              <Space>
                <Text>Представление:</Text>
                <Segmented
                  options={viewModeOptions}
                  value={viewMode}
                  onChange={(value) => onViewModeChange(value as 'detailed' | 'summary' | 'simplified')}
                />
              </Space>
              {expandButtons}
            </Space>
          )}
        </Space>

        {/* Правая часть */}
        <Space
          direction="vertical"
          size="middle"
          align={isPhone ? 'start' : 'end'}
          style={isPhone ? { width: '100%' } : undefined}
        >
          {!isPhoneDevice && (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={onExport}
              disabled={disableExport}
            >
              Экспорт
            </Button>
          )}
          <Input
            placeholder="Поиск..."
            prefix={<SearchOutlined />}
            style={{ width: isPhone ? '100%' : 300 }}
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            allowClear
          />
        </Space>
      </div>
    </div>
  );
};

export default CostFilters;
