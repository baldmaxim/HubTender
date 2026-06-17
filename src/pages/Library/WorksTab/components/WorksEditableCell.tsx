import React from 'react';
import { Form, Input, Select, InputNumber, AutoComplete } from 'antd';
import { WorkLibraryFull, WorkName } from '../../../../lib/supabase';

interface WorksEditableCellProps {
  editing: boolean;
  dataIndex: string;
  title: string;
  record: WorkLibraryFull;
  children: React.ReactNode;
  workNames: WorkName[];
  onWorkNameSelect: (value: string) => void;
}

export const WorksEditableCell: React.FC<WorksEditableCellProps> = ({
  editing,
  dataIndex,
  children,
  record,
  workNames,
  onWorkNameSelect,
}) => {
  const currentItemType = Form.useWatch('item_type');

  const getEditBorderColor = () => {
    if (!editing) return undefined;
    const itemType = currentItemType || record.item_type;
    switch (itemType) {
      case 'раб':
        return '#ff9800';
      case 'суб-раб':
        return '#9c27b0';
      case 'раб-комп.':
        return '#f44336';
      default:
        return undefined;
    }
  };

  const borderColor = getEditBorderColor();
  const cellStyle: React.CSSProperties = {
    textAlign: 'center',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    wordBreak: 'break-word',
    ...(borderColor && {
      borderTop: `2px solid ${borderColor}`,
      borderBottom: `2px solid ${borderColor}`,
    }),
  };

  if (!editing) {
    return <td style={cellStyle}>{children}</td>;
  }

  if (dataIndex === 'index' || dataIndex === 'unit' || dataIndex === 'operation') {
    return <td style={cellStyle}>{children}</td>;
  }

  let inputNode: React.ReactNode;

  switch (dataIndex) {
    case 'item_type':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <Select style={{ width: '100%', minWidth: '110px' }}>
            <Select.Option value="раб">раб</Select.Option>
            <Select.Option value="суб-раб">суб-раб</Select.Option>
            <Select.Option value="раб-комп.">раб-комп.</Select.Option>
          </Select>
        </Form.Item>
      );
      break;

    case 'work_name':
      inputNode = (
        <Form.Item
          name="work_name_id"
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <AutoComplete
            options={workNames.map(w => ({ value: w.name }))}
            onSelect={onWorkNameSelect}
            filterOption={(inputValue, option) =>
              option!.value.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
            }
            placeholder="Начните вводить название..."
          />
        </Form.Item>
      );
      break;

    case 'currency_type':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <Select>
            <Select.Option value="RUB">₽ RUB</Select.Option>
            <Select.Option value="USD">$ USD</Select.Option>
            <Select.Option value="EUR">€ EUR</Select.Option>
            <Select.Option value="CNY">¥ CNY</Select.Option>
          </Select>
        </Form.Item>
      );
      break;

    case 'unit_rate':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <InputNumber
            min={0}
            step={0.01}
            precision={2}
            style={{ width: '100%' }}
            decimalSeparator=","
            parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
          />
        </Form.Item>
      );
      break;

    default:
      inputNode = (
        <Form.Item name={dataIndex} style={{ margin: 0 }}>
          <Input style={{ textAlign: 'center' }} />
        </Form.Item>
      );
  }

  return <td style={cellStyle}>{inputNode}</td>;
};
