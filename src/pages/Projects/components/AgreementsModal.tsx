import React, { useEffect, useState } from 'react';
import {
  Modal,
  Table,
  Button,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Space,
  Typography,
  Popconfirm,
  message,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull, ProjectAgreement } from '../../../lib/supabase/types';
import {
  listProjectAgreements,
  createProjectAgreement,
  deleteProjectAgreement,
} from '../../../lib/api/projects';

const { Text, Title } = Typography;

interface AgreementsModalProps {
  open: boolean;
  project: ProjectFull | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

const formatMoney = (value: number): string => {
  return `${value.toLocaleString('ru-RU')} ₽`;
};

export const AgreementsModal: React.FC<AgreementsModalProps> = ({
  open,
  project,
  onClose,
  onRefresh,
}) => {
  const { theme } = useTheme();
  const [form] = Form.useForm();
  const [agreements, setAgreements] = useState<ProjectAgreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  useEffect(() => {
    const loadAgreements = async () => {
      if (!project) return;
      setLoading(true);
      try {
        const data = await listProjectAgreements(project.id, 'desc');
        setAgreements(data.map((item) => ({ ...item, amount: Number(item.amount) })) as ProjectAgreement[]);
      } catch (error) {
        console.error('Error loading agreements:', error);
        message.error('Ошибка загрузки доп. соглашений');
      } finally {
        setLoading(false);
      }
    };

    if (open && project) {
      loadAgreements();
      setAddingNew(false);
      form.resetFields();
    }
  }, [open, project, form]);

  const handleAddNew = async () => {
    try {
      const values = await form.validateFields();
      setSavingNew(true);

      await createProjectAgreement({
        project_id: project!.id,
        agreement_date: values.agreement_date.format('YYYY-MM-DD'),
        amount: values.amount,
        description: values.description || null,
        agreement_number: values.agreement_number || null,
      });

      message.success('Доп. соглашение добавлено');
      form.resetFields();
      setAddingNew(false);

      const data = await listProjectAgreements(project!.id, 'desc');
      setAgreements(data.map((item) => ({ ...item, amount: Number(item.amount) })) as ProjectAgreement[]);

      await onRefresh();
    } catch (error) {
      console.error('Error adding agreement:', error);
      message.error('Ошибка добавления доп. соглашения');
    } finally {
      setSavingNew(false);
    }
  };

  const handleDelete = async (record: ProjectAgreement) => {
    try {
      await deleteProjectAgreement(record.id);
      message.success('Доп. соглашение удалено');
      setAgreements((prev) => prev.filter((a) => a.id !== record.id));
      await onRefresh();
    } catch (error) {
      console.error('Error deleting agreement:', error);
      message.error('Ошибка удаления');
    }
  };

  const columns: ColumnsType<ProjectAgreement> = [
    {
      title: '№',
      dataIndex: 'agreement_number',
      key: 'agreement_number',
      width: 100,
      render: (val) => val || '—',
    },
    {
      title: 'Дата',
      dataIndex: 'agreement_date',
      key: 'agreement_date',
      width: 120,
      render: (date) => dayjs(date).format('DD.MM.YYYY'),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      key: 'amount',
      width: 150,
      align: 'right',
      render: (val) => <Text strong>{formatMoney(val)}</Text>,
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (val) => val || '—',
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_, record) => (
        <Popconfirm
          title="Удалить доп. соглашение?"
          onConfirm={() => handleDelete(record)}
          okText="Да"
          cancelText="Нет"
        >
          <Button icon={<DeleteOutlined />} size="small" danger />
        </Popconfirm>
      ),
    },
  ];

  const totalSum = agreements.reduce((sum, a) => sum + a.amount, 0);

  return (
    <Modal
      title={`Дополнительные соглашения: ${project?.name || ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      className={theme === 'dark' ? 'dark-modal' : ''}
    >
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Title level={5} style={{ margin: 0 }}>
            Всего: {formatMoney(totalSum)}
          </Title>
          {!addingNew && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddingNew(true)}
            >
              Добавить
            </Button>
          )}
        </Space>
      </div>

      {addingNew && (
        <div
          style={{
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
            padding: 16,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <Form form={form} layout="vertical">
            <Space style={{ width: '100%' }} align="start">
              <Form.Item
                name="agreement_number"
                label="№ соглашения"
                style={{ width: 120, marginBottom: 0 }}
              >
                <Input placeholder="ДС-1" />
              </Form.Item>
              <Form.Item
                name="agreement_date"
                label="Дата"
                rules={[{ required: true, message: 'Выберите дату' }]}
                style={{ width: 140, marginBottom: 0 }}
              >
                <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="amount"
                label="Сумма (₽)"
                rules={[{ required: true, message: 'Введите сумму' }]}
                style={{ width: 160, marginBottom: 0 }}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0 as number}
                  formatter={(value) =>
                    `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                  }
                  parser={(value) => Number(value!.replace(/\s/g, ''))}
                />
              </Form.Item>
              <Form.Item
                name="description"
                label="Описание"
                style={{ flex: 1, marginBottom: 0 }}
              >
                <Input placeholder="Описание доп. соглашения" />
              </Form.Item>
            </Space>
            <Space style={{ marginTop: 12 }}>
              <Button type="primary" onClick={handleAddNew} loading={savingNew}>
                Сохранить
              </Button>
              <Button onClick={() => setAddingNew(false)}>Отмена</Button>
            </Space>
          </Form>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={agreements}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        locale={{ emptyText: 'Нет дополнительных соглашений' }}
      />
    </Modal>
  );
};
