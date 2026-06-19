import React from 'react';
import { Alert, Button, Card, Form, InputNumber, Modal, Skeleton, Space, Input } from 'antd';
import type { FormInstance } from 'antd';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';
import type { TimelineTenderListItem } from '../hooks/useTenders';

const { TextArea } = Input;

export type GroupQualityFormValues = {
  groups?: Record<string, { quality_level?: number | null; quality_comment?: string | null }>;
};

interface GroupQualityModalProps {
  open: boolean;
  qualityTender: TimelineTenderListItem | null;
  qualityTenderId: string | null;
  selectedTenderId: string | null;
  groupsLoading: boolean;
  displayedGroups: TimelineGroupItem[];
  form: FormInstance<GroupQualityFormValues>;
  canEditQuality: boolean;
  qualitySaving: boolean;
  isPhone: boolean;
  colorBgContainer: string;
  colorBorderSecondary: string;
  onCancel: () => void;
  onOk: () => void;
}

export const GroupQualityModal: React.FC<GroupQualityModalProps> = ({
  open,
  qualityTender,
  qualityTenderId,
  selectedTenderId,
  groupsLoading,
  displayedGroups,
  form,
  canEditQuality,
  qualitySaving,
  isPhone,
  colorBgContainer,
  colorBorderSecondary,
  onCancel,
  onOk,
}) => {
  return (
    <Modal
      title={qualityTender ? `Уровень расчета · ${qualityTender.title}` : 'Уровень расчета'}
      open={open}
      onCancel={onCancel}
      onOk={canEditQuality ? onOk : onCancel}
      confirmLoading={qualitySaving}
      okText={canEditQuality ? 'Сохранить' : 'Закрыть'}
      cancelText="Отмена"
      width={isPhone ? '100%' : 760}
      style={isPhone ? { top: 0, maxWidth: '100vw', paddingBottom: 0 } : undefined}
      footer={
        canEditQuality
          ? undefined
          : [
              <Button key="close" onClick={onCancel}>
                Закрыть
              </Button>,
            ]
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Шкала уровня расчета"
          description={
            <div>
              <div>1 — расценивали ВОР.</div>
              <div>2 — считали ориентировочно.</div>
              <div>3 — считали качественно, имеются все данные от Заказчика.</div>
            </div>
          }
        />

        {qualityTenderId && qualityTenderId === selectedTenderId && groupsLoading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : (
          <Form form={form} layout="vertical">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {displayedGroups.map((group) => (
                <Card
                  key={group.id}
                  size="small"
                  title={group.name}
                  style={{ background: colorBgContainer, borderColor: colorBorderSecondary }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '180px 1fr', gap: 16 }}>
                    <Form.Item
                      name={['groups', group.id, 'quality_level']}
                      label="Уровень 1–3"
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        decimalSeparator=","
                        min={1}
                        max={3}
                        step={1}
                        precision={0}
                        disabled={!canEditQuality}
                        style={{ width: '100%' }}
                        placeholder="Например, 2"
                      />
                    </Form.Item>
                    <Form.Item
                      name={['groups', group.id, 'quality_comment']}
                      label="Комментарий"
                      style={{ marginBottom: 0 }}
                    >
                      <TextArea
                        rows={2}
                        disabled={!canEditQuality}
                        placeholder="Краткое пояснение по уровню расчета этой команды"
                      />
                    </Form.Item>
                  </div>
                </Card>
              ))}
            </Space>
          </Form>
        )}
      </Space>
    </Modal>
  );
};
