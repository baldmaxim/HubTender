import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  deleteBenchmarkRange,
  listBenchmarkRanges,
  type BenchmarkRange,
} from '../../../lib/api/costBenchmarks';
import { referenceRangeText } from '../../../lib/quality/costBenchmarkPolicy';
import { BenchmarkRangeForm } from './BenchmarkRangeForm';

const { Text } = Typography;

interface Props {
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  /** Справочник изменился — сравнение надо пересчитать. */
  onChanged: () => void;
}

/** Справочник эталонных диапазонов. Смотреть могут все, править — руководство. */
export const BenchmarkRangesModal: React.FC<Props> = ({ open, canEdit, onClose, onChanged }) => {
  const [ranges, setRanges] = useState<BenchmarkRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BenchmarkRange | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRanges(await listBenchmarkRanges());
    } catch (e) {
      console.error('Ошибка загрузки диапазонов:', e);
      message.error('Не удалось загрузить справочник диапазонов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const remove = async (r: BenchmarkRange) => {
    try {
      await deleteBenchmarkRange(r.id);
      message.success('Диапазон удалён');
      await load();
      onChanged();
    } catch (e) {
      console.error('Ошибка удаления диапазона:', e);
      message.error('Не удалось удалить диапазон');
    }
  };

  const columns: ColumnsType<BenchmarkRange> = [
    { title: 'Цель', dataIndex: 'target_name', key: 'target' },
    {
      title: 'Показатель',
      key: 'metric',
      width: 130,
      render: (_, r) => (r.metric_kind === 'per_area_sp' ? '₽ / м² СП' : '₽ / ед. объёма'),
    },
    {
      title: 'Для',
      key: 'scope',
      width: 170,
      render: (_, r) => (
        <Space size={4} wrap>
          <Tag>{r.housing_class ?? 'любой класс'}</Tag>
          <Tag>{r.construction_scope ?? 'любой объём'}</Tag>
        </Space>
      ),
    },
    {
      title: 'Диапазон, ₽',
      key: 'range',
      width: 150,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text>{referenceRangeText({ source: 'manual_any', min: r.min_value, max: r.max_value })}</Text>
          {r.note && <Text type="secondary" style={{ fontSize: 12 }}>{r.note}</Text>}
        </Space>
      ),
    },
  ];
  if (canEdit) {
    columns.push({
      title: '',
      key: 'actions',
      width: 90,
      render: (_, r) => (
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(r);
              setFormOpen(true);
            }}
          />
          <Popconfirm title="Удалить диапазон?" okText="Удалить" cancelText="Отмена" onConfirm={() => void remove(r)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    });
  }

  return (
    <Modal open={open} title="Эталонные диапазоны" width={860} footer={null} onCancel={onClose}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          Ручной диапазон важнее истории согласованных тендеров. Самый конкретный подходящий
          выигрывает: класс и объём строительства → только класс → только объём → любой объект.
        </Text>
        {canEdit ? (
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Добавить диапазон
          </Button>
        ) : (
          <Text type="secondary">Править справочник могут руководство и ведущие инженеры.</Text>
        )}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={ranges}
          scroll={{ x: 640 }}
          pagination={ranges.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
        />
      </Space>
      <BenchmarkRangeForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void load();
          onChanged();
        }}
      />
    </Modal>
  );
};
