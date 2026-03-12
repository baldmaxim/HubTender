/**
 * Таблица сопоставления позиций старой и новой версии
 */

import { Table, Tag, Checkbox, Button, Space, Typography, Select, Tooltip, Badge } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  QuestionCircleOutlined,
  SwapOutlined,
  LinkOutlined,
  DisconnectOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { MatchPair } from '../types';
import type { ParsedRow } from '../../../../../utils/matching';

const { Text } = Typography;

interface MatchingTableProps {
  matches: MatchPair[];
  newPositions: ParsedRow[];
  filter: 'all' | 'matched' | 'unmatched' | 'additional' | 'low_confidence';
  onToggleTransfer: (oldId: string) => void;
  onManualMatch: (oldId: string, newIdx: number) => void;
  onBreakMatch: (oldId: string) => void;
  loading?: boolean;
}

/**
 * Таблица сопоставления позиций
 *
 * Отображает:
 * - Старые позиции (слева)
 * - Новые позиции (справа)
 * - Оценку совпадения
 * - Действия: ручное сопоставление, разрыв связи, перенос данных
 */
export function MatchingTable({
  matches,
  newPositions,
  filter,
  onToggleTransfer,
  onManualMatch,
  onBreakMatch,
  loading = false,
}: MatchingTableProps) {
  // Фильтрация данных
  const filteredMatches = matches.filter(match => {
    switch (filter) {
      case 'matched':
        return match.oldPosition && match.newPosition;
      case 'unmatched':
        return (!match.oldPosition || !match.newPosition) && !match.isAdditional;
      case 'additional':
        return match.isAdditional;
      case 'low_confidence':
        // Показываем строки с совпадением менее 80% (включая low_confidence, manual)
        return match.oldPosition && match.newPosition && match.score && match.score.total < 80;
      case 'all':
      default:
        return !match.isAdditional; // Показываем все кроме ДОП работ (они в отдельной панели)
    }
  });

  /**
   * Получить цвет тега для типа сопоставления
   */
  const getMatchTypeColor = (matchType: MatchPair['matchType']) => {
    switch (matchType) {
      case 'auto':
        return 'green';
      case 'manual':
        return 'blue';
      case 'low_confidence':
        return 'orange';
      case 'new':
        return 'cyan';
      case 'deleted':
        return 'red';
      default:
        return 'default';
    }
  };

  /**
   * Получить текст для типа сопоставления
   */
  const getMatchTypeText = (matchType: MatchPair['matchType']) => {
    switch (matchType) {
      case 'auto':
        return 'Авто';
      case 'manual':
        return 'Вручную';
      case 'low_confidence':
        return 'Низкая уверенность';
      case 'new':
        return 'Новая';
      case 'deleted':
        return 'Удалена';
      default:
        return 'Неизвестно';
    }
  };

  /**
   * Получить иконку для типа сопоставления
   */
  const getMatchTypeIcon = (matchType: MatchPair['matchType']) => {
    switch (matchType) {
      case 'auto':
        return <CheckCircleOutlined />;
      case 'manual':
        return <SwapOutlined />;
      case 'low_confidence':
        return <QuestionCircleOutlined />;
      case 'new':
        return <PlusCircleOutlined />;
      case 'deleted':
        return <MinusCircleOutlined />;
      default:
        return null;
    }
  };

  const columns: ColumnsType<MatchPair> = [
    {
      title: 'Старая версия',
      key: 'oldPosition',
      width: '35%',
      render: (_, record) => {
        if (!record.oldPosition) {
          return <Text type="secondary">—</Text>;
        }

        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>{record.oldPosition.work_name}</Text>
            <Space size="small">
              {record.oldPosition.item_no && (
                <Tag color="blue">{record.oldPosition.item_no}</Tag>
              )}
              {record.oldPosition.unit_code && (
                <Tag color="green">{record.oldPosition.unit_code}</Tag>
              )}
              {record.oldPosition.volume != null && record.oldPosition.volume !== 0 && (
                <Tag color="purple">{record.oldPosition.volume}</Tag>
              )}
            </Space>
            {record.oldPosition.client_note && (
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {record.oldPosition.client_note}
              </Text>
            )}
          </Space>
        );
      },
    },

    {
      title: 'Оценка',
      key: 'score',
      width: '15%',
      align: 'center',
      render: (_, record) => {
        if (!record.score) {
          return (
            <Tag
              icon={getMatchTypeIcon(record.matchType)}
              color={getMatchTypeColor(record.matchType)}
            >
              {getMatchTypeText(record.matchType)}
            </Tag>
          );
        }

        const total = Math.round(record.score.total);
        const color = total >= 95 ? 'green' : total >= 50 ? 'orange' : 'red';

        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Tooltip
              title={
                <div>
                  <div>item_no: {record.score.itemNoMatch.toFixed(1)}%</div>
                  <div>work_name: {record.score.nameSimil.toFixed(1)}%</div>
                  <div>unit_code: {record.score.unitMatch.toFixed(1)}%</div>
                  <div>volume: {record.score.volumeProx.toFixed(1)}%</div>
                </div>
              }
            >
              <Badge count={total + '%'} style={{ backgroundColor: color === 'green' ? '#52c41a' : color === 'orange' ? '#faad14' : '#ff4d4f' }}>
                <Tag color={color}>{total}%</Tag>
              </Badge>
            </Tooltip>
            <Tag
              icon={getMatchTypeIcon(record.matchType)}
              color={getMatchTypeColor(record.matchType)}
              style={{ fontSize: '11px' }}
            >
              {getMatchTypeText(record.matchType)}
            </Tag>
          </Space>
        );
      },
    },

    {
      title: 'Новая версия',
      key: 'newPosition',
      width: '35%',
      render: (_, record) => {
        if (!record.newPosition) {
          return <Text type="secondary">—</Text>;
        }

        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>{record.newPosition.work_name}</Text>
            <Space size="small">
              {record.newPosition.item_no && (
                <Tag color="blue">{record.newPosition.item_no}</Tag>
              )}
              {record.newPosition.unit_code && (
                <Tag color="green">{record.newPosition.unit_code}</Tag>
              )}
              {record.newPosition.volume != null && record.newPosition.volume !== 0 && (
                <Tag color="purple">{record.newPosition.volume}</Tag>
              )}
            </Space>
            {record.newPosition.client_note && (
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {record.newPosition.client_note}
              </Text>
            )}
          </Space>
        );
      },
    },

    {
      title: 'Действия',
      key: 'actions',
      width: '15%',
      align: 'center',
      render: (_, record) => {
        // Случай: старая позиция без сопоставления
        if (record.oldPosition && !record.newPosition) {
          return (
            <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 180 }}>
              <Select
                placeholder="Сопоставить с..."
                style={{ width: '100%' }}
                size="small"
                showSearch
                optionFilterProp="label"
                onChange={(value: number) => onManualMatch(record.oldPosition!.id, value)}
                options={newPositions.map((pos, idx) => {
                  const fullName = (pos.item_no ? `${pos.item_no} — ` : '') + pos.work_name;
                  return { value: idx, label: fullName, title: '' };
                })}
                optionRender={(option) => (
                  <Tooltip title={option.label} placement="left" mouseEnterDelay={0.4}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {option.label}
                    </div>
                  </Tooltip>
                )}
              />
            </Space>
          );
        }

        // Случай: новая позиция без сопоставления
        if (!record.oldPosition && record.newPosition) {
          return (
            <Tag icon={<PlusCircleOutlined />} color="cyan">
              Новая
            </Tag>
          );
        }

        // Случай: сопоставленные позиции
        if (record.oldPosition && record.newPosition) {
          return (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Tooltip title="Перенести данные (manual_volume, manual_note, boq_items)">
                <Checkbox
                  checked={record.transferData}
                  onChange={() => onToggleTransfer(record.oldPosition!.id)}
                >
                  <LinkOutlined /> Перенести
                </Checkbox>
              </Tooltip>

              <Tooltip title="Разорвать сопоставление">
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DisconnectOutlined />}
                  onClick={() => onBreakMatch(record.oldPosition!.id)}
                >
                  Разорвать
                </Button>
              </Tooltip>
            </Space>
          );
        }

        return <Text type="secondary">—</Text>;
      },
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={filteredMatches}
      rowKey={(record) =>
        record.oldPosition?.id || record.newPosition?.work_name || Math.random().toString()
      }
      loading={loading}
      pagination={false}
      size="small"
      bordered
      scroll={{ x: 1200 }}
    />
  );
}
