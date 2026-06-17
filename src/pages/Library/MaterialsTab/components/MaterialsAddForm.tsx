import React from 'react';
import { Form, Row, Col, Select, AutoComplete, Input, InputNumber, Space, Button, Tooltip, theme } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { MaterialName, ItemType, UnitType, DeliveryPriceType } from '../../../../lib/supabase';
import type { FormInstance } from 'antd';

interface MaterialsAddFormProps {
  form: FormInstance;
  materialNames: MaterialName[];
  selectedAddUnit: UnitType | null;
  addItemType: ItemType;
  addDeliveryType: DeliveryPriceType;
  onItemTypeChange: (value: ItemType) => void;
  onDeliveryTypeChange: (value: DeliveryPriceType) => void;
  onMaterialNameSelect: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const MaterialsAddForm: React.FC<MaterialsAddFormProps> = ({
  form,
  materialNames,
  selectedAddUnit,
  addItemType,
  addDeliveryType,
  onItemTypeChange,
  onDeliveryTypeChange,
  onMaterialNameSelect,
  onSubmit,
  onCancel,
}) => {
  const { token } = theme.useToken();
  const addUnitRate = Form.useWatch('unit_rate', form);

  const getAddFormBorderColor = () => {
    switch (addItemType) {
      case 'мат':
        return '#2196f3';
      case 'суб-мат':
        return '#9ccc65';
      case 'мат-комп.':
        return '#00897b';
      default:
        return 'transparent';
    }
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '16px',
        border: `2px solid ${getAddFormBorderColor()}`,
        borderRadius: '6px',
        backgroundColor: token.colorBgContainer,
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          material_type: 'основн.',
          item_type: 'мат',
          consumption_coefficient: 1.0,
          currency_type: 'RUB',
          delivery_price_type: 'в цене',
          delivery_amount: 0,
        }}
      >
        <Row gutter={8}>
          <Col span={3}>
            <Form.Item
              label="Вид материала"
              name="item_type"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select onChange={onItemTypeChange}>
                <Select.Option value="мат">мат</Select.Option>
                <Select.Option value="суб-мат">суб-мат</Select.Option>
                <Select.Option value="мат-комп.">мат-комп.</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item
              label="Тип материала"
              name="material_type"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select>
                <Select.Option value="основн.">основн.</Select.Option>
                <Select.Option value="вспомогат.">вспомогат.</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item
              label="Наименование материала"
              name="material_name_id"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <AutoComplete
                options={materialNames.map(m => ({ key: m.id, value: m.name }))}
                onSelect={onMaterialNameSelect}
                filterOption={(inputValue, option) =>
                  option!.value.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
                }
                placeholder="Начните вводить..."
              />
            </Form.Item>
          </Col>
          <Col span={1}>
            <Form.Item label="Ед.изм">
              <Input value={selectedAddUnit || '-'} disabled style={{ textAlign: 'center' }} />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item
              label="Коэфф. расхода"
              name="consumption_coefficient"
              rules={[
                { required: true, message: 'Обязательное поле' },
                {
                  validator: (_, value) => {
                    if (value && value < 1.0) {
                      return Promise.reject('Мин. 1.00');
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
                style={{ width: '100%' }}
                decimalSeparator=","
                parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
              />
            </Form.Item>
          </Col>
          <Col span={2}>
            <Form.Item
              label="Цена за ед."
              name="unit_rate"
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
          </Col>
          <Col span={2}>
            <Form.Item
              label="Валюта"
              name="currency_type"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select>
                <Select.Option value="RUB">₽</Select.Option>
                <Select.Option value="USD">$</Select.Option>
                <Select.Option value="EUR">€</Select.Option>
                <Select.Option value="CNY">¥</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={2}>
            <Form.Item
              label="Тип доставки"
              name="delivery_price_type"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select onChange={onDeliveryTypeChange}>
                <Select.Option value="в цене">в цене</Select.Option>
                <Select.Option value="не в цене">не в цене</Select.Option>
                <Select.Option value="суммой">суммой</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item
              label="Сумма доставки"
              name="delivery_amount"
              dependencies={['delivery_price_type']}
              rules={[
                ({ getFieldValue }) => ({
                  required: getFieldValue('delivery_price_type') === 'суммой',
                  message: 'Укажите сумму'
                })
              ]}
            >
              {addDeliveryType === 'не в цене' ? (
                <InputNumber
                  min={0}
                  step={0.01}
                  precision={2}
                  style={{ width: '100%' }}
                  disabled
                  value={((addUnitRate || 0) * 0.03)}
                  decimalSeparator=","
                  parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                />
              ) : (
                <InputNumber
                  min={0}
                  step={0.01}
                  precision={2}
                  style={{ width: '100%' }}
                  disabled={addDeliveryType !== 'суммой'}
                  decimalSeparator=","
                  parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                />
              )}
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={8}>
          <Col span={24} style={{ textAlign: 'right' }}>
            <Space size="small">
              <Tooltip title="Добавить">
                <Button type="primary" onClick={onSubmit} icon={<CheckOutlined />} />
              </Tooltip>
              <Tooltip title="Отмена">
                <Button onClick={onCancel} icon={<CloseOutlined />} />
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </Form>
    </div>
  );
};
