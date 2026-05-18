import React, { useState, useEffect } from 'react';
import { Modal, Form, Select, Input, message } from 'antd';
import { fetchTenders as apiFetchTenders } from '../../lib/api/tenders';
import { createUserTask } from '../../lib/api/tasks';

interface AddTaskModalProps {
  open: boolean;
  userId: string;
  currentTheme: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const AddTaskModal: React.FC<AddTaskModalProps> = ({
  open,
  userId,
  currentTheme,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [tenders, setTenders] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchTenders();
    }
  }, [open]);

  const fetchTenders = async () => {
    try {
      const all = await apiFetchTenders();
      const rows = all.map((t) => ({ id: t.id, title: t.title }));
      // Группировка по title, выбор первого по каждому наименованию
      const uniqueTitles = rows.reduce((acc, tender) => {
        if (!acc.find((t) => t.title === tender.title)) {
          acc.push(tender);
        }
        return acc;
      }, [] as { id: string; title: string }[]);
      setTenders(uniqueTitles);
    } catch (err) {
      message.error(
        'Ошибка загрузки проектов: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      setLoading(true);
      try {
        await createUserTask({
          user_id: userId,
          tender_id: values.tender_id === 'other' ? null : values.tender_id,
          description: values.description,
        });
        message.success('Задача добавлена');
        form.resetFields();
        onSuccess();
      } catch (err) {
        message.error(
          'Ошибка создания задачи: ' +
            (err instanceof Error ? err.message : 'неизвестная ошибка'),
        );
      } finally {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title="Добавить задачу"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="Добавить"
      cancelText="Отмена"
      width={600}
      rootClassName={currentTheme === 'dark' ? 'dark-modal' : ''}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="tender_id"
          label="Наименование проекта"
          rules={[{ required: true, message: 'Выберите проект' }]}
        >
          <Select
            showSearch
            placeholder="Начните вводить название проекта..."
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={[
              ...tenders.map(t => ({ label: t.title, value: t.id })),
              { label: 'Прочее', value: 'other' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="description"
          label="Описание задачи"
          rules={[
            { required: true, message: 'Введите описание задачи' },
            { min: 10, message: 'Минимум 10 символов' },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder="Опишите задачу..."
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddTaskModal;
