// Привязка Telegram к аккаунту: одноразовая ссылка на бота (15 минут), отвязка.
import { FC, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Spin, Typography, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { createTelegramLink, fetchTelegramStatus, unlinkTelegram, type TelegramStatus } from '../../lib/api/telegram';
import { getErrorMessage } from '../../utils/errors';

const { Text, Paragraph } = Typography;

interface ITelegramLinkModalProps {
  open: boolean;
  onClose: () => void;
}

export const TelegramLinkModal: FC<ITelegramLinkModalProps> = ({ open, onClose }) => {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchTelegramStatus());
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLink(null);
      void load();
    }
  }, [open, load]);

  const handleLink = async () => {
    setBusy(true);
    try {
      const tok = await createTelegramLink();
      setLink(tok.deep_link);
      window.open(tok.deep_link, '_blank', 'noopener');
    } catch (e) {
      message.error('Не удалось получить ссылку: ' + getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    try {
      await unlinkTelegram();
      await load();
      message.success('Telegram отвязан');
    } catch (e) {
      message.error('Не удалось отвязать: ' + getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Telegram" footer={null} onCancel={onClose} destroyOnClose>
      {error && <Alert type="error" showIcon message={error} />}
      {!status && !error && <Spin />}
      {status && !status.enabled && (
        <Alert type="info" showIcon message="Telegram-бот на сервере ещё не настроен" />
      )}
      {status?.enabled && (
        <Space direction="vertical" size={12} className="telegram-link-modal">
          <Paragraph type="secondary" className="telegram-link-text">
            Сюда будут приходить замечания проверки расчёта по строкам, которые вы правили. Отвечать
            «Норма» или «Ошибка, исправлю» можно кнопками прямо в чате.
          </Paragraph>
          {status.linked ? (
            <>
              <Text>
                Привязан{status.telegram_username ? ` @${status.telegram_username}` : ''}
                {status.linked_at ? ` с ${dayjs(status.linked_at).format('DD.MM.YYYY')}` : ''}
              </Text>
              <Space wrap>
                <Button icon={<SendOutlined />} loading={busy} onClick={handleLink}>
                  Привязать другой аккаунт
                </Button>
                <Button danger loading={busy} onClick={handleUnlink}>
                  Отвязать
                </Button>
              </Space>
            </>
          ) : (
            <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={handleLink}>
              Привязать @{status.bot_username}
            </Button>
          )}
          {link && (
            <Alert
              type="success"
              showIcon
              message="Откройте бота и нажмите «Start»"
              description={
                <>
                  Ссылка одноразовая, действует 15 минут. Не открылась —{' '}
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    откройте вручную
                  </a>
                  , затем закройте и снова откройте это окно.
                </>
              }
            />
          )}
        </Space>
      )}
    </Modal>
  );
};
