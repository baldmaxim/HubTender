import React, { useState, useEffect, useCallback } from 'react';
import {
  App,
  Card,
  Table,
  Tag,
  Button,
  Typography,
  Space,
  Tooltip,
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
import { getErrorMessage } from '../../../utils/errors';

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
  user_role_name: string;
  user_role_color: string | null;
  tender_title: string;
  tender_number: string;
  cancelled_by_name: string | null;
}

const ImportLog: React.FC = () => {
  const { modal, message } = App.useApp();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ImportSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [tenderFilter, setTenderFilter] = useState<string | null>(null);
  const [tenders, setTenders] = useState<{ id: string; title: string; tender_number: string }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('import_sessions')
        .select('id, user_id, tender_id, file_name, items_count, imported_at, cancelled_at, cancelled_by, positions_snapshot')
        .order('imported_at', { ascending: false })
        .limit(200);

      if (tenderFilter) {
        query = query.eq('tender_id', tenderFilter);
      }

      const { data: sessionsData, error } = await query;
      if (error) throw error;

      const rawSessions = sessionsData || [];

      // Собираем уникальные user_id для загрузки имён
      const userIds = [...new Set([
        ...rawSessions.map(s => s.user_id),
        ...rawSessions.map(s => s.cancelled_by),
      ].filter(Boolean))];

      // Собираем уникальные tender_id
      const tenderIds = [...new Set(rawSessions.map(s => s.tender_id).filter(Boolean))];

      // Параллельная загрузка пользователей и тендеров
      const [usersRes, tendersRes] = await Promise.all([
        userIds.length > 0
          ? supabase
            .from('users')
            .select(`
              id,
              full_name,
              role_code,
              roles:role_code (
                name,
                color
              )
            `)
            .in('id', userIds)
          : Promise.resolve({ data: [] }),
        tenderIds.length > 0
          ? supabase.from('tenders').select('id, title, tender_number').in('id', tenderIds)
          : Promise.resolve({ data: [] }),
      ]);

      const usersMap = new Map((usersRes.data || []).map((u) => [u.id, u]));
      const tendersMap = new Map((tendersRes.data || []).map((t) => [t.id, t]));

      const rows: ImportSessionRow[] = rawSessions.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        tender_id: s.tender_id,
        file_name: s.file_name,
        items_count: s.items_count,
        imported_at: s.imported_at,
        cancelled_at: s.cancelled_at,
        cancelled_by: s.cancelled_by,
        positions_snapshot: s.positions_snapshot,
        user_full_name: usersMap.get(s.user_id)?.full_name || '—',
        user_role: usersMap.get(s.user_id)?.role_code || '',
        user_role_name: usersMap.get(s.user_id)?.roles?.name || '',
        user_role_color: usersMap.get(s.user_id)?.roles?.color || null,
        tender_title: tendersMap.get(s.tender_id)?.title || '—',
        tender_number: tendersMap.get(s.tender_id)?.tender_number || '',
        cancelled_by_name: s.cancelled_by ? (usersMap.get(s.cancelled_by)?.full_name || null) : null,
      }));

      setSessions(rows);
    } catch (err) {
      message.error('Ошибка загрузки журнала: ' + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
    // message is a stable antd module import
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    setCurrentPage(1);
  }, [tenderFilter]);

  const handleCancel = (session: ImportSessionRow) => {
    modal.confirm({
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
    } catch (err) {
      message.error('Ошибка при отмене импорта: ' + getErrorMessage(err));
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

  roleLabel.senior_group = 'Старший группы';
  roleLabel.veduschiy_inzhener = 'Ведущий инженер';
  roleColor.veduschiy_inzhener = 'geekblue';

  const columns: ColumnsType<ImportSessionRow> = [
    {
      title: 'Пользователь',
      key: 'user',
      width: 200,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text strong style={{ fontSize: 13 }}>{row.user_full_name}</Text>
          <Tag color={row.user_role_color || roleColor[row.user_role] || 'default'} style={{ margin: 0 }}>
            {row.user_role_name || roleLabel[row.user_role] || row.user_role}
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
        pagination={{
          current: currentPage,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (page, nextPageSize) => {
            setCurrentPage(page);
            if (nextPageSize && nextPageSize !== pageSize) {
              setPageSize(nextPageSize);
              setCurrentPage(1);
            }
          },
        }}
        size="small"
        rowClassName={(row) => row.cancelled_at ? 'import-log-cancelled-row' : ''}
        scroll={{ x: 1200 }}
      />
    </Card>
  );
};

export default ImportLog;
