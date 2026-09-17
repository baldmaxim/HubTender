import React from 'react';
import { Link } from 'react-router-dom';
import { Table, Button, Space, Tag, Typography, Card, Tooltip } from 'antd';
import { CheckOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { QualityFinding, QualityVerdict } from '../../../lib/api/quality';
import { findingLink } from '../../../lib/quality/findingsPolicy';
import type { AIAssessment } from '../../../lib/api/verificationAI';
import { AIAssessmentTag } from './AIAssessmentTag';

const { Text } = Typography;

interface Props {
  findings: QualityFinding[];
  isPhone: boolean;
  onVerdict: (f: QualityFinding, v: QualityVerdict) => void;
  /** Текущие оценки ИИ по id находки. */
  assessments?: Map<string, AIAssessment>;
}

const money = (v: number | null): string =>
  v === null || v === undefined ? '—' : Math.round(v).toLocaleString('ru-RU') + ' ₽';

const positionLabel = (f: QualityFinding): string => {
  const num = f.position_number === null ? '—' : String(Math.round(f.position_number));
  return f.item_no ? `${num} · ${f.item_no}` : num;
};

/**
 * Номер позиции со ссылкой на её строки, если правило вообще указывает на
 * позицию. Для находок по строке или по номенклатуре маршрута нет — тогда
 * остаётся обычный текст.
 */
const PositionCell: React.FC<{ f: QualityFinding }> = ({ f }) => {
  const to = findingLink(f);
  const label = positionLabel(f);
  if (!to) return <Text strong>{label}</Text>;
  return (
    <Tooltip title="Открыть работы и материалы позиции">
      <Link to={to}>{label}</Link>
    </Tooltip>
  );
};

/** Кнопки вердикта: «норма» гасит находку, «ошибка» помечает к исправлению. */
const VerdictButtons: React.FC<{
  f: QualityFinding;
  onVerdict: Props['onVerdict'];
  block?: boolean;
}> = ({ f, onVerdict, block }) => (
  <Space size={4} wrap>
    <Tooltip title="Легитимный случай — убрать из активных">
      <Button
        size="small"
        block={block}
        icon={<CheckOutlined />}
        type={f.verdict === 'accepted' ? 'primary' : 'default'}
        onClick={() => onVerdict(f, 'accepted')}
      >
        Норма
      </Button>
    </Tooltip>
    <Tooltip title="Подтвердить как ошибку к исправлению">
      <Button
        size="small"
        block={block}
        danger
        icon={<WarningOutlined />}
        type={f.verdict === 'error' ? 'primary' : 'default'}
        onClick={() => onVerdict(f, 'error')}
      >
        Ошибка
      </Button>
    </Tooltip>
  </Space>
);

export const FindingsTable: React.FC<Props> = ({ findings, isPhone, onVerdict, assessments }) => {
  const aiOf = (f: QualityFinding) => (f.finding_id ? assessments?.get(f.finding_id) : undefined);

  if (isPhone) {
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {findings.map((f) => (
          <Card
            key={`${f.rule_code}-${f.entity_id}`}
            size="small"
            styles={{ body: { padding: 12 } }}
          >
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Space size={6} wrap>
                <Tag>
                  <PositionCell f={f} />
                </Tag>
                {f.money_delta !== null && <Tag color="volcano">{money(f.money_delta)}</Tag>}
                {f.is_new && <Tag color="magenta">новое</Tag>}
                {f.verdict === 'accepted' && <Tag color="green">принято</Tag>}
                {f.verdict === 'error' && <Tag color="red">ошибка</Tag>}
              </Space>
              <Text style={{ fontSize: 13 }}>{f.detail}</Text>
              {aiOf(f) && <AIAssessmentTag assessment={aiOf(f)!} />}
              {f.note && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Примечание: {f.note}
                </Text>
              )}
              <VerdictButtons f={f} onVerdict={onVerdict} block />
            </Space>
          </Card>
        ))}
      </Space>
    );
  }

  const columns: ColumnsType<QualityFinding> = [
    {
      title: '№ позиции',
      key: 'position',
      width: 130,
      render: (_, f) => (
        <Space direction="vertical" size={2}>
          <PositionCell f={f} />
          {f.is_new && <Tag color="magenta">новое</Tag>}
        </Space>
      ),
    },
    {
      title: 'Что не так',
      dataIndex: 'detail',
      key: 'detail',
      render: (detail: string, f) => (
        <Space direction="vertical" size={2}>
          <Text>{detail}</Text>
          {aiOf(f) && <AIAssessmentTag assessment={aiOf(f)!} />}
          {f.note && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Примечание: {f.note}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Эффект',
      dataIndex: 'money_delta',
      key: 'money',
      width: 150,
      align: 'right',
      render: (v: number | null) => (v === null ? <Text type="secondary">—</Text> : money(v)),
    },
    {
      title: 'Вердикт',
      key: 'verdict',
      width: 210,
      render: (_, f) => <VerdictButtons f={f} onVerdict={onVerdict} />,
    },
  ];

  return (
    <Table
      rowKey={(f) => `${f.rule_code}-${f.entity_id}`}
      columns={columns}
      dataSource={findings}
      size="small"
      pagination={findings.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
      rowClassName={(f) => (f.verdict === 'accepted' ? 'dq-row-accepted' : '')}
    />
  );
};
