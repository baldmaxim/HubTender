import React, { useMemo } from 'react';
import { Alert, Card, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SectionStage, TenderSection } from '../../../lib/api/verificationSections';
import { pricingStatusLabel, summarizeSections } from '../../../lib/quality/sectionsPolicy';
import { useTenderSections } from '../hooks/useTenderSections';
import { SectionStageCell } from './SectionStageCell';

const { Text } = Typography;

interface Props {
  tenderId: string;
  isPhone: boolean;
}

const money = (v: number): string => `${Math.round(v).toLocaleString('ru-RU')} ₽`;

/**
 * «Расценено» — не отметка, а состояние данных: позиция заполнена, если расценена
 * и указано Кол-во ГП, либо не расценена, но в «Примечании ГП» есть обоснование.
 */
const PricingCell: React.FC<{ s: TenderSection }> = ({ s }) => {
  const { text, color } = pricingStatusLabel(s);
  return <Tag color={color}>{text}</Tag>;
};

/** Что в разделе не заполнено и что нашли правила проверки. */
const SectionStats: React.FC<{ s: TenderSection; showFindings: boolean }> = ({ s, showFindings }) => (
  <Space size={4} wrap>
    {s.unpriced_no_reason > 0 && <Tag color="red">не расценено без обоснования: {s.unpriced_no_reason}</Tag>}
    {s.priced_no_gp > 0 && <Tag color="orange">без Кол-ва ГП: {s.priced_no_gp}</Tag>}
    {showFindings && s.open_errors > 0 && <Tag color="red">ошибок: {s.open_errors}</Tag>}
    {showFindings && s.open_warnings > 0 && <Tag color="gold">предупреждений: {s.open_warnings}</Tag>}
  </Space>
);

/**
 * Готовность по разделам ВОР. «Расценено» считается само по заполненности
 * позиций; «Проверено» отмечает проверяющий. Разделы не блокируют друг друга.
 */
export const SectionsPanel: React.FC<Props> = ({ tenderId, isPhone }) => {
  const { data, loading, error, busyKey, mark, unmark } = useTenderSections(tenderId);
  const sections = useMemo(() => data?.sections ?? [], [data]);
  const summary = useMemo(() => summarizeSections(sections), [sections]);
  const showFindings = !!data?.findings_available;

  const stageCell = (s: TenderSection, stage: SectionStage) => (
    <SectionStageCell
      section={s}
      stage={stage}
      busy={busyKey === `${s.key}|${stage}`}
      onMark={(sec, st) => void mark(sec, st)}
      onUnmark={(sec, st) => void unmark(sec, st)}
    />
  );

  const title = (
    <Space size={8} wrap>
      <span>Готовность по разделам ВОР</span>
      {summary.total > 0 && (
        <>
          <Tag>расценено {summary.priced}/{summary.total}</Tag>
          <Tag>проверено {summary.reviewed}/{summary.total}</Tag>
          {summary.changed > 0 && <Tag color="orange">изменены после отметки: {summary.changed}</Tag>}
        </>
      )}
    </Space>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <Spin><div style={{ minHeight: 60 }} /></Spin>;
  } else if (error) {
    body = <Alert type="warning" showIcon message={error} />;
  } else if (sections.length === 0) {
    body = <Empty description="В тендере нет позиций" />;
  } else if (isPhone) {
    body = (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {sections.map((s) => (
          <Card key={s.key} size="small" styles={{ body: { padding: 12 } }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text strong>{s.title}</Text>
              <SectionStats s={s} showFindings={showFindings} />
              <Space size={12} wrap>
                <Space direction="vertical" size={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Расценено</Text>
                  <PricingCell s={s} />
                </Space>
                <Space direction="vertical" size={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Проверено</Text>
                  {stageCell(s, 'review')}
                </Space>
              </Space>
            </Space>
          </Card>
        ))}
      </Space>
    );
  } else {
    const columns: ColumnsType<TenderSection> = [
      {
        title: 'Раздел',
        key: 'title',
        render: (_, s) => (
          <Space direction="vertical" size={2}>
            <Text strong>{s.title}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{money(s.total_amount)}</Text>
          </Space>
        ),
      },
      {
        title: 'Состояние',
        key: 'stats',
        render: (_, s) => <SectionStats s={s} showFindings={showFindings} />,
      },
      { title: 'Расценено', key: 'pricing', width: 180, render: (_, s) => <PricingCell s={s} /> },
      { title: 'Проверено', key: 'review', width: 200, render: (_, s) => stageCell(s, 'review') },
    ];
    body = (
      <Table
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={sections}
        pagination={sections.length > 30 ? { pageSize: 30, showSizeChanger: false } : false}
      />
    );
  }

  return (
    <Card size="small" title={title}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {!loading && !error && sections.length > 0 && !showFindings && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Счётчики замечаний появятся после сохранённого прогона проверки.
          </Text>
        )}
        {body}
      </Space>
    </Card>
  );
};
