import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  InputNumber,
  Select,
  Input,
  Typography,
  Space,
  Divider,
  message,
} from 'antd';
import dayjs from 'dayjs';
import {
  listProjectMonthlyCompletion,
  createProjectMonthlyCompletion,
  updateProjectMonthlyCompletion,
} from '../../../lib/api/projects';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull, ProjectCompletion } from '../../../lib/supabase/types';

const { Text } = Typography;

interface CompletionModalProps {
  open: boolean;
  project: ProjectFull | null;
  onClose: () => void;
  onSave: () => Promise<void>;
}

const MONTHS = [
  { value: 1, label: 'Январь' },
  { value: 2, label: 'Февраль' },
  { value: 3, label: 'Март' },
  { value: 4, label: 'Апрель' },
  { value: 5, label: 'Май' },
  { value: 6, label: 'Июнь' },
  { value: 7, label: 'Июль' },
  { value: 8, label: 'Август' },
  { value: 9, label: 'Сентябрь' },
  { value: 10, label: 'Октябрь' },
  { value: 11, label: 'Ноябрь' },
  { value: 12, label: 'Декабрь' },
];

const formatMoney = (value: number): string => {
  return `${value.toLocaleString('ru-RU')} ₽`;
};

export const CompletionModal: React.FC<CompletionModalProps> = ({
  open,
  project,
  onClose,
  onSave,
}) => {
  const { theme } = useTheme();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [existingRecord, setExistingRecord] = useState<ProjectCompletion | null>(null);

  // Set default year/month to current
  useEffect(() => {
    if (open && project) {
      const now = dayjs();
      form.setFieldsValue({
        year: now.year(),
        month: now.month() + 1,
        actual_amount: 0,
        forecast_amount: null,
        note: '',
      });
      setExistingRecord(null);
    }
  }, [open, project, form]);

  // Check for existing record when year/month changes
  const handlePeriodChange = async () => {
    if (!project) return;

    const year = form.getFieldValue('year');
    const month = form.getFieldValue('month');

    if (!year || !month) return;

    try {
      const rows = await listProjectMonthlyCompletion(project.id);
      const data = rows.find((r) => r.year === year && r.month === month) || null;

      if (data) {
        setExistingRecord(data as unknown as ProjectCompletion);
        form.setFieldsValue({
          actual_amount: Number(data.actual_amount),
          forecast_amount: data.forecast_amount ? Number(data.forecast_amount) : null,
          note: data.note || '',
        });
        message.info('Найдена существующая запись за этот период');
      } else {
        setExistingRecord(null);
        form.setFieldsValue({
          actual_amount: 0,
          forecast_amount: null,
          note: '',
        });
      }
    } catch (error) {
      console.error('Error checking existing record:', error);
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const completionData = {
        project_id: project!.id,
        year: values.year,
        month: values.month,
        actual_amount: values.actual_amount || 0,
        forecast_amount: values.forecast_amount || null,
        note: values.note || null,
      };

      if (existingRecord) {
        // Update existing record
        await updateProjectMonthlyCompletion(existingRecord.id, {
          actual_amount: completionData.actual_amount,
          forecast_amount: completionData.forecast_amount,
          note: completionData.note,
        });
        message.success('Выполнение обновлено');
      } else {
        // Create new record
        await createProjectMonthlyCompletion(completionData);
        message.success('Выполнение добавлено');
      }

      await onSave();
      form.resetFields();
      onClose();
    } catch (error) {
      console.error('Error saving completion:', error);
      message.error('Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  // Generate year options (current year +/- 5 years)
  const currentYear = dayjs().year();
  const yearOptions = Array.from({ length: 11 }, (_, i) => ({
    value: currentYear - 5 + i,
    label: `${currentYear - 5 + i}`,
  }));

  // Calculate remaining amount
  const remainingAmount = project
    ? (project.final_contract_cost ?? 0) - (project.total_completion ?? 0)
    : 0;

  return (
    <Modal
      title={`Закрытие выполнения: ${project?.name || ''}`}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={existingRecord ? 'Обновить' : 'Сохранить'}
      cancelText="Отмена"
      confirmLoading={loading}
      width={500}
      className={theme === 'dark' ? 'dark-modal' : ''}
    >
      {project && (
        <div style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Итого договор:</Text>
              <Text strong>{formatMoney(project.final_contract_cost ?? 0)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Закрыто:</Text>
              <Text>{formatMoney(project.total_completion ?? 0)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary">Осталось:</Text>
              <Text type={remainingAmount > 0 ? 'warning' : 'success'}>
                {formatMoney(remainingAmount)}
              </Text>
            </div>
          </Space>
          <Divider style={{ margin: '12px 0' }} />
        </div>
      )}

      <Form form={form} layout="vertical">
        <Space style={{ width: '100%' }}>
          <Form.Item
            name="year"
            label="Год"
            rules={[{ required: true, message: 'Выберите год' }]}
            style={{ width: 120 }}
          >
            <Select options={yearOptions} onChange={handlePeriodChange} />
          </Form.Item>
          <Form.Item
            name="month"
            label="Месяц"
            rules={[{ required: true, message: 'Выберите месяц' }]}
            style={{ width: 150 }}
          >
            <Select options={MONTHS} onChange={handlePeriodChange} />
          </Form.Item>
        </Space>

        <Form.Item
          name="actual_amount"
          label="Фактическое выполнение (₽)"
          rules={[{ required: true, message: 'Введите сумму' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="0"
            min={0 as number}
            formatter={(value) =>
              `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
            }
            parser={(value) => Number(value!.replace(/\s/g, ''))}
          />
        </Form.Item>

        <Form.Item name="forecast_amount" label="Прогнозное выполнение (₽)">
          <InputNumber
            style={{ width: '100%' }}
            placeholder="Для будущих периодов"
            min={0 as number}
            formatter={(value) =>
              `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
            }
            parser={(value) => Number(value!.replace(/\s/g, ''))}
          />
        </Form.Item>

        <Form.Item name="note" label="Примечание">
          <Input.TextArea rows={2} placeholder="Комментарий к выполнению" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
