import React, { useEffect, useState } from 'react';
import { App, Form, Input, InputNumber, AutoComplete, Select, DatePicker } from 'antd';
import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import type {
  TenderStatus,
  ConstructionScope,
  TenderRegistryInsert,
} from '../../../lib/types';
import {
  fetchTenderRegistryAutocomplete,
  getNextTenderRegistrySortOrder,
  createTenderRegistry,
} from '../../../lib/api/tenderRegistry';
import { ChronologyList, TenderPackageList } from './DynamicList';
import { DATE_INPUT_FORMATS, getDashboardStatusByStatusName } from '../utils/tenderMonitor';
import './TenderAddForm.css';

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
  const { message } = App.useApp();
  const [clientNames, setClientNames] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

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
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const filterByInput = (input: string, option?: { value?: string | number }) =>
    String(option?.value || '').toLowerCase().includes(input.toLowerCase());

  return (
    <section className="tm-add-form" aria-label="Новый тендер">
      <div className="tm-add-form__title">Новый тендер</div>
      <Form form={form} layout="vertical" onFinish={() => void handleSubmit()}>
        <div className="tm-add-form__grid">
          <Form.Item
            name="title"
            label="Наименование"
            rules={[{ required: true, message: 'Обязательное поле' }]}
          >
            <AutoComplete
              options={titles.map((title) => ({ value: title }))}
              placeholder="Наименование ЖК"
              filterOption={filterByInput}
              allowClear
            />
          </Form.Item>
          <Form.Item
            name="client_name"
            label="Заказчик"
            rules={[{ required: true, message: 'Обязательное поле' }]}
          >
            <AutoComplete
              options={clientNames.map((client) => ({ value: client }))}
              placeholder="Заказчик"
              filterOption={filterByInput}
              allowClear
            />
          </Form.Item>
          <Form.Item name="construction_scope_id" label="Объем строительства">
            <Select allowClear placeholder="Выберите">
              {constructionScopes.map((scope) => (
                <Select.Option key={scope.id} value={scope.id}>
                  {scope.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
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
          <Form.Item name="tender_number" label="Номер тендера">
            <AutoComplete
              options={tenderNumbers.map((tenderNumber) => ({ value: tenderNumber }))}
              placeholder="Номер"
              filterOption={filterByInput}
              allowClear
            />
          </Form.Item>
          <Form.Item name="area" label="Площадь по СП">
            <InputNumber decimalSeparator="," min={0} precision={2} placeholder="0,00" />
          </Form.Item>
          <Form.Item name="submission_date" label="Дата подачи КП">
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="DD.MM.YYYY HH:mm"
              placeholder="Выберите дату и время"
            />
          </Form.Item>
          <Form.Item name="commission_date" label="Ввод в эксплуатацию">
            <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" />
          </Form.Item>
          <Form.Item name="construction_start_date" label="Выход на площадку">
            <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" />
          </Form.Item>
          <Form.Item name="invitation_date" label="Поступило приглашение">
            <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" />
          </Form.Item>
          <Form.Item name="site_visit_date" label="Дата посещения">
            <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" />
          </Form.Item>
          <Form.Item name="object_address" label="Адрес объекта">
            <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} allowClear placeholder="Адрес" />
          </Form.Item>
          <Form.Item name="object_coordinates" label="Координаты">
            <Input allowClear placeholder="55.7558, 37.6173" />
          </Form.Item>
          <Form.Item className="tm-add-form__wide" name="site_visit_photo_url" label="Ссылка на посещение площадки">
            <Input allowClear placeholder="https://..." />
          </Form.Item>
        </div>

        <Form.Item label="Хронология">
          <ChronologyList editable form={form} fieldName="chronology_items" />
        </Form.Item>

        <Form.Item label="Тендерный пакет">
          <TenderPackageList editable form={form} fieldName="tender_package_items" />
        </Form.Item>

        <div className="tm-add-form__actions">
          <button type="button" className="tm-btn" onClick={handleCancel} disabled={submitting}>
            Отмена
          </button>
          {/* Не submit: иначе Enter в поле (и выбор подсказки AutoComplete) сразу отправлял бы форму. */}
          <button
            type="button"
            className="tm-btn tm-btn--accent"
            onClick={() => form.submit()}
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? <LoadingOutlined aria-hidden /> : <CheckOutlined aria-hidden />}
            Добавить
          </button>
        </div>
      </Form>
    </section>
  );
};
