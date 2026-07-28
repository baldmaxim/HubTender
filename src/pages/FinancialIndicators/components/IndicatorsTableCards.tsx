import React, { useState } from 'react';
import { Typography, Tooltip, InputNumber, Tag, Space } from 'antd';
import { InfoCircleOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { IndicatorRow } from '../hooks/useFinancialData';

const { Text } = Typography;

interface IndicatorsTableCardsProps {
  data: IndicatorRow[];
  spTotal: number;
  customerTotal: number;
  formatNumber: (value: number | undefined) => string;
  currentTheme: string;
  onUpdateArea: (field: 'area_sp' | 'area_client', value: number) => void | Promise<void>;
  /** Только просмотр — скрывает карандаши редактирования площади (Генеральный директор) */
  readOnly?: boolean;
}

const ROW_COLORS = {
  light: { header: '#e6f7ff', total: '#f0f0f0', yellow: '#fff9e6', normal: '#ffffff', border: '#f0f0f0' },
  dark: { header: '#1f1f1f', total: '#262626', yellow: '#3a3a1a', normal: 'transparent', border: '#303030' },
} as const;

/** Редактируемое значение площади (для телефонного карточного вида). */
const AreaRow: React.FC<{
  label: string;
  value: number;
  formatNumber: (value: number | undefined) => string;
  onSave: (value: number) => void | Promise<void>;
  readOnly?: boolean;
}> = ({ label, value, formatNumber, onSave, readOnly }) => {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState<number>(value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <Text type="secondary">{label}</Text>
      {editing ? (
        <Space size={4}>
          <InputNumber
            value={temp}
            onChange={(v) => setTemp(v || 0)}
            style={{ width: 120 }}
            size="small"
            precision={2}
            decimalSeparator=","
            autoFocus
          />
          <CheckOutlined
            style={{ color: '#52c41a', cursor: 'pointer' }}
            onClick={async () => {
              await onSave(temp);
              setEditing(false);
            }}
          />
          <CloseOutlined
            style={{ color: '#ff4d4f', cursor: 'pointer' }}
            onClick={() => {
              setTemp(value);
              setEditing(false);
            }}
          />
        </Space>
      ) : (
        <Space size={4}>
          <Text strong>{formatNumber(value)} м²</Text>
          {!readOnly && (
            <EditOutlined
              style={{ fontSize: 12, cursor: 'pointer', color: '#1890ff' }}
              onClick={() => {
                setTemp(value);
                setEditing(true);
              }}
            />
          )}
        </Space>
      )}
    </div>
  );
};

export const IndicatorsTableCards: React.FC<IndicatorsTableCardsProps> = ({
  data,
  spTotal,
  customerTotal,
  formatNumber,
  currentTheme,
  onUpdateArea,
  readOnly,
}) => {
  const c = currentTheme === 'dark' ? ROW_COLORS.dark : ROW_COLORS.light;

  const valueLine = (label: string, value: React.ReactNode, strong?: boolean) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      <Text strong={strong} style={{ textAlign: 'right' }}>{value}</Text>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Редактируемые площади (на десктопе живут в заголовках колонок) */}
      <div
        style={{
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: c.normal,
        }}
      >
        <AreaRow label="Площадь по СП" value={spTotal} formatNumber={formatNumber} onSave={(v) => onUpdateArea('area_sp', v)} readOnly={readOnly} />
        <AreaRow label="Площадь Заказчика" value={customerTotal} formatNumber={formatNumber} onSave={(v) => onUpdateArea('area_client', v)} readOnly={readOnly} />
      </div>

      {data.map((record) => {
        const isIndented = record.is_indented === true;
        const bg = record.is_header ? c.header : record.is_total ? c.total : record.is_yellow ? c.yellow : c.normal;
        const emphatic = record.is_header || record.is_total;

        const name = (
          <Space size={6} align="start" style={{ paddingLeft: isIndented ? 16 : 0 }}>
            <Text strong={emphatic} style={{ fontSize: emphatic ? 14 : 13 }}>{record.indicator_name}</Text>
            {record.tooltip && (
              <Tooltip title={<pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{record.tooltip}</pre>}>
                <InfoCircleOutlined style={{ color: '#1890ff', fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
        );

        return (
          <div
            key={record.key}
            style={{
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: 12,
              background: bg,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {name}
              {record.coefficient && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {record.coefficient.split(',').map((part, i) => (
                    <Tag key={i} style={{ margin: 0, fontSize: 11 }}>{part.trim()}</Tag>
                  ))}
                </div>
              )}
            </div>

            {record.is_header ? null : (
              <>
                {valueLine('Стоимость на 1м² (СП)', formatNumber(record.sp_cost), record.is_total)}
                {valueLine('Стоимость на 1м² (Заказчик)', formatNumber(record.customer_cost), record.is_total)}
                {valueLine('Итого', formatNumber(record.total_cost), record.is_total)}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
