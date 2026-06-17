import React, { useState, useEffect } from 'react';
import { Table, Typography, theme, Input, Tag, Button, Space, message, Card, Progress, Tooltip } from 'antd';
import {
  SearchOutlined,
  SyncOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import type { Tender } from '../../lib/supabase';
import { fetchTenders as apiFetchTenders } from '../../lib/api/tenders';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
import { formatNumberWithSpaces } from '../../utils/numberFormat';
import { getVersionColorByTitle } from '../../utils/versionColor';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';
import './Dashboard.css';

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.locale('ru');

const { Title, Text } = Typography;

interface TenderTableData {
  key: string;
  id: string;
  number: string;
  name: string;
  version: number;
  status_deadline: boolean;
  construction_area: number;
  boq_cost: number;
  cost_per_sqm: number;
  deadline: string;
  client: string;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const { token } = theme.useToken();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [tenders, setTenders] = useState<TenderTableData[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filteredTenders, setFilteredTenders] = useState<TenderTableData[]>([]);

  // Загрузка тендеров из базы данных
  const fetchTenders = async () => {
    setLoading(true);
    try {
      // Активные тендеры + cached_grand_total (поддерживается триггером
      // на boq_items/tender_markup_percentage/subcontract_growth_exclusions —
      // server-authoritative; убирает N batched-запросов к boq_items).
      const all = await apiFetchTenders();
      const data = all.filter((t: Tender) => !t.is_archived);

      const formattedData: TenderTableData[] = (data || []).map((tender: Tender) => {
        const boqCost = tender.cached_grand_total || 0;

        // Рассчитываем стоимость за м²
        const constructionArea = tender.area_sp || 0;
        const costPerSqm = constructionArea > 0 ? boqCost / constructionArea : 0;

        return {
          key: tender.id,
          id: tender.id,
          number: tender.tender_number || '',
          name: tender.title || '',
          version: tender.version || 1,
          status_deadline: tender.submission_deadline ?
            new Date(tender.submission_deadline) < new Date() : false,
          construction_area: constructionArea,
          boq_cost: boqCost,
          cost_per_sqm: costPerSqm,
          deadline: tender.submission_deadline || '',
          client: tender.client_name || '',
          created_at: tender.created_at || '',
        };
      });

      setTenders(formattedData);
      setFilteredTenders(formattedData);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить тендеры');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenders();
  }, []);

  // Native WS hub — обновляем список при любом изменении реестра тендеров.
  useRealtimeTopic('tenders', () => {
    void fetchTenders();
  });

  // Фильтрация тендеров по поисковому запросу
  useEffect(() => {
    if (searchText) {
      const filtered = tenders.filter(tender =>
        tender.name.toLowerCase().includes(searchText.toLowerCase()) ||
        tender.number.toLowerCase().includes(searchText.toLowerCase()) ||
        tender.client.toLowerCase().includes(searchText.toLowerCase())
      );
      setFilteredTenders(filtered);
    } else {
      setFilteredTenders(tenders);
    }
  }, [searchText, tenders]);

  // Обновление расчета для тендера
  const handleUpdateCalculation = async () => {
    try {
      // Перезагружаем данные тендеров для обновления расчетов
      await fetchTenders();
      message.success('Расчет обновлен');
    } catch (error) {
      message.error('Ошибка обновления расчета');
    }
  };

  const columns = [
    {
      title: 'Номер тендера',
      dataIndex: 'number',
      key: 'number',
      width: '10%',
      align: 'center' as const,
      render: (text: string) => (
        <Text strong style={{ fontSize: 13 }}>{text || '-'}</Text>
      ),
    },
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      width: '20%',
      align: 'center' as const,
      ellipsis: true,
      render: (text: string, record: TenderTableData) => (
        <div>
          <Space size={4}>
            <Text strong style={{ fontSize: 13 }}>{text}</Text>
            <Tag color={getVersionColorByTitle(record.version, record.name, tenders.map(t => ({ title: t.name, version: t.version })))} style={{ fontSize: 11 }}>v{record.version || 1}</Tag>
          </Space>
          {record.client && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              {record.client}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Статус дедлайна',
      dataIndex: 'deadline',
      key: 'status_deadline',
      width: '30%',
      align: 'center' as const,
      render: (deadline: string, record: TenderTableData) => {
        if (!deadline) {
          return <Tag color="default">Дедлайн не указан</Tag>;
        }

        const now = dayjs();
        const deadlineDate = dayjs(deadline);
        const createdDate = dayjs(record.created_at);

        // Если дедлайн прошел
        if (deadlineDate.isBefore(now)) {
          return (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Progress
                percent={100}
                status="success"
                strokeColor="#10b981"
                format={() => 'Завершен'}
                size="small"
              />
            </Space>
          );
        }

        // Рассчитываем общее время от создания до дедлайна
        const totalDuration = deadlineDate.diff(createdDate, 'millisecond');
        // Рассчитываем прошедшее время от создания до сейчас
        const elapsedDuration = now.diff(createdDate, 'millisecond');
        // Процент прогресса
        const progressPercent = Math.min(Math.round((elapsedDuration / totalDuration) * 100), 99);

        // Оставшееся время
        const remainingDuration = deadlineDate.diff(now);
        const remainingDays = Math.floor(remainingDuration / (1000 * 60 * 60 * 24));
        const remainingHours = Math.floor((remainingDuration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        // Форматирование оставшегося времени
        let remainingText = '';
        if (remainingDays > 0) {
          remainingText = `${remainingDays} дн. ${remainingHours} ч.`;
        } else if (remainingHours > 0) {
          remainingText = `${remainingHours} ч.`;
        } else {
          const remainingMinutes = Math.floor(remainingDuration / (1000 * 60));
          remainingText = `${remainingMinutes} мин.`;
        }

        // Определяем цвет в зависимости от оставшегося времени
        let progressColor = '#10b981'; // Зеленый по умолчанию
        if (progressPercent > 90) {
          progressColor = '#ef4444'; // Красный
        } else if (progressPercent > 75) {
          progressColor = '#f97316'; // Оранжевый
        } else if (progressPercent > 50) {
          progressColor = '#eab308'; // Желтый
        }

        return (
          <div style={{ width: '100%' }}>
            <Text style={{ fontSize: 11, color: progressColor, fontWeight: 500, display: 'block', marginBottom: 2 }}>
              <ClockCircleOutlined /> Осталось: {remainingText}
            </Text>
            <Progress
              percent={progressPercent}
              strokeColor={progressColor}
              showInfo={false}
              size="small"
            />
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Площадь СП</div>,
      dataIndex: 'construction_area',
      key: 'construction_area',
      width: '8%',
      align: 'center' as const,
      render: (value: number) => (
        <Text style={{ fontSize: 12 }}>{formatNumberWithSpaces(value)} м²</Text>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого стоимость ПЗ</div>,
      dataIndex: 'boq_cost',
      key: 'boq_cost',
      width: '10%',
      align: 'center' as const,
      render: (value: number) => (
        <Text strong style={{ fontSize: 12 }}>{formatNumberWithSpaces(Math.round(value))}</Text>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Стоимость за м²</div>,
      dataIndex: 'cost_per_sqm',
      key: 'cost_per_sqm',
      width: '10%',
      align: 'center' as const,
      render: (value: number) => (
        <Text style={{ fontSize: 12 }}>{formatNumberWithSpaces(Math.round(value))} ₽/м²</Text>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Крайний срок</div>,
      dataIndex: 'deadline',
      key: 'deadline',
      width: '8%',
      align: 'center' as const,
      render: (date: string) => (
        <Text style={{ fontSize: 12 }}>{date ? dayjs(date).format('DD.MM.YYYY') : '-'}</Text>
      ),
    },
    {
      title: '',
      key: 'action',
      width: '4%',
      align: 'center' as const,
      render: () => (
        <Tooltip title="Обновить расчет">
          <Button
            type="text"
            size="small"
            icon={<SyncOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleUpdateCalculation();
            }}
            style={{ color: token.colorPrimary }}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div className={`dashboard-container ${currentTheme}`} style={{ padding: '24px' }}>
      {/* Компактная шапка страницы */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        gap: 16,
        flexWrap: 'wrap'
      }}>
        {/* Левая часть: заголовок с описанием */}
        <div style={{ flex: '1 1 auto', minWidth: 300 }}>
          <Space align="center" size={12}>
            <DashboardOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
            <div>
              <Title level={3} style={{ margin: 0, lineHeight: 1.2 }}>
                Дашборд тендеров
              </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Обзор активных тендеров и основные показатели
              </Text>
            </div>
          </Space>
        </div>

        {/* Правая часть: поиск */}
        <div style={{ flex: '0 0 auto' }}>
          <Input
            placeholder="Поиск по названию, номеру, заказчику..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              width: 400,
              backgroundColor: currentTheme === 'dark' ? '#141414' : '#fff',
            }}
          />
        </div>
      </div>

      {/* Таблица тендеров */}
      <Card
        variant="borderless"
        className="dashboard-table-card"
        style={{
          borderRadius: 8,
          boxShadow: currentTheme === 'dark' ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.12)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          className="dashboard-table"
          columns={columns}
          dataSource={filteredTenders}
          loading={loading}
          pagination={false}
          size="small"
          onRow={(record) => ({
            onClick: () => {
              navigate(`/positions?tenderId=${record.id}`);
            },
            style: { cursor: 'pointer' },
          })}
          rowClassName={(record) => {
            if (!record.deadline) return '';

            const now = dayjs();
            const deadlineDate = dayjs(record.deadline);
            const createdDate = dayjs(record.created_at);

            // Если дедлайн прошел
            if (deadlineDate.isBefore(now)) {
              return 'deadline-completed';
            }

            // Рассчитываем процент прогресса
            const totalDuration = deadlineDate.diff(createdDate, 'millisecond');
            const elapsedDuration = now.diff(createdDate, 'millisecond');
            const progressPercent = Math.min(Math.round((elapsedDuration / totalDuration) * 100), 99);

            // Определяем класс в зависимости от прогресса
            if (progressPercent > 90) {
              return 'deadline-critical'; // Красный
            } else if (progressPercent > 75) {
              return 'deadline-warning'; // Оранжевый
            } else if (progressPercent > 50) {
              return 'deadline-caution'; // Желтый
            }

            return '';
          }}
          scroll={{ x: 1200 }}
        />
      </Card>
    </div>
  );
};

export default Dashboard;