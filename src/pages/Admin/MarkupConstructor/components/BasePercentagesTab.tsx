import React from 'react';
import { Card, Typography, Space, Form, InputNumber, Button, Spin, Row, Col } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { MarkupParameter } from '../../../../lib/supabase';
import { parseNumberInput, formatNumberInput } from '../../../../utils/numberFormat';

const { Title, Text } = Typography;

/** Вкладка «Базовые проценты»: значения default_value параметров наценок. */
export const BasePercentagesTab: React.FC<{
  basePercentagesForm: FormInstance;
  markupParameters: MarkupParameter[];
  loadingParameters: boolean;
  savingBasePercentages: boolean;
  onSave: () => void;
  onReset: () => void;
}> = ({ basePercentagesForm, markupParameters, loadingParameters, savingBasePercentages, onSave, onReset }) => (
  <Card
    title={
      <Space direction="vertical" size={0}>
        <Title level={4} style={{ margin: 0 }}>
          Базовые проценты наценок
        </Title>
        <Text type="secondary" style={{ fontSize: '14px' }}>
          Задайте базовые значения процентов по умолчанию
        </Text>
      </Space>
    }
    extra={
      <Space>
        <Button
          icon={<ReloadOutlined />}
          onClick={onReset}
        >
          Сбросить
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSave}
          loading={savingBasePercentages}
        >
          Сохранить
        </Button>
      </Space>
    }
  >
    <Spin spinning={loadingParameters}>
      {loadingParameters ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Text>Загрузка параметров наценок...</Text>
        </div>
      ) : markupParameters.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Text type="danger">Параметры наценок не найдены. Проверьте базу данных.</Text>
        </div>
      ) : (
        <Form
          form={basePercentagesForm}
          layout="horizontal"
          labelCol={{ style: { width: '250px', textAlign: 'left' } }}
          wrapperCol={{ style: { flex: 1 } }}
        >
          <Row gutter={[16, 0]}>
            {markupParameters.map((param, index) => (
              <Col span={24} key={param.id}>
                <Form.Item
                  label={`${index + 1}. ${param.label}`}
                  name={param.key}
                  style={{ marginBottom: '4px' }}
                >
                  <InputNumber
                    min={0}
                    max={999.99999}
                    step={0.00001}
                    addonAfter="%"
                    style={{ width: '140px' }}
                    precision={5}
                    parser={parseNumberInput}
                    formatter={formatNumberInput}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      )}
    </Spin>
  </Card>
);
