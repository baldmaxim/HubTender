import React from 'react';
import { Form, Input, Select, InputNumber, AutoComplete } from 'antd';
import { MaterialLibraryFull, MaterialName } from '../../../../lib/supabase';

interface MaterialsEditableCellProps {
  editing: boolean;
  dataIndex: string;
  title: string;
  record: MaterialLibraryFull;
  children: React.ReactNode;
  materialNames: MaterialName[];
  onMaterialNameSelect: (value: string) => void;
}

export const MaterialsEditableCell: React.FC<MaterialsEditableCellProps> = ({
  editing,
  dataIndex,
  children,
  record,
  materialNames,
  onMaterialNameSelect,
}) => {
  const deliveryPriceType = Form.useWatch('delivery_price_type');
  const currentItemType = Form.useWatch('item_type');
  const unitRate = Form.useWatch('unit_rate');

  const getEditBorderColor = () => {
    if (!editing) return undefined;
    const itemType = currentItemType || record.item_type;
    switch (itemType) {
      case 'мат':
        return '#2196f3';
      case 'суб-мат':
        return '#9ccc65';
      case 'мат-комп.':
        return '#00897b';
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
            <Select.Option value="мат">мат</Select.Option>
            <Select.Option value="суб-мат">суб-мат</Select.Option>
            <Select.Option value="мат-комп.">мат-комп.</Select.Option>
          </Select>
        </Form.Item>
      );
      break;

    case 'material_type':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <Select>
            <Select.Option value="основн.">основн.</Select.Option>
            <Select.Option value="вспомогат.">вспомогат.</Select.Option>
          </Select>
        </Form.Item>
      );
      break;

    case 'material_name':
      inputNode = (
        <Form.Item
          name="material_name_id"
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <AutoComplete
            options={materialNames.map(m => ({ value: m.name }))}
            onSelect={onMaterialNameSelect}
            filterOption={(inputValue, option) =>
              option!.value.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
            }
            placeholder="Начните вводить название..."
          />
        </Form.Item>
      );
      break;

    case 'consumption_coefficient':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[
            { required: true, message: 'Обязательное поле' },
            {
              validator: (_, value) => {
                if (value && value < 1.0) {
                  return Promise.reject('Коэффициент должен быть не менее 1.00');
                }
                return Promise.resolve();
              }
            }
          ]}
        >
          <InputNumber
            min={1.0}
            step={0.01}
            precision={4}
            decimalSeparator=","
            style={{ width: '100%' }}
            parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
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
            decimalSeparator=","
            style={{ width: '100%' }}
            parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
          />
        </Form.Item>
      );
      break;

    case 'delivery_price_type':
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[{ required: true, message: 'Обязательное поле' }]}
        >
          <Select>
            <Select.Option value="в цене">в цене</Select.Option>
            <Select.Option value="не в цене">не в цене</Select.Option>
            <Select.Option value="суммой">суммой</Select.Option>
          </Select>
        </Form.Item>
      );
      break;

    case 'delivery_amount':
      if (deliveryPriceType === 'не в цене') {
        const rate = unitRate || record.unit_rate || 0;
        const calculatedAmount = (rate * 0.03).toFixed(2);
        return <td style={cellStyle}>{calculatedAmount}</td>;
      }
      if (deliveryPriceType !== 'суммой') {
        return <td style={cellStyle}>-</td>;
      }
      inputNode = (
        <Form.Item
          name={dataIndex}
          style={{ margin: 0 }}
          rules={[
            {
              required: deliveryPriceType === 'суммой',
              message: 'Укажите сумму'
            }
          ]}
        >
          <InputNumber
            min={0}
            step={0.01}
            precision={2}
            decimalSeparator=","
            style={{ width: '100%' }}
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
