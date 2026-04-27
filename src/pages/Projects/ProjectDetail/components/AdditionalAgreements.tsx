import React, { useEffect, useState, useCallback } from 'react';
import {
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
  Card,
  Row,
  Col,
  Statistic,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { useTheme } from '../../../../contexts/ThemeContext';
import type { ProjectFull, ProjectAgreement } from '../../../../lib/supabase/types';
import {
  listProjectAgreements,
  createProjectAgreement,
  updateProjectAgreement,
  deleteProjectAgreement,
} from '../../../../lib/api/projects';

const { Text } = Typography;

interface AdditionalAgreementsProps {
  project: ProjectFull;
  onSave: () => Promise<void>;
}

const formatMoney = (value: number): string => {
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1_000_000_000) {
    const billions = absValue / 1_000_000_000;
    if (billions % 1 === 0) return `${sign}${billions.toFixed(0)} млрд`;
    return `${sign}${billions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млрд`;
  }
  if (absValue >= 1_000_000) {
    const millions = absValue / 1_000_000;
    if (millions % 1 === 0) return `${sign}${millions.toFixed(0)} млн`;
    return `${sign}${millions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} млн`;
  }
  return value.toLocaleString('ru-RU');
};

// Форматирование суммы со знаком для отображения
const formatMoneyWithSign = (value: number): string => {
  if (value > 0) return `+${formatMoney(value)}`;
  if (value < 0) return formatMoney(value);
  return '0';
};

// Парсер для InputNumber - поддержка точки и запятой
const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
};

