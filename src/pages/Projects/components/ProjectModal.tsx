import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, DatePicker, Select, message } from 'antd';
import dayjs from 'dayjs';
import { listActiveTendersForProjectSelect } from '../../../lib/api/projects';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull, ProjectInsert, Tender } from '../../../lib/supabase/types';

interface ProjectModalProps {
  open: boolean;
  editingProject: ProjectFull | null;
  onClose: () => void;
  onSave: (values: ProjectInsert) => Promise<boolean>;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  open,
  editingProject,
  onClose,
  onSave,
}) => {
  const { theme } = useTheme();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tendersLoading, setTendersLoading] = useState(false);

  // Load tenders for selection
  useEffect(() => {
    const loadTenders = async () => {
      setTendersLoading(true);
      try {
        const data = await listActiveTendersForProjectSelect();
        setTenders((data as unknown as Tender[]) || []);
      } catch (error) {
        console.error('Error loading tenders:', error);
      } finally {
        setTendersLoading(false);
      }
    };

    if (open) {
      loadTenders();
    }
  }, [open]);

  // Set form values when editing
  useEffect(() => {
    if (open && editingProject) {
      form.setFieldsValue({
        name: editingProject.name,
        client_name: editingProject.client_name,
        contract_cost: editingProject.contract_cost,
        area: editingProject.area,
        contract_date: editingProject.contract_date
          ? dayjs(editingProject.contract_date)
          : null,
        construction_end_date: editingProject.construction_end_date
          ? dayjs(editingProject.construction_end_date)
          : null,
        tender_id: editingProject.tender_id,
      });
    } else if (open) {
      form.resetFields();
    }
  }, [open, editingProject, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const projectData: ProjectInsert = {
        name: values.name,
        client_name: values.client_name,
        contract_cost: values.contract_cost,
        area: values.area || null,
        contract_date: values.contract_date
          ? values.contract_date.format('YYYY-MM-DD')
          : null,
        construction_end_date: values.construction_end_date
          ? values.construction_end_date.format('YYYY-MM-DD')
          : null,
        tender_id: values.tender_id || null,
      };

      const success = await onSave(projectData);
      if (success) {
        form.resetFields();
      }
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  // Auto-fill from tender when selected
  const handleTenderSelect = (tenderId: string) => {
    const tender = tenders.find((t) => t.id === tenderId);
    if (tender) {
      const currentName = form.getFieldValue('name');
      const currentClient = form.getFieldValue('client_name');

      if (!currentName) {
        form.setFieldValue('name', tender.title);
      }
      if (!currentClient) {
        form.setFieldValue('client_name', tender.client_name);
      }

      message.info('Данные из тендера подставлены в форму');
    }
  };

  return (
    <Modal
      title={editingProject ? 'Редактирование объекта' : 'Добавление объекта'}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={loading}
      width={600}
      className={theme === 'dark' ? 'dark-modal' : ''}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="tender_id"
          label="Связь с тендером (опционально)"
        >
          <Select
            placeholder="Выберите тендер"
            allowClear
            showSearch
            loading={tendersLoading}
            optionFilterProp="label"
            onChange={handleTenderSelect}
            options={tenders.map((t) => ({
              value: t.id,
              label: `${t.tender_number} - ${t.title}`,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="name"
          label="Наименование объекта"
          rules={[{ required: true, message: 'Введите наименование' }]}
        >
          <Input placeholder="Название объекта" />
        </Form.Item>

        <Form.Item
          name="client_name"
          label="Заказчик"
          rules={[{ required: true, message: 'Введите заказчика' }]}
        >
          <Input placeholder="Название заказчика" />
        </Form.Item>

        <Form.Item
          name="contract_cost"
          label="Стоимость договора (₽)"
          rules={[{ required: true, message: 'Введите стоимость' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="0"
            min={0 as number}
            formatter={(value) =>
              `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',')
            }
            parser={(value) => Number(value!.replace(/\s/g, '').replace(',', '.'))}
          />
        </Form.Item>

        <Form.Item name="area" label="Площадь (м²)">
          <InputNumber
            style={{ width: '100%' }}
            placeholder="0"
            min={0 as number}
            formatter={(value) =>
              `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',')
            }
            parser={(value) => Number(value!.replace(/\s/g, '').replace(',', '.'))}
          />
        </Form.Item>

        <Form.Item name="contract_date" label="Дата заключения договора">
          <DatePicker
            style={{ width: '100%' }}
            format="DD.MM.YYYY"
            placeholder="Выберите дату"
          />
        </Form.Item>

        <Form.Item name="construction_end_date" label="Окончание строительства">
          <DatePicker
            style={{ width: '100%' }}
            format="DD.MM.YYYY"
            placeholder="Выберите дату"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
