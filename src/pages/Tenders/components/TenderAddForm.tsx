import React, { useEffect, useState } from 'react';
import { Form, Input, InputNumber, AutoComplete, Select, DatePicker, Row, Col, Button, message, theme } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type {
  TenderStatus,
  ConstructionScope,
  TenderRegistryInsert,
} from '../../../lib/supabase';
import {
  fetchTenderRegistryAutocomplete,
  getNextTenderRegistrySortOrder,
  createTenderRegistry,
} from '../../../lib/api/tenderRegistry';
import { ChronologyList, TenderPackageList } from './DynamicList';
import { getDashboardStatusByStatusName } from '../utils/tenderMonitor';

const { useToken } = theme;

interface TenderAddFormProps {
  statuses: TenderStatus[];
  constructionScopes: ConstructionScope[];
  tenderNumbers: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

export const TenderAddForm: React.FC<TenderAddFormProps> = ({
  statuses,
  constructionScopes,
  tenderNumbers,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const { token } = useToken();
  const [clientNames, setClientNames] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { titles: t, clientNames: c } = await fetchTenderRegistryAutocomplete();
        setTitles(t);
        setClientNames(c);
      } catch {
        // ignore — fallback to empty autocomplete options
      }
    })();
  }, []);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      const nextSortOrder = await getNextTenderRegistrySortOrder();

      const chronologyItems = (values.chronology_items || []).map((item: { date?: { toISOString?: () => string }; text?: string; type?: string }) => ({
        date: item.date?.toISOString?.() || null,
        text: item.text,
        type: item.type || 'default',
      }));

      const tenderPackageItems = (values.tender_package_items || []).map((item: { date?: { toISOString?: () => string }; text?: string; link?: string }) => ({
        date: item.date?.toISOString?.() || null,
        text: item.text,
        link: item.link?.trim() || null,
      }));

      const selectedStatus = statuses.find((status) => status.id === values.status_id);
      const derivedDashboardStatus =
        values.status_id === '__sent__'
          ? 'sent'
          : getDashboardStatusByStatusName(selectedStatus?.name) || 'calc';

      const payload: TenderRegistryInsert = {
        ...values,
        tender_number: values.tender_number || null,
        object_address: values.object_address || null,
        object_coordinates: values.object_coordinates || null,
        chronology_items: chronologyItems,
        tender_package_items: tenderPackageItems,
        sort_order: nextSortOrder,
        is_archived: derivedDashboardStatus === 'archive',
        dashboard_status: derivedDashboardStatus,
        status_id: values.status_id === '__sent__' ? null : values.status_id || null,
        submission_date: values.submission_date?.toISOString() || null,
        commission_date: values.commission_date?.toISOString() || null,
        construction_start_date: values.construction_start_date?.toISOString() || null,
        site_visit_date: values.site_visit_date?.toISOString() || null,
        invitation_date: values.invitation_date?.toISOString() || null,
      };

      try {
        await createTenderRegistry(payload);
      } catch {
        message.error('Ошибка добавления тендера');
        return;
      }

      message.success('Тендер добавлен');
      form.resetFields();
      onSuccess();
    } catch {
      // validation handled by antd
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '16px',
        border: '2px solid #10b981',
        borderRadius: '6px',
        backgroundColor: token.colorBgContainer,
      }}
    >
      <Form form={form} layout="vertical">
        <Row gutter={8}>
          <Col span={12}>
            <Form.Item name="object_coordinates" label="Координаты объекта">
              <Input placeholder="55.7558, 37.6173" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="commission_date" label="Ввод в эксплуатацию">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={3}>
            <Form.Item name="tender_number" label="Номер тендера">
              <AutoComplete
                options={tenderNumbers.map((tenderNumber) => ({ value: tenderNumber }))}
                placeholder="Номер"
                filterOption={(input, option) =>
                  String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                }
                allowClear
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              name="title"
              label="Наименование"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <AutoComplete
                options={titles.map((title) => ({ value: title }))}
                placeholder="Наименование ЖК"
                filterOption={(input, option) =>
                  String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item
              name="client_name"
              label="Заказчик"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <AutoComplete
                options={clientNames.map((client) => ({ value: client }))}
                placeholder="Заказчик"
                filterOption={(input, option) =>
                  String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="object_address" label="Адрес объекта">
              <Input placeholder="Адрес" />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="construction_scope_id" label="Объем строительства">
              <Select allowClear placeholder="Выберите">
                {constructionScopes.map((scope) => (
                  <Select.Option key={scope.id} value={scope.id}>
                    {scope.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={3}>
            <Form.Item name="area" label="Площадь, м2">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="status_id" label="Статус">
              <Select allowClear placeholder="Выберите">
                <Select.Option value="__sent__">Направлено</Select.Option>
                {statuses.map((status) => (
                  <Select.Option key={status.id} value={status.id}>
                    {status.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="submission_date" label="Дата подачи КП">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="construction_start_date" label="Дата выхода">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="site_visit_date" label="Дата посещения">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="invitation_date" label="Дата приглашения">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Дата" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={24}>
            <Form.Item name="site_visit_photo_url" label="Ссылка на фото посещения">
              <Input placeholder="https://..." />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={24}>
            <Form.Item label="Хронология">
              <ChronologyList editable form={form} fieldName="chronology_items" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={24}>
            <Form.Item label="Тендерный пакет">
              <TenderPackageList editable form={form} fieldName="tender_package_items" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={8}>
          <Col span={24} style={{ textAlign: 'right' }}>
            <Button type="primary" icon={<CheckOutlined />} onClick={handleSubmit} style={{ marginRight: 8 }}>
              Добавить
            </Button>
            <Button icon={<CloseOutlined />} onClick={handleCancel}>
              Отмена
            </Button>
          </Col>
        </Row>
      </Form>
    </div>
  );
};
