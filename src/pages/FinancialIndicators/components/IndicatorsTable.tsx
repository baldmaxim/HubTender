import React, { useState } from 'react';
import { Table, Typography, Tooltip, Button, InputNumber, message } from 'antd';
import { DownloadOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { IndicatorRow } from '../hooks/useFinancialData';
import { exportFinancialIndicatorsToExcel } from '../utils/exportToExcel';
import { supabase } from '../../../lib/supabase';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface IndicatorsTableProps {
  data: IndicatorRow[];
  spTotal: number;
  customerTotal: number;
  formatNumber: (value: number | undefined) => string;
  currentTheme: string;
  tenderTitle: string;
  tenderVersion: number;
  tenderId: string;
  onAreaUpdated: () => void;
}

export const IndicatorsTable: React.FC<IndicatorsTableProps> = ({
  data,
  spTotal,
  customerTotal,
  formatNumber,
  currentTheme,
  tenderTitle,
  tenderVersion,
  tenderId,
  onAreaUpdated,
}) => {
  const [editingSp, setEditingSp] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [tempSpValue, setTempSpValue] = useState<number>(spTotal);
  const [tempCustomerValue, setTempCustomerValue] = useState<number>(customerTotal);

  const handleExport = () => {
    exportFinancialIndicatorsToExcel(data, spTotal, customerTotal, tenderTitle, tenderVersion);
  };

  const handleUpdateArea = async (field: 'area_sp' | 'area_client', value: number) => {
    try {
      const { error } = await supabase
        .from('tenders')
        .update({ [field]: value })
        .eq('id', tenderId);

      if (error) throw error;

      message.success('Площадь обновлена');
      setEditingSp(false);
      setEditingCustomer(false);
      onAreaUpdated();
    } catch (error) {
      message.error('Ошибка обновления площади: ' + getErrorMessage(error));
    }
  };

  const handleCancelEdit = (type: 'sp' | 'customer') => {
    if (type === 'sp') {
      setEditingSp(false);
      setTempSpValue(spTotal);
    } else {
      setEditingCustomer(false);
      setTempCustomerValue(customerTotal);
    }
  };
  const columns: ColumnsType<IndicatorRow> = [
    {
      title: '№ п/п',
      dataIndex: 'row_number',
      key: 'row_number',
      width: 60,
      align: 'center',
    },
    {
      title: 'Наименование',
      dataIndex: 'indicator_name',
      key: 'indicator_name',
      width: 400,
      render: (text, record) => {
        const isIndented = record.row_number >= 2 && record.row_number <= 4;
        const content = (
          <Text
            strong={record.is_header || record.is_total}
            style={isIndented ? { paddingLeft: '40px' } : {}}
          >
            {text}
          </Text>
        );

        if (record.tooltip) {
          return (
            <Tooltip title={<pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{record.tooltip}</pre>}>
              {content}
            </Tooltip>
          );
        }

        return content;
      },
    },
    {
      title: 'коэф-ты',
      dataIndex: 'coefficient',
      key: 'coefficient',
      width: 120,
      align: 'center',
    },
    {
      title: (
        <div style={{ textAlign: 'center' }}>
          <div>Площадь по СП</div>
          {editingSp ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <InputNumber
                value={tempSpValue}
                onChange={(value) => setTempSpValue(value || 0)}
                style={{ width: 100 }}
                size="small"
                precision={2}
              />
              <CheckOutlined
                style={{ color: '#52c41a', cursor: 'pointer' }}
                onClick={() => handleUpdateArea('area_sp', tempSpValue)}
              />
              <CloseOutlined
                style={{ color: '#ff4d4f', cursor: 'pointer' }}
                onClick={() => handleCancelEdit('sp')}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span>{formatNumber(spTotal)} м²</span>
              <EditOutlined
                style={{ fontSize: 12, cursor: 'pointer', color: '#1890ff' }}
                onClick={() => {
                  setTempSpValue(spTotal);
                  setEditingSp(true);
                }}
              />
            </div>
          )}
        </div>
      ),
      key: 'sp_cost',
      width: 150,
      align: 'center',
      render: (_, record) => {
        if (record.is_header) return 'стоимость на 1м²';
        return <Text strong={record.is_total}>{formatNumber(record.sp_cost)}</Text>;
      },
    },
    {
      title: (
        <div style={{ textAlign: 'center' }}>
          <div>Площадь Заказчика</div>
          {editingCustomer ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <InputNumber
                value={tempCustomerValue}
                onChange={(value) => setTempCustomerValue(value || 0)}
                style={{ width: 100 }}
                size="small"
                precision={2}
              />
              <CheckOutlined
                style={{ color: '#52c41a', cursor: 'pointer' }}
                onClick={() => handleUpdateArea('area_client', tempCustomerValue)}
              />
              <CloseOutlined
                style={{ color: '#ff4d4f', cursor: 'pointer' }}
                onClick={() => handleCancelEdit('customer')}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span>{formatNumber(customerTotal)} м²</span>
              <EditOutlined
                style={{ fontSize: 12, cursor: 'pointer', color: '#1890ff' }}
                onClick={() => {
                  setTempCustomerValue(customerTotal);
                  setEditingCustomer(true);
                }}
              />
            </div>
          )}
        </div>
      ),
      key: 'customer_cost',
      width: 150,
      align: 'center',
      render: (_, record) => {
        if (record.is_header) return 'стоимость на 1м²';
        return <Text strong={record.is_total}>{formatNumber(record.customer_cost)}</Text>;
      },
    },
    {
      title: 'Итого',
      dataIndex: 'total_cost',
      key: 'total_cost',
      width: 200,
      align: 'right',
      render: (value, record) => {
        if (record.is_header) return 'итоговая стоимость';
        return <Text strong={record.is_total}>{formatNumber(value)}</Text>;
      },
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
        >
          Экспорт в Excel
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={data}
        pagination={false}
        bordered
        size="small"
        rowClassName={(record) => {
          if (record.is_header) return `header-row-${currentTheme}`;
          if (record.is_total) return `total-row-${currentTheme}`;
          if (record.is_yellow) return `yellow-row-${currentTheme}`;
          return '';
        }}
      />
      <style>{`
        .header-row-light {
          background-color: #e6f7ff !important;
          font-weight: bold;
        }
        .total-row-light {
          background-color: #f0f0f0 !important;
          font-weight: bold;
        }
        .yellow-row-light {
          background-color: #fff9e6 !important;
        }
        .header-row-dark {
          background-color: #1f1f1f !important;
          font-weight: bold;
        }
        .total-row-dark {
          background-color: #262626 !important;
          font-weight: bold;
        }
        .yellow-row-dark {
          background-color: #3a3a1a !important;
        }
      `}</style>
    </>
  );
};
