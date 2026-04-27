import React, { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Avatar,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Skeleton,
  Tabs,
  Typography,
  theme,
} from 'antd';
import { respondTenderIteration, createTenderIteration } from '../../../lib/api/timeline';
import type { ApprovalStatus, TenderIterationWithRelations } from '../../../lib/supabase/types';
import { useTenderIterations } from '../hooks/useTenderIterations';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';
import IterationCard from './IterationCard';
import { getInitials, getRoleAvatarColor } from '../utils/timeline.utils';

const { Text } = Typography;
const { TextArea } = Input;

type DataFormValues = {
  user_comment: string;
  user_amount?: number | null;
};

type ResponseFormValues = {
  manager_comment: string;
  approval_status: ApprovalStatus;
};

interface UserTimelineProps {
  group: TimelineGroupItem | null;
  selectedUserId: string | null;
  onUserSelect: (id: string) => void;
  currentUserId: string | null;
  currentUserRoleCode: string | null;
  canRespond: boolean;
  onDataChanged?: () => Promise<void> | void;
}

function getRecordsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 'запись';
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'записи';
  }

  return 'записей';
}

const UserTimeline: React.FC<UserTimelineProps> = ({
  group,
  selectedUserId,
  onUserSelect,
  currentUserId,
  currentUserRoleCode,
  canRespond,
  onDataChanged,
}) => {
  const {
    token: { colorFillAlter, colorPrimaryBg },
  } = theme.useToken();
  const { message } = App.useApp();
  const [dataForm] = Form.useForm<DataFormValues>();
  const [responseForm] = Form.useForm<ResponseFormValues>();
  const { iterations, loading, error, refetch } = useTenderIterations(group?.id || null, selectedUserId);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [savingResponse, setSavingResponse] = useState(false);
  const [respondingIteration, setRespondingIteration] = useState<TenderIterationWithRelations | null>(null);

  const selectedMember = useMemo(
    () => group?.members.find((member) => member.user_id === selectedUserId) || null,
    [group, selectedUserId]
  );
  const visibleMembers = useMemo(() => {
    if (!group) {
      return [];
    }

    if (currentUserRoleCode === 'engineer' && currentUserId) {
      return group.members.filter((member) => member.user_id === currentUserId);
    }

    return group.members;
  }, [currentUserId, currentUserRoleCode, group]);
  const latestIteration = iterations[iterations.length - 1] || null;
  const canCreateData = Boolean(
    group &&
      selectedUserId &&
      currentUserId &&
      selectedUserId === currentUserId &&
      visibleMembers.some((member) => member.user_id === currentUserId) &&
      latestIteration?.approval_status !== 'pending'
  );

  if (!group) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="Выберите группу и участника для просмотра хронологии" />
      </div>
    );
  }

  const tabItems = visibleMembers.map((member) => ({
    key: member.user_id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar size="small" style={{ backgroundColor: getRoleAvatarColor(member.user?.role_code || '') }}>
          {getInitials(member.user?.full_name || '')}
        </Avatar>
        <Text>{member.user?.full_name || 'Пользователь'}</Text>
      </div>
    ),
  }));

  const handleCreateData = async (values: DataFormValues) => {
    if (!group || !selectedUserId || !currentUserId || selectedUserId !== currentUserId) {
      return;
    }

    setSavingData(true);
    try {
      const nextIterationNumber =
        iterations.reduce((maxValue, iteration) => Math.max(maxValue, iteration.iteration_number), 0) + 1;

      await createTenderIteration({
        group_id: group.id,
        user_id: currentUserId,
        iteration_number: nextIterationNumber,
        user_comment: values.user_comment.trim(),
        user_amount: values.user_amount ?? null,
      });

      message.success('Данные добавлены');
      setCreateModalOpen(false);
      dataForm.resetFields();
      await refetch();
      await onDataChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось добавить данные');
    } finally {
      setSavingData(false);
    }
  };

  const openResponseModal = (iteration: TenderIterationWithRelations) => {
    setRespondingIteration(iteration);
    responseForm.setFieldsValue({
      manager_comment: iteration.manager_comment || '',
      approval_status: iteration.approval_status,
    });
    setResponseModalOpen(true);
  };

  const handleRespond = async (values: ResponseFormValues) => {
    if (!respondingIteration) {
      return;
    }

    setSavingResponse(true);
    try {
      await respondTenderIteration(
        respondingIteration.id,
        values.manager_comment.trim(),
        values.approval_status as 'pending' | 'approved' | 'rejected',
      );

      message.success('Решение сохранено');
      setResponseModalOpen(false);
      setRespondingIteration(null);
      await refetch();
      await onDataChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось сохранить решение');
    } finally {
      setSavingResponse(false);
    }
  };

  return (
    <>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: colorFillAlter,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <Text strong style={{ display: 'block' }}>
                {group.name}
              </Text>
              <Text type="secondary">
                {selectedMember?.user?.full_name || 'Выберите участника'} · {visibleMembers.length} участн. ·{' '}
                {group.iterationsCount} данных
              </Text>
            </div>
            {canCreateData ? (
              <Button type="primary" onClick={() => setCreateModalOpen(true)}>
                Новые данные
              </Button>
            ) : null}
          </div>
          {!canCreateData && selectedUserId === currentUserId && latestIteration?.approval_status === 'pending' ? (
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              Новые данные станут доступны после решения руководителя по текущей записи.
            </Text>
          ) : null}
        </div>

        {visibleMembers.length > 1 ? (
          <Tabs activeKey={selectedUserId || undefined} onChange={onUserSelect} items={tabItems} />
        ) : null}

        {error ? (
          <Alert type="error" showIcon message="Не удалось загрузить хронологию" description={error} />
        ) : loading ? (
          <div style={{ paddingTop: 8 }}>
            {[0, 1].map((item) => (
              <div key={item} style={{ marginBottom: 16 }}>
                <Skeleton active avatar paragraph={{ rows: 5 }} />
              </div>
            ))}
          </div>
        ) : iterations.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 260,
              background: colorPrimaryBg,
              borderRadius: 12,
            }}
          >
            <Empty description="По выбранному участнику данных пока нет" />
          </div>
        ) : (
          <>
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: colorFillAlter,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">Хронология по данным</Text>
              </div>
              <Text type="secondary">
                {iterations.length} {getRecordsLabel(iterations.length)}
              </Text>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {iterations.map((iteration) => (
                <IterationCard
                  key={iteration.id}
                  iteration={iteration}
                  canRespond={canRespond}
                  onRespond={openResponseModal}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Modal
        title="Новые данные"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => dataForm.submit()}
        confirmLoading={savingData}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={dataForm} layout="vertical" onFinish={handleCreateData}>
          <Form.Item
            name="user_comment"
            label="Комментарий к расчёту"
            rules={[{ required: true, message: 'Опишите расчёт или пояснение' }]}
          >
            <TextArea rows={5} placeholder="Что изменилось в расчёте" />
          </Form.Item>
          <Form.Item name="user_amount" label="Итоговая сумма, ₽">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="Например, 12500000" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Решение руководителя"
        open={responseModalOpen}
        onCancel={() => {
          setResponseModalOpen(false);
          setRespondingIteration(null);
        }}
        onOk={() => responseForm.submit()}
        confirmLoading={savingResponse}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={responseForm} layout="vertical" onFinish={handleRespond}>
          <Form.Item
            name="approval_status"
            label="Решение"
            rules={[{ required: true, message: 'Выберите решение' }]}
          >
            <Segmented
              block
              options={[
                { label: 'На проверке', value: 'pending' },
                { label: 'Согласовано', value: 'approved' },
                { label: 'Отказано', value: 'rejected' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="manager_comment"
            label="Комментарий руководителя"
            rules={[{ required: true, message: 'Добавьте комментарий' }]}
          >
            <TextArea rows={4} placeholder="Результат проверки и замечания" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default UserTimeline;
