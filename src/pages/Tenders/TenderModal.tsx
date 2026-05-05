import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, message, AutoComplete } from 'antd';
import { supabase, type TenderRegistry, type TenderStatus, type ConstructionScope } from '../../lib/supabase';
import dayjs from 'dayjs';

interface TenderModalProps {
  open: boolean;
  tender: TenderRegistry | null;
  statuses: TenderStatus[];
  constructionScopes: ConstructionScope[];
  onCancel: () => void;
  onSuccess: () => void;
}

const TenderModal: React.FC<TenderModalProps> = ({
  open,
  tender,
  statuses,
  constructionScopes,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tenderTitles, setTenderTitles] = useState<string[]>([]);
  const [clientNames, setClientNames] = useState<string[]>([]);
  const [areas, setAreas] = useState<number[]>([]);

  useEffect(() => {
    if (open) {
      fetchAutocompleteData();
      if (tender) {
        form.setFieldsValue({
          title: tender.title,
          client_name: tender.client_name,
          area: tender.area,
          construction_scope_id: tender.construction_scope_id,
          status_id: tender.status_id,
          submission_date: tender.submission_date ? dayjs(tender.submission_date) : null,
          construction_start_date: tender.construction_start_date ? dayjs(tender.construction_start_date) : null,
          site_visit_date: tender.site_visit_date ? dayjs(tender.site_visit_date) : null,
          site_visit_photo_url: tender.site_visit_photo_url,
          has_tender_package: tender.has_tender_package,
          invitation_date: tender.invitation_date ? dayjs(tender.invitation_date) : null,
          chronology: tender.chronology,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, tender, form]);

  const fetchAutocompleteData = async () => {
    const { data, error } = await supabase
      .from('tenders')
      .select('title, client_name, area_sp')
      .order('created_at', { ascending: false });

    if (!error && data) {
      const uniqueTitles = Array.from(new Set(data.map(t => t.title).filter(Boolean)));
      const uniqueClients = Array.from(new Set(data.map(t => t.client_name).filter(Boolean)));
      const uniqueAreas = Array.from(new Set(data.map(t => t.area_sp).filter(Boolean)));

      setTenderTitles(uniqueTitles);
      setClientNames(uniqueClients);
      setAreas(uniqueAreas);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload = {
        title: values.title,
        client_name: values.client_name,
        area: values.area,
        construction_scope_id: values.construction_scope_id || null,
        status_id: values.status_id || null,
        submission_date: values.submission_date ? values.submission_date.toISOString() : null,
        construction_start_date: values.construction_start_date ? values.construction_start_date.toISOString() : null,
        site_visit_date: values.site_visit_date ? values.site_visit_date.toISOString() : null,
        site_visit_photo_url: values.site_visit_photo_url || null,
        has_tender_package: values.has_tender_package || null,
        invitation_date: values.invitation_date ? values.invitation_date.toISOString() : null,
        chronology: values.chronology || null,
      };

      let error;
      if (tender) {
        // Обновление
        ({ error } = await supabase
          .from('tender_registry')
          .update(payload)
          .eq('id', tender.id));
      } else {
        // Создание - получить максимальный sort_order
        const { data: maxData } = await supabase
          .from('tender_registry')
          .select('sort_order')
          .order('sort_order', { ascending: false })
          .limit(1);

        const nextSortOrder = maxData && maxData.length > 0 ? maxData[0].sort_order + 1 : 1;

        ({ error } = await supabase
          .from('tender_registry')
          .insert({ ...payload, sort_order: nextSortOrder }));
      }

      setLoading(false);

      if (error) {
        message.error('Ошибка сохранения: ' + error.message);
      } else {
        message.success(tender ? 'Тендер обновлен' : 'Тендер добавлен');
        form.resetFields();
        onSuccess();
      }
    } catch (error) {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={tender ? 'Редактировать тендер' : 'Добавить тендер'}
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText={tender ? 'Сохранить' : 'Добавить'}
      cancelText="Отмена"
      width={700}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="title"
          label="Наименование"
          rules={[{ required: true, message: 'Введите наименование' }]}
        >
          <AutoComplete
            options={tenderTitles.map(t => ({ value: t }))}
            placeholder="Выберите или введите наименование"
            filterOption={(input, option) =>
              option?.value.toLowerCase().includes(input.toLowerCase()) ?? false
            }
          />
        </Form.Item>

        <Form.Item
          name="client_name"
          label="Заказчик"
          rules={[{ required: true, message: 'Введите заказчика' }]}
        >
          <AutoComplete
            options={clientNames.map(c => ({ value: c }))}
            placeholder="Выберите или введите заказчика"
            filterOption={(input, option) =>
              option?.value.toLowerCase().includes(input.toLowerCase()) ?? false
            }
          />
        </Form.Item>

        <Form.Item name="area" label="Площадь (м²)">
          <AutoComplete
            options={areas.map(a => ({ value: a.toString() }))}
            placeholder="Выберите или введите площадь"
            filterOption={(input, option) =>
              option?.value.includes(input) ?? false
            }
          />
        </Form.Item>

        <Form.Item name="construction_scope_id" label="Объем строительства">
          <Select
            placeholder="Выберите объем строительства"
            allowClear
            options={constructionScopes.map(cs => ({ label: cs.name, value: cs.id }))}
          />
        </Form.Item>

        <Form.Item name="status_id" label="Статус">
          <Select
            placeholder="Выберите статус"
            allowClear
            options={statuses.map(s => ({ label: s.name, value: s.id }))}
          />
        </Form.Item>

        <Form.Item name="submission_date" label="Дата подачи КП">
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>

        <Form.Item name="construction_start_date" label="Дата выхода на строительную площадку">
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>

        <Form.Item name="site_visit_date" label="Дата посещения площадки">
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>

        <Form.Item name="site_visit_photo_url" label="Ссылка на фото посещения площадки">
          <Input placeholder="https://..." />
        </Form.Item>

        <Form.Item name="has_tender_package" label="Наличие тендерного пакета">
          <Input placeholder="Введите информацию о тендерном пакете" />
        </Form.Item>

        <Form.Item name="invitation_date" label="Дата приглашения">
          <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
        </Form.Item>

        <Form.Item name="chronology" label="Хронология">
          <Input.TextArea rows={3} placeholder="Введите хронологию событий" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default TenderModal;
