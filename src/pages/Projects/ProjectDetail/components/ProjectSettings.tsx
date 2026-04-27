import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  InputNumber,
  DatePicker,
  Select,
  Button,
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  message,
  Divider,
  Typography,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  listActiveTendersForProjectSelect,
  updateProject,
} from '../../../../lib/api/projects';
import type { ProjectFull, Tender, ProjectInsert } from '../../../../lib/supabase/types';

const { Text } = Typography;

interface ProjectSettingsProps {
  project: ProjectFull;
  onSave: () => Promise<void>;
}

const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    if (billions % 1 === 0) {
      return `${billions.toFixed(0)} млрд`;
    }
    return `${billions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млрд`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    if (millions % 1 === 0) {
      return `${millions.toFixed(0)} млн`;
    }
    return `${millions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млн`;
  }
  return value.toLocaleString('ru-RU');
};

export const ProjectSettings: React.FC<ProjectSettingsProps> = ({ project, onSave }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tendersLoading, setTendersLoading] = useState(false);

  useEffect(() => {
    const loadTenders = async () => {
      setTendersLoading(true);
      try {
        const data = await listActiveTendersForProjectSelect();
        setTenders(data as Tender[]);
      } catch (error) {
        console.error('Error loading tenders:', error);
      } finally {
        setTendersLoading(false);
      }
    };

    loadTenders();
  }, []);

  useEffect(() => {
    form.setFieldsValue({
      name: project.name,
      client_name: project.client_name,
      contract_cost: project.contract_cost,
      area: project.area,
      contract_date: project.contract_date ? dayjs(project.contract_date) : null,
      construction_end_date: project.construction_end_date
        ? dayjs(project.construction_end_date)
        : null,
      tender_id: project.tender_id,
    });
  }, [project, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const projectData: Partial<ProjectInsert> = {
        name: values.name,
        client_name: values.client_name,
        contract_cost: values.contract_cost,
        area: values.area || null,
        contract_date: values.contract_date?.format('YYYY-MM-DD') || null,
        construction_end_date: values.construction_end_date?.format('YYYY-MM-DD') || null,
        tender_id: values.tender_id || null,
      };

      await updateProject(project.id, projectData);

      message.success('Объект сохранён');
      await onSave();
    } catch (error) {
      console.error('Error saving project:', error);
      message.error('Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

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

  const completionPercent = Math.min(Math.round(project.completion_percentage), 100);

  return (
    <div>
      {/* Summary cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Стоимость договора"
              value={project.contract_cost}
              formatter={() => formatMoney(project.contract_cost)}
              valueStyle={{ color: '#1890ff', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Итого с доп. соглашениями"
              value={project.final_contract_cost}
              formatter={() => formatMoney(project.final_contract_cost)}
              valueStyle={{ color: '#722ed1', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Закрыто выполнения"
              value={project.total_completion}
              formatter={() => formatMoney(project.total_completion)}
              valueStyle={{ color: '#52c41a', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Text type="secondary" style={{ fontSize: 12 }}>
              Общий прогресс
            </Text>
            <Progress
              percent={completionPercent}
              status={completionPercent >= 100 ? 'success' : 'active'}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>
      </Row>

      <Divider />

      {/* Edit form */}
      <Form form={form} layout="vertical">
        <Row gutter={24}>
          <Col span={24}>
            <Form.Item name="tender_id" label="Связь с тендером (опционально)">
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
          </Col>
        </Row>

        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="Наименование объекта"
              rules={[{ required: true, message: 'Введите наименование' }]}
            >
              <Input placeholder="Название объекта" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="client_name"
              label="Заказчик"
              rules={[{ required: true, message: 'Введите заказчика' }]}
            >
              <Input placeholder="Название заказчика" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="contract_cost"
              label="Стоимость договора (₽)"
              rules={[{ required: true, message: 'Введите стоимость' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="0"
                min={0 as number}
                step={0.01}
                precision={2}
                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                parser={(value) => Number(value!.replace(/\s/g, '').replace(',', '.'))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="area" label="Площадь (м²)">
              <InputNumber
                style={{ width: '100%' }}
                placeholder="0"
                min={0 as number}
                step={0.01}
                precision={2}
                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                parser={(value) => Number(value!.replace(/\s/g, '').replace(',', '.'))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={24}>
          <Col span={12}>
            <Form.Item name="contract_date" label="Дата договора">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Выберите дату" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="construction_end_date" label="Окончание строительства">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="Выберите дату" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>
            Сохранить изменения
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};
