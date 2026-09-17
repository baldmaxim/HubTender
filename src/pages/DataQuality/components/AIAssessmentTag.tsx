// Оценка ИИ под текстом находки: метка, причина и факты, на которые она опирается.
import { FC } from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import type { AIAssessment } from '../../../lib/api/verificationAI';
import { evidenceLabel, labelDisplay } from '../../../lib/quality/aiTriagePolicy';

const { Text } = Typography;

export const AIAssessmentTag: FC<{ assessment: AIAssessment }> = ({ assessment }) => {
  const { text, color } = labelDisplay(assessment.label);
  const facts = assessment.evidence.map((e) => `${evidenceLabel(e.ref)}: ${e.value}`);
  return (
    <Space direction="vertical" size={0}>
      <Tooltip title={facts.length ? facts.join('\n') : 'Модель не привела подтверждённых фактов'} overlayStyle={{ whiteSpace: 'pre-line' }}>
        <Tag color={color} icon={<RobotOutlined />}>
          {text}
        </Tag>
      </Tooltip>
      {assessment.reason && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {assessment.reason}
        </Text>
      )}
    </Space>
  );
};
