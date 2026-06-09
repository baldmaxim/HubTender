import React from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Select,
  Row,
  Col,
  Divider,
  Space,
  Spin,
  theme
} from 'antd';
import {
  FileTextOutlined,
  LinkOutlined,
  DollarOutlined,
  EuroOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { useTheme } from '../../../contexts/ThemeContext';
import { parseNumberInput, formatNumberInput } from '../../../utils/numberFormat';

const { TextArea } = Input;

interface TenderModalProps {
  visible: boolean;
  form: FormInstance;
  onOk: () => void;
  onCancel: () => void;
  isEditMode?: boolean;
  ratesLoading?: boolean;
}

const TenderModal: React.FC<TenderModalProps> = ({
  visible,
  form,
  onOk,
  onCancel,
  isEditMode = false,
  ratesLoading = false
}) => {
  const { theme: currentTheme } = useTheme();
  const { token } = theme.useToken();

  return (
    <Modal
      title={isEditMode ? "Редактирование тендера" : "Создание нового тендера"}
      open={visible}
      onOk={onOk}
      onCancel={onCancel}
      width={900}
      okText={isEditMode ? "Сохранить" : "Создать"}
      cancelText="Отмена"
      okButtonProps={{
        style: {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          borderColor: '#059669',
        }
      }}
      styles={{
        body: {
          background: currentTheme === 'dark' ? token.colorBgContainer : undefined,
        },
        content: {
          background: currentTheme === 'dark' ? token.colorBgContainer : undefined,
        },
        header: {
          background: currentTheme === 'dark' ? token.colorBgContainer : undefined,
          borderBottom: currentTheme === 'dark' ? `1px solid ${token.colorBorder}` : undefined,
        },
        footer: {
          background: currentTheme === 'dark' ? token.colorBgContainer : undefined,
          borderTop: currentTheme === 'dark' ? `1px solid ${token.colorBorder}` : undefined,
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={!isEditMode ? {
          version: 1
        } : undefined}
      >
        <Divider orientation="left">Основная информация</Divider>

        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              name="title"
              label="Наименование тендера"
              rules={[{ required: true, message: 'Пожалуйста, введите наименование тендера' }]}
            >
              <Input
                placeholder="Введите наименование тендера"
                size="large"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="tender_number"
              label="Номер тендера"
              rules={[{ required: true, message: 'Пожалуйста, введите номер тендера' }]}
            >
              <Input
                placeholder="Например: T-2025-001"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="housing_class"
              label="Класс жилья"
            >
              <Select
                placeholder="Выберите класс жилья"
                allowClear
              >
                <Select.Option value="комфорт">Комфорт</Select.Option>
                <Select.Option value="бизнес">Бизнес</Select.Option>
                <Select.Option value="премиум">Премиум</Select.Option>
                <Select.Option value="делюкс">Делюкс</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="construction_scope"
              label="Объем строительства"
            >
              <Select
                placeholder="Выберите объем строительства"
                allowClear
              >
                <Select.Option value="генподряд">Генподряд</Select.Option>
                <Select.Option value="коробка">Коробка</Select.Option>
                <Select.Option value="монолит">Монолит</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={24}>
            <Form.Item
              name="description"
              label="Описание (комментарий)"
            >
              <TextArea
                rows={3}
                placeholder="Введите описание или комментарий к тендеру"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="client_name"
              label="Наименование заказчика"
              rules={[{ required: true, message: 'Пожалуйста, введите наименование заказчика' }]}
            >
              <Input
                placeholder="Введите наименование заказчика"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="submission_deadline"
              label="Дата окончания расчета"
              rules={[{ required: true, message: 'Пожалуйста, выберите дату' }]}
            >
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                style={{ width: '100%' }}
                format="DD.MM.YYYY HH:mm"
                placeholder="Выберите дату и время"
              />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item
              name="version"
              label="Версия"
              rules={[{ required: true, message: 'Введите версию' }]}
            >
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                placeholder="1"
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Площади</Divider>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="area_client"
              label="Площадь заказчика (м²)"
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                placeholder="0.00"
                precision={2}
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="area_sp"
              label="Площадь по СП (м²)"
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                placeholder="0.00"
                precision={2}
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Курсы валют</Divider>

        {ratesLoading && (
          <div style={{ marginBottom: 12 }}>
            <Spin size="small" />
            <span style={{ marginLeft: 8 }}>Загрузка курсов ЦБ РФ на сегодня…</span>
          </div>
        )}

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name="usd_rate"
              label={
                <Space>
                  <DollarOutlined />
                  Курс доллара (USD)
                </Space>
              }
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                placeholder="100.00"
                precision={2}
                step={0.1}
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="eur_rate"
              label={
                <Space>
                  <EuroOutlined />
                  Курс евро (EUR)
                </Space>
              }
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                placeholder="108.00"
                precision={2}
                step={0.1}
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="cny_rate"
              label={
                <Space>
                  <GlobalOutlined />
                  Курс юаня (CNY)
                </Space>
              }
            >
              <InputNumber
                min={0}
                style={{ width: '100%' }}
                placeholder="13.50"
                precision={2}
                step={0.01}
                parser={parseNumberInput}
                formatter={formatNumberInput}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Ссылки на документы</Divider>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="upload_folder"
              label="Ссылка на папку для загрузки КП"
            >
              <Input
                prefix={<LinkOutlined />}
                placeholder="https://..."
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="bsm_link"
              label="Ссылка на БСМ"
            >
              <Input
                prefix={<FileTextOutlined />}
                placeholder="https://..."
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="tz_link"
              label="Ссылка на уточнения по ТЗ"
            >
              <Input
                prefix={<FileTextOutlined />}
                placeholder="https://..."
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="qa_form_link"
              label="Ссылка на форму Вопрос-Ответ"
            >
              <Input
                prefix={<FileTextOutlined />}
                placeholder="https://..."
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="project_folder_link"
              label="Ссылка на папку с проектом"
            >
              <Input
                prefix={<LinkOutlined />}
                placeholder="https://..."
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default TenderModal;