export const AdditionalAgreements: React.FC<AdditionalAgreementsProps> = ({
  project,
  onSave,
}) => {
  const { theme } = useTheme();
  const [form] = Form.useForm();
  const [agreements, setAgreements] = useState<ProjectAgreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm] = Form.useForm();

  const loadAgreements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProjectAgreements(project.id, 'asc');
      setAgreements(data.map((item) => ({ ...item, amount: Number(item.amount) })) as ProjectAgreement[]);
    } catch (error) {
      console.error('Error loading agreements:', error);
      message.error('Ошибка загрузки доп. соглашений');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadAgreements();
  }, [loadAgreements]);

  const handleAddNew = async () => {
    try {
      const values = await form.validateFields();
      setSavingNew(true);

      await createProjectAgreement({
        project_id: project.id,
        agreement_date: values.agreement_date.format('YYYY-MM-DD'),
        amount: values.amount,
        description: values.description || null,
        agreement_number: values.agreement_number || null,
      });

      message.success('Доп. соглашение добавлено');
      form.resetFields();
      setAddingNew(false);
      await loadAgreements();
      await onSave();
    } catch (error) {
      console.error('Error adding agreement:', error);
      message.error('Ошибка добавления');
    } finally {
      setSavingNew(false);
    }
  };

  const handleDelete = async (record: ProjectAgreement) => {
    try {
      await deleteProjectAgreement(record.id);
      message.success('Доп. соглашение удалено');
      setAgreements((prev) => prev.filter((a) => a.id !== record.id));
      await onSave();
    } catch (error) {
      console.error('Error deleting agreement:', error);
      message.error('Ошибка удаления');
    }
  };

  const handleEdit = (record: ProjectAgreement) => {
    setEditingId(record.id);
    editForm.setFieldsValue({
      agreement_number: record.agreement_number,
      agreement_date: dayjs(record.agreement_date),
      amount: record.amount,
      description: record.description,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    try {
      const values = await editForm.validateFields();

      await updateProjectAgreement(editingId, {
        agreement_number: values.agreement_number || null,
        agreement_date: values.agreement_date.format('YYYY-MM-DD'),
        amount: values.amount,
        description: values.description || null,
      });

      message.success('Изменения сохранены');
      setEditingId(null);
      await loadAgreements();
      await onSave();
    } catch (error) {
      console.error('Error updating agreement:', error);
      message.error('Ошибка сохранения');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    editForm.resetFields();
  };

  const columns: ColumnsType<ProjectAgreement> = [
    {
      title: '№ соглашения',
      dataIndex: 'agreement_number',
      key: 'agreement_number',
      width: 140,
      render: (val, record) =>
        editingId === record.id ? (
          <Form.Item name="agreement_number" style={{ margin: 0 }}>
            <Input placeholder="ДС-1..." />
          </Form.Item>
        ) : (
          <Text strong>{val || '—'}</Text>
        ),
    },
    {
      title: 'Дата',
      dataIndex: 'agreement_date',
      key: 'agreement_date',
      width: 140,
      render: (date, record) =>
        editingId === record.id ? (
          <Form.Item
            name="agreement_date"
            rules={[{ required: true, message: 'Выберите' }]}
            style={{ margin: 0 }}
          >
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} placeholder="Выбери дату" />
          </Form.Item>
        ) : (
          dayjs(date).format('DD.MM.YYYY')
        ),
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      key: 'amount',
      width: 180,
      align: 'right',
      render: (val, record) =>
        editingId === record.id ? (
          <Form.Item
            name="amount"
            rules={[{ required: true, message: 'Введите' }]}
            style={{ margin: 0 }}
          >
            <InputNumber
              style={{ width: '100%' }}
              precision={2}
              decimalSeparator=","
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
              parser={parseNumber}
              controls={false}
            />
          </Form.Item>
        ) : (
          <Text strong style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatMoneyWithSign(val)} ₽
          </Text>
        ),
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (val, record) =>
        editingId === record.id ? (
          <Form.Item name="description" style={{ margin: 0 }}>
            <Input placeholder="Описание" />
          </Form.Item>
        ) : (
          <Text type="secondary">{val || '—'}</Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, record) =>
        editingId === record.id ? (
          <Space size="small">
            <Button icon={<SaveOutlined />} size="small" type="primary" onClick={handleSaveEdit} />
            <Button icon={<CloseOutlined />} size="small" onClick={handleCancelEdit} />
          </Space>
        ) : (
          <Space size="small">
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
              disabled={!!editingId}
            />
            <Popconfirm
              title="Удалить доп. соглашение?"
              onConfirm={() => handleDelete(record)}
              okText="Да"
              cancelText="Нет"
            >
              <Button icon={<DeleteOutlined />} size="small" danger disabled={!!editingId} />
            </Popconfirm>
          </Space>
        ),
    },
  ];

  const totalAgreementsSum = agreements.reduce((sum, a) => sum + a.amount, 0);
  const totalWithContract = project.contract_cost + totalAgreementsSum;

  return (
    <div>
      {/* Summary */}
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
              title="Сумма доп. соглашений"
              value={totalAgreementsSum}
              formatter={() => formatMoneyWithSign(totalAgreementsSum)}
              valueStyle={{
                color: totalAgreementsSum > 0 ? '#52c41a' : totalAgreementsSum < 0 ? '#ff4d4f' : undefined,
                fontSize: 16
              }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Итого договор"
              value={totalWithContract}
              formatter={() => formatMoney(totalWithContract)}
              valueStyle={{ color: '#722ed1', fontSize: 16 }}
              suffix="₽"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Кол-во соглашений"
              value={agreements.length}
              valueStyle={{ fontSize: 16 }}
              suffix="шт"
            />
          </Card>
        </Col>
      </Row>

      {/* Add button */}
      {!addingNew && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddingNew(true)}
          style={{ marginBottom: 16 }}
        >
          Добавить доп. соглашение
        </Button>
      )}

      {/* Add form */}
      {addingNew && (
        <Card
          size="small"
          style={{
            marginBottom: 16,
            background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
          }}
        >
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col span={4}>
                <Form.Item name="agreement_number" label="№ соглашения">
                  <Input placeholder="ДС-1..." />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item
                  name="agreement_date"
                  label="Дата"
                  rules={[{ required: true, message: 'Выберите дату' }]}
                >
                  <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} placeholder="Выбери дату" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item
                  name="amount"
                  label="Сумма (₽)"
                  rules={[{ required: true, message: 'Введите сумму' }]}
                  tooltip="Отрицательная сумма уменьшает стоимость договора"
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    precision={2}
                    decimalSeparator=","
                    formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                    parser={parseNumber}
                    controls={false}
                  />
                </Form.Item>
              </Col>
              <Col span={11}>
                <Form.Item name="description" label="Описание">
                  <Input placeholder="Описание доп. соглашения" />
                </Form.Item>
              </Col>
            </Row>
            <Space>
              <Button type="primary" onClick={handleAddNew} loading={savingNew}>
                Сохранить
              </Button>
              <Button onClick={() => { setAddingNew(false); form.resetFields(); }}>
                Отмена
              </Button>
            </Space>
          </Form>
        </Card>
      )}

      {/* Table */}
      <Form form={editForm} component={false}>
        <Table
          columns={columns}
          dataSource={agreements}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: 'Нет дополнительных соглашений' }}
          summary={() =>
            agreements.length > 0 ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}>
                    <Text strong>ИТОГО</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong style={{ color: totalAgreementsSum >= 0 ? '#52c41a' : '#ff4d4f' }}>
                      {formatMoneyWithSign(totalAgreementsSum)} ₽
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={2} />
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      </Form>
    </div>
  );
};
