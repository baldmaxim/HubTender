import React from 'react';
import { Form, Row, Col, Select, AutoComplete, Input, InputNumber, Space, Button, Tooltip, theme } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { WorkName, WorkItemType, UnitType } from '../../../../lib/types';
import type { FormInstance } from 'antd';

interface WorksAddFormProps {
  form: FormInstance;
  workNames: WorkName[];
  selectedAddUnit: UnitType | null;
  addItemType: WorkItemType;
  onItemTypeChange: (value: WorkItemType) => void;
  onWorkNameSelect: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const WorksAddForm: React.FC<WorksAddFormProps> = ({
  form,
  workNames,
  selectedAddUnit,
  addItemType,
  onItemTypeChange,
  onWorkNameSelect,
  onSubmit,
  onCancel,
}) => {
  const { token } = theme.useToken();

  const getAddFormBorderColor = () => {
    switch (addItemType) {
      case 'раб':
        return '#ff9800';
      case 'суб-раб':
        return '#9c27b0';
      case 'раб-комп.':
        return '#f44336';
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
          item_type: 'раб',
          currency_type: 'RUB',
          unit_rate: 0,
        }}
      >
        <Row gutter={8}>
          <Col span={3}>
            <Form.Item
              label="Вид работы"
              name="item_type"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select onChange={onItemTypeChange}>
                <Select.Option value="раб">раб</Select.Option>
                <Select.Option value="суб-раб">суб-раб</Select.Option>
                <Select.Option value="раб-комп.">раб-комп.</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={13}>
            <Form.Item
              label="Наименование работы"
              name="work_name_id"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <AutoComplete
                options={workNames.map(w => ({ key: w.id, value: w.name }))}
                onSelect={onWorkNameSelect}
                filterOption={(inputValue, option) =>
                  option!.value.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
                }
                placeholder="Начните вводить..."
              />
            </Form.Item>
          </Col>
          <Col span={2}>
            <Form.Item label="Ед.изм">
              <Input value={selectedAddUnit || '-'} disabled style={{ textAlign: 'center' }} />
            </Form.Item>
          </Col>
          <Col span={3}>
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
          <Col span={3}>
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
