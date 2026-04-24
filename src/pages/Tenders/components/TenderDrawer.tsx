import React, { useState, useEffect } from 'react';
import { Drawer, Descriptions, Form, Input, InputNumber, AutoComplete, Select, DatePicker, Button, Space, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { supabase } from '../../../lib/supabase';
import type { TenderRegistryWithRelations, TenderStatus, ConstructionScope } from '../../../lib/supabase';
import { ChronologyList, TenderPackageList } from './DynamicList';

interface TenderDrawerProps {
  open: boolean;
  tender: TenderRegistryWithRelations | null;
  tenderNumbers: string[];
  statuses: TenderStatus[];
  constructionScopes: ConstructionScope[];
  isDirector: boolean;
  initialEditMode?: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export const TenderDrawer: React.FC<TenderDrawerProps> = ({
  open,
  tender,
  tenderNumbers,
  statuses,
  constructionScopes,
  isDirector,
  initialEditMode = false,
  onClose,
  onUpdate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showChronology, setShowChronology] = useState(false);
  const [showTenderPackage, setShowTenderPackage] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (open && tender) {
      // Конвертировать даты в chronology_items в dayjs объекты
      const chronologyWithDayjs = (tender.chronology_items || []).map(item => ({
        ...item,
        date: item.date ? dayjs(item.date) : null,
      }));

      // Конвертировать даты в tender_package_items в dayjs объекты
      const tenderPackageWithDayjs = (tender.tender_package_items || []).map(item => ({
        ...item,
        date: item.date ? dayjs(item.date) : null,
      }));

      form.setFieldsValue({
        ...tender,
        tender_number: tender.tender_number || '',
        object_address: tender.object_address || '',
        chronology_items: chronologyWithDayjs,
        tender_package_items: tenderPackageWithDayjs,
        submission_date: tender.submission_date ? dayjs(tender.submission_date) : null,
        construction_start_date: tender.construction_start_date ? dayjs(tender.construction_start_date) : null,
        site_visit_date: tender.site_visit_date ? dayjs(tender.site_visit_date) : null,
        invitation_date: tender.invitation_date ? dayjs(tender.invitation_date) : null,
      });
      setIsEditing(initialEditMode);
    }
  }, [open, tender, form, initialEditMode]);

  const handleEdit = () => setIsEditing(true);

  const handleCancel = () => {
    setIsEditing(false);
    form.resetFields();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      // Конвертировать dayjs объекты в ISO строки для chronology_items
      const chronologyItems = (values.chronology_items || []).map((item: { date?: { toISOString?: () => string }; text?: string; type?: string }) => ({
        date: item.date?.toISOString?.() || null,
        text: item.text,
        type: item.type || 'default',
      }));

      // Конвертировать dayjs объекты в ISO строки для tender_package_items
      const tenderPackageItems = (values.tender_package_items || []).map((item: { date?: { toISOString?: () => string }; text?: string; link?: string }) => ({
        date: item.date?.toISOString?.() || null,
        text: item.text,
        link: item.link?.trim() || null,
      }));

      const payload = {
        ...values,
        tender_number: values.tender_number || null,
        object_address: values.object_address || null,
        chronology_items: chronologyItems,
        tender_package_items: tenderPackageItems,
        submission_date: values.submission_date?.toISOString() || null,
        construction_start_date: values.construction_start_date?.toISOString() || null,
        site_visit_date: values.site_visit_date?.toISOString() || null,
        invitation_date: values.invitation_date?.toISOString() || null,
      };

      const { error } = await supabase
        .from('tender_registry')
        .update(payload)
        .eq('id', tender!.id);

      if (!error) {
        message.success('Тендер обновлен');
        setIsEditing(false);
        onUpdate();
      } else {
        message.error('Ошибка обновления');
      }
    } catch (error) {
      // Валидация не прошла
    }
  };

  return (
    <Drawer
      title={tender?.title}
      width={600}
      open={open}
      onClose={onClose}
      className="tenders-drawer"
      getContainer={false}
      mask={false}
      maskClosable={false}
      extra={
        !isDirector && (
          !isEditing ? (
            <Button icon={<EditOutlined />} onClick={handleEdit} type="primary">
              Редактировать
            </Button>
          ) : (
            <Space>
              <Button onClick={handleCancel}>Отмена</Button>
              <Button type="primary" onClick={handleSave}>
                Сохранить
              </Button>
            </Space>
          )
        )
      }
    >
      <Form form={form} layout="vertical">
        {!isEditing ? (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="Номер тендера">
              {tender?.tender_number || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Наименование">{tender?.title}</Descriptions.Item>
            <Descriptions.Item label="Заказчик">{tender?.client_name}</Descriptions.Item>
            <Descriptions.Item label="Адрес объекта">
              {tender?.object_address || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Площадь">
              {tender?.area ? `${tender.area.toFixed(2)} м²` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Объем строительства">
              {(tender?.construction_scope as { name?: string } | null | undefined)?.name || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Статус">
              {(tender?.status as { name?: string } | null | undefined)?.name || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Дата подачи КП">
              {tender?.submission_date
                ? dayjs(tender.submission_date).format('DD.MM.YYYY')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Дата выхода на площадку">
              {tender?.construction_start_date
                ? dayjs(tender.construction_start_date).format('DD.MM.YYYY')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Дата посещения площадки">
              {tender?.site_visit_date
                ? dayjs(tender.site_visit_date).format('DD.MM.YYYY')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Фото посещения">
              {tender?.site_visit_photo_url ? (
                <a href={tender.site_visit_photo_url} target="_blank" rel="noopener noreferrer">
                  Открыть ссылку
                </a>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Дата приглашения">
              {tender?.invitation_date
                ? dayjs(tender.invitation_date).format('DD.MM.YYYY')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item
              label={
                <Space>
                  Хронология
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setShowChronology(!showChronology)}
                  >
                    {showChronology ? '−' : '+'}
                  </Button>
                </Space>
              }
            >
              {showChronology && <ChronologyList items={tender?.chronology_items || []} editable={false} />}
            </Descriptions.Item>
            <Descriptions.Item
              label={
                <Space>
                  Тендерный пакет
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setShowTenderPackage(!showTenderPackage)}
                  >
                    {showTenderPackage ? '−' : '+'}
                  </Button>
                </Space>
              }
            >
              {showTenderPackage && <TenderPackageList items={tender?.tender_package_items || []} editable={false} />}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <>
            <Form.Item name="tender_number" label="Номер тендера">
              <AutoComplete
                options={tenderNumbers.map((tn) => ({ value: tn }))}
                placeholder="Выберите или введите"
                allowClear
              />
            </Form.Item>

            <Form.Item name="title" label="Наименование" rules={[{ required: true }]}>
              <Input />
            </Form.Item>

            <Form.Item name="client_name" label="Заказчик" rules={[{ required: true }]}>
              <Input />
            </Form.Item>

            <Form.Item name="object_address" label="Адрес объекта">
              <Input />
            </Form.Item>

            <Form.Item name="area" label="Площадь (м²)">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>

            <Form.Item name="construction_scope_id" label="Объем строительства">
              <Select allowClear>
                {constructionScopes.map((cs) => (
                  <Select.Option key={cs.id} value={cs.id}>
                    {cs.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item name="status_id" label="Статус">
              <Select allowClear>
                {statuses.map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item name="submission_date" label="Дата подачи КП">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>

            <Form.Item name="construction_start_date" label="Дата выхода на площадку">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>

            <Form.Item name="site_visit_date" label="Дата посещения площадки">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>

            <Form.Item name="site_visit_photo_url" label="Ссылка на фото">
              <Input placeholder="https://..." />
            </Form.Item>

            <Form.Item name="invitation_date" label="Дата приглашения">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>

            <Form.Item label="Хронология">
              <ChronologyList editable={true} form={form} fieldName="chronology_items" />
            </Form.Item>

            <Form.Item label="Тендерный пакет">
              <TenderPackageList editable={true} form={form} fieldName="tender_package_items" />
            </Form.Item>
          </>
        )}
      </Form>
    </Drawer>
  );
};
