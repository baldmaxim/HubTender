import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Button,
  Modal,
  Typography,
  Space,
  Tooltip,
  message,
  Select,
} from 'antd';
import {
  UndoOutlined,
  FileExcelOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';

const { Text } = Typography;

interface ImportSessionRow {
  id: string;
  user_id: string;
  tender_id: string;
  file_name: string | null;
  items_count: number;
  imported_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  positions_snapshot: Array<{
    id: string;
    manual_volume: number | null;
    manual_note: string | null;
  }> | null;
  user_full_name: string;
  user_role: string;
  tender_title: string;
  tender_number: string;
  cancelled_by_name: string | null;
}

const ImportLog: React.FC = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ImportSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [tenderFilter, setTenderFilter] = useState<string | null>(null);
  const [tenders, setTenders] = useState<{ id: string; title: string; tender_number: string }[]>([]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('import_sessions')
        .select(`
          id,
          user_id,
          tender_id,
          file_name,
          items_count,
          imported_at,
          cancelled_at,
          cancelled_by,
          positions_snapshot,
          users!import_sessions_user_id_fkey(full_name, role_code),
          tenders!import_sessions_tender_id_fkey(title, tender_number),
          cancelled_by_user:users!import_sessions_cancelled_by_fkey(full_name)
        `)
        .order('imported_at', { ascending: false })
        .limit(200);

      if (tenderFilter) {
        query = query.eq('tender_id', tenderFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows: ImportSessionRow[] = (data || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        tender_id: s.tender_id,
        file_name: s.file_name,
        items_count: s.items_count,
        imported_at: s.imported_at,
        cancelled_at: s.cancelled_at,
        cancelled_by: s.cancelled_by,
        positions_snapshot: s.positions_snapshot,
        user_full_name: s.users?.full_name || '—',
        user_role: s.users?.role_code || '',
        tender_title: s.tenders?.title || '—',
        tender_number: s.tenders?.tender_number || '',
        cancelled_by_name: s.cancelled_by_user?.full_name || null,
      }));

      setSessions(rows);
    } catch (err: any) {
      message.error('Ошибка загрузки журнала: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [tenderFilter]);

  const fetchTenders = async () => {
    const { data } = await supabase
      .from('tenders')
      .select('id, title, tender_number')
      .order('title');
    setTenders(data || []);
  };

  useEffect(() => {
    fetchTenders();
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCancel = (session: ImportSessionRow) => {
    Modal.confirm({
      title: 'Отменить импорт?',
      content: (
        <Space direction="vertical" size={4}>
          <Text>
            Будут удалены <Text strong>{session.items_count}</Text> элементов BOQ,
            импортированных из файла <Text code>{session.file_name || 'неизвестный файл'}</Text>.
          </Text>
          <Text type="secondary">
            Данные ГП позиций (количество и примечание) будут восстановлены до состояния до импорта.
          </Text>
          <Text type="danger">Это действие нельзя отменить.</Text>
        </Space>
      ),
      okText: 'Отменить импорт',
      okType: 'danger',
      cancelText: 'Назад',
      width: 480,
      onOk: () => performCancel(session),
    });
  };

  const performCancel = async (session: ImportSessionRow) => {
    if (!user?.id) return;
    setCancelling(session.id);
    try {
      // 1. Удаляем все boq_items этой сессии
      const { error: deleteError } = await supabase
        .from('boq_items')
        .delete()
        .eq('import_session_id', session.id);

      if (deleteError) throw deleteError;

      // 2. Восстанавливаем данные ГП позиций из snapshot
      if (session.positions_snapshot && session.positions_snapshot.length > 0) {
        for (const snap of session.positions_snapshot) {
          await supabase
            .from('client_positions')
            .update({
              manual_volume: snap.manual_volume,
              manual_note: snap.manual_note,
            })
            .eq('id', snap.id);
        }
      }

      // 3. Помечаем сессию как отменённую
      const { error: updateError } = await supabase
        .from('import_sessions')
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
        })
        .eq('id', session.id);

      if (updateError) throw updateError;

      message.success(`Импорт отменён. Удалено ${session.items_count} элементов BOQ.`);
      fetchSessions();
    } catch (err: any) {
      message.error('Ошибка при отмене импорта: ' + err.message);
    } finally {
      setCancelling(null);
    }
  };

  const roleLabel: Record<string, string> = {
    administrator: 'Администратор',
    developer: 'Разработчик',
    director: 'Директор',
    senior_group: 'Ведущий инженер',
    engineer: 'Инженер',
    general_director: 'Ген. директор',
  };

  const roleColor: Record<string, string> = {
    administrator: 'red',
    developer: 'purple',
    director: 'blue',
    senior_group: 'cyan',
    engineer: 'green',
    general_director: 'gold',
  };

  const columns: ColumnsType<ImportSessionRow> = [
    {
      title: 'Пользователь',
      key: 'user',
      width: 200,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text strong style={{ fontSize: 13 }}>{row.user_full_name}</Text>
          <Tag color={roleColor[row.user_role] || 'default'} style={{ margin: 0 }}>
            {roleLabel[row.user_role] || row.user_role}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Тендер',
      key: 'tender',
      width: 240,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text style={{ fontSize: 13 }}>{row.tender_title}</Text>
          {row.tender_number && (
            <Text type="secondary" style={{ fontSize: 11 }}>№ {row.tender_number}</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Файл',
      dataIndex: 'file_name',
      key: 'file_name',
      width: 200,
      render: (name) => (
        <Space>
          <FileExcelOutlined style={{ color: '#52c41a' }} />
          <Text style={{ fontSize: 12 }}>{name || '—'}</Text>
        </Space>
      ),
    },
    {
      title: 'Дата импорта',
      dataIndex: 'imported_at',
      key: 'imported_at',
      width: 160,
      render: (val) => (
        <Text style={{ fontSize: 12 }}>
          {dayjs(val).format('DD.MM.YYYY HH:mm')}
        </Text>
      ),
    },
    {
      title: 'Элементов',
      dataIndex: 'items_count',
      key: 'items_count',
      width: 100,
      align: 'right',
      render: (val) => <Text strong>{val}</Text>,
    },
    {
      title: 'Статус',
      key: 'status',
      width: 160,
      render: (_, row) => {
        if (row.cancelled_at) {
          return (
            <Space direction="vertical" size={2}>
              <Tag color="red">Отменён</Tag>
              {row.cancelled_by_name && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {row.cancelled_by_name}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 11 }}>
                {dayjs(row.cancelled_at).format('DD.MM.YYYY HH:mm')}
              </Text>
            </Space>
          );
        }
        return <Tag color="green">Активен</Tag>;
      },
    },
    {
      title: 'Действие',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, row) => {
        if (row.cancelled_at) return null;
        return (
          <Tooltip title="Отменить импорт и удалить вставленные элементы">
            <Button
              danger
              icon={<UndoOutlined />}
              size="small"
              loading={cancelling === row.id}
              onClick={() => handleCancel(row)}
            >
              Отменить
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Card
      title="Журнал импортов строк заказчика"
      extra={
        <Space>
          <Select
            placeholder="Фильтр по тендеру"
            allowClear
            style={{ width: 280 }}
            value={tenderFilter}
            onChange={setTenderFilter}
            showSearch
            optionFilterProp="label"
            options={tenders.map(t => ({
              value: t.id,
              label: t.tender_number ? `${t.tender_number} — ${t.title}` : t.title,
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchSessions} loading={loading}>
            Обновить
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={sessions}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
        size="small"
        rowClassName={(row) => row.cancelled_at ? 'import-log-cancelled-row' : ''}
        scroll={{ x: 1200 }}
      />
    </Card>
  );
};

export default ImportLog;
