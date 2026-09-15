// Отправка замечаний исполнителям в Telegram: предпросмотр адресатов → отправка.
import { FC, useEffect, useState } from 'react';
import { Alert, List, Modal, Space, Spin, Tag, Typography, message } from 'antd';
import { dispatchFindings, previewDispatch, type DispatchRecipient } from '../../../lib/api/telegram';
import { dispatchResultText, resolverText, willSend } from '../../../lib/quality/dispatchPolicy';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface IDispatchModalProps {
  open: boolean;
  tenderId: string;
  findingIds: string[];
  onClose: () => void;
}

export const DispatchModal: FC<IDispatchModalProps> = ({ open, tenderId, findingIds, onClose }) => {
  const [recipients, setRecipients] = useState<DispatchRecipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRecipients(null);
    setError(null);
    previewDispatch(tenderId, findingIds)
      .then((r) => {
        if (!cancelled) setRecipients(r);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tenderId, findingIds]);

  const count = recipients ? willSend(recipients) : 0;

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await dispatchFindings(tenderId, findingIds);
      message.success(dispatchResultText(res), 6);
      onClose();
    } catch (e) {
      message.error('Не удалось отправить: ' + getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Отправить замечания исполнителям"
      okText={count > 0 ? `Отправить (${count})` : 'Отправить'}
      cancelText="Отмена"
      okButtonProps={{ disabled: count === 0, loading: sending }}
      onOk={handleSend}
      onCancel={onClose}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          Адресат — кто последним правил строку или чаще всех правил позицию. Замечание с теми же данными
          повторно тому же человеку не уходит. Ответить можно кнопками прямо в Telegram.
        </Text>
        {error && <Alert type="error" showIcon message={error} />}
        {!recipients && !error && <Spin />}
        {recipients && (
          <List
            size="small"
            dataSource={recipients}
            renderItem={(r) => (
              <List.Item>
                <Space direction="vertical" size={2}>
                  <Space size={6} wrap>
                    <Text strong>{r.full_name || 'Пользователь удалён'}</Text>
                    <Tag>{r.findings}</Tag>
                    {!r.linked && <Tag color="orange">Telegram не привязан</Tag>}
                    {r.already_sent > 0 && <Tag color="default">уже отправлено: {r.already_sent}</Tag>}
                  </Space>
                  <Text type="secondary">{resolverText(r)}</Text>
                </Space>
              </List.Item>
            )}
          />
        )}
        {recipients && recipients.some((r) => !r.linked) && (
          <Alert
            type="info"
            showIcon
            message="Кто не привязал Telegram, замечаний не получит: привязка — в меню профиля → «Telegram»."
          />
        )}
      </Space>
    </Modal>
  );
};
