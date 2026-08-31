import { FC, useState } from 'react';
import {
  Alert, Button, Checkbox, DatePicker, Form, Input, Modal, Space, Typography,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import type { ApiKeyScope, CreateApiKeyInput, IssuedApiKey } from '../../../lib/api/apiAccess';

const { Paragraph, Text } = Typography;

interface IIssueKeyModalProps {
  open: boolean;
  issuing: boolean;
  /** Заполнено сразу после выпуска: экран показа секрета. */
  issued: IssuedApiKey | null;
  onSubmit: (input: CreateApiKeyInput) => void;
  onClose: () => void;
}

interface IFormValues {
  name: string;
  scopes: ApiKeyScope[];
  allowedTenderIds?: string;
  expiresAt?: Dayjs | null;
}

export const IssueKeyModal: FC<IIssueKeyModalProps> = ({
  open, issuing, issued, onSubmit, onClose,
}) => {
  const [form] = Form.useForm<IFormValues>();
  const [copied, setCopied] = useState(false);

  const handleFinish = (values: IFormValues) => {
    const tenderIds = (values.allowedTenderIds ?? '')
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    onSubmit({
      name: values.name.trim(),
      scopes: values.scopes,
      allowed_tender_ids: tenderIds,
      expires_at: values.expiresAt ? values.expiresAt.toISOString() : null,
    });
  };

  const handleCopy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.secret);
    setCopied(true);
  };

  const handleClose = () => {
    form.resetFields();
    setCopied(false);
    onClose();
  };

  if (issued) {
    return (
      <Modal
        open={open}
        title="Ключ выпущен"
        onCancel={handleClose}
        maskClosable={false}
        footer={[
          <Button key="close" type="primary" onClick={handleClose}>
            Я сохранил ключ
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Секрет показывается один раз"
          description="В базе хранится только его хеш. Закроете окно — восстановить ключ будет нельзя, останется лишь выпустить новый."
        />
        <Paragraph copyable={false}>
          <Input.TextArea
            value={issued.secret}
            readOnly
            autoSize
            style={{ fontFamily: 'monospace' }}
          />
        </Paragraph>
        <Space>
          <Button icon={<CopyOutlined />} onClick={handleCopy}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
          <Text type="secondary">Ключ «{issued.key.name}»</Text>
        </Space>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Выпустить ключ доступа"
      okText="Выпустить"
      cancelText="Отмена"
      confirmLoading={issuing}
      onOk={() => form.submit()}
      onCancel={handleClose}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{ scopes: ['archive:read'] as ApiKeyScope[] }}
      >
        <Form.Item
          name="name"
          label="Название"
          rules={[{ required: true, message: 'Укажите, кому и зачем выдан ключ' }]}
        >
          <Input placeholder="Например: интеграция с 1С" maxLength={120} />
        </Form.Item>

        <Form.Item
          name="scopes"
          label="Права"
          rules={[{ required: true, message: 'Выберите хотя бы одно право' }]}
          extra="Чтение тендеров и смет — список тендеров, позиции, итоги и строки смет (только просмотр). Сборка смет и запись строк означают запись в тендер: строки создаются от имени владельца ключа."
        >
          <Checkbox.Group
            options={[
              { label: 'Чтение архива смет', value: 'archive:read' },
              { label: 'Сборка смет (запись)', value: 'archive:write' },
              { label: 'Чтение тендеров и смет', value: 'tenders:read' },
              { label: 'Запись строк тендера', value: 'tenders:write' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="allowedTenderIds"
          label="Разрешённые тендеры"
          extra="ID через запятую или с новой строки. Пусто — доступны все тендеры."
        >
          <Input.TextArea rows={2} placeholder="необязательно" />
        </Form.Item>

        <Form.Item name="expiresAt" label="Действует до" extra="Пусто — бессрочно.">
          <DatePicker showTime style={{ width: '100%' }} placeholder="необязательно" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
