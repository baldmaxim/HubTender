import React from 'react';
import { Button, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { SectionStage, TenderSection } from '../../../lib/api/verificationSections';
import { changedDescription, pricingBlockers } from '../../../lib/quality/sectionsPolicy';

const { Text } = Typography;

interface Props {
  section: TenderSection;
  stage: SectionStage;
  busy: boolean;
  onMark: (s: TenderSection, stage: SectionStage) => void;
  onUnmark: (s: TenderSection, stage: SectionStage) => void;
}

const STAGE_LABEL: Record<SectionStage, { action: string; confirm: string }> = {
  review: { action: 'Проверено', confirm: 'Отметить раздел проверенным?' },
};

/**
 * Отметка одного этапа по разделу. Отметка заверяет текущее содержимое раздела:
 * если раздел потом правят, она становится «изменён после отметки», а не
 * исчезает — видно, кто и когда отмечал и что поменялось.
 */
export const SectionStageCell: React.FC<Props> = ({ section, stage, busy, onMark, onUnmark }) => {
  const st = section[stage];
  const label = STAGE_LABEL[stage];
  const when = st.marked_at ? dayjs(st.marked_at).format('DD.MM.YY HH:mm') : '';
  const who = st.marked_by_name ?? 'неизвестно';

  const blockers = pricingBlockers(section);
  const confirmText = blockers.length > 0
    ? `В разделе: ${blockers.join(', ')}. Всё равно отметить?`
    : 'Отметка зафиксирует текущее содержимое раздела.';

  const markButton = (text: string) => (
    <Popconfirm
      title={label.confirm}
      description={confirmText}
      okText="Отметить"
      cancelText="Отмена"
      onConfirm={() => onMark(section, stage)}
    >
      <Button size="small" loading={busy} disabled={section.pricing_status === 'not_required'}>
        {text}
      </Button>
    </Popconfirm>
  );

  if (st.status === 'none') return markButton(label.action);

  const unmark = (
    <Popconfirm
      title="Снять отметку?"
      okText="Снять"
      cancelText="Отмена"
      onConfirm={() => onUnmark(section, stage)}
    >
      <Button size="small" type="link" disabled={busy} style={{ padding: 0 }}>
        снять
      </Button>
    </Popconfirm>
  );

  if (st.status === 'marked') {
    return (
      <Space direction="vertical" size={0}>
        <Tooltip title={st.note ?? undefined}>
          <Tag color="green" icon={<CheckCircleOutlined />}>{who}</Tag>
        </Tooltip>
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>{when}</Text>
          {unmark}
        </Space>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={2}>
      <Tooltip title={`${changedDescription(st)}. Отмечал: ${who}, ${when}`}>
        <Tag color="orange" icon={<ExclamationCircleOutlined />}>изменён после отметки</Tag>
      </Tooltip>
      <Space size={6}>
        {markButton('Отметить заново')}
        {unmark}
      </Space>
    </Space>
  );
};
