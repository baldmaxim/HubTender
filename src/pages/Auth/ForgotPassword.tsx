import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../utils/errors';
import { AUTH_MODE } from '../../lib/auth/mode';
import { forgotPassword as appAuthForgot } from '../../lib/auth/client';

const { Title, Text } = Typography;

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [devResetURL, setDevResetURL] = useState<string | null>(null);

  const handleSubmit = async (values: { email: string }) => {
    setLoading(true);

    if (AUTH_MODE === 'app') {
      // Phase 6 app-auth: server ALWAYS responds 200 with anti-enumeration
      // semantics — even unknown emails get the same "email sent" UX.
      // In non-prod environments where SMTP is not configured the response
      // additionally carries reset_url for operator-driven testing.
      try {
        const res = await appAuthForgot(values.email);
        setEmailSent(true);
        if (res.reset_url) setDevResetURL(res.reset_url);
        message.success('Если email зарегистрирован, мы отправили письмо');
      } catch (err) {
        message.error(getErrorMessage(err) || 'Ошибка отправки');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      // Используем VITE_APP_URL для production, window.location.origin для локальной разработки
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;

      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${baseUrl}/reset-password`,
      });

      if (error) throw error;

      setEmailSent(true);
      message.success('Письмо для восстановления пароля отправлено');
    } catch (err) {
      message.error(getErrorMessage(err) || 'Ошибка отправки письма');
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <Card style={{ maxWidth: 400, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <MailOutlined style={{ fontSize: 48, color: '#10b981' }} />
          </div>
          <Title level={3} style={{ textAlign: 'center', marginBottom: 16 }}>
            Письмо отправлено
          </Title>
          <Text>
            Если этот email зарегистрирован, мы отправили инструкции по восстановлению пароля.
            Проверьте почту и перейдите по ссылке.
          </Text>
          {devResetURL && (
            // Dev-only convenience when SMTP is not configured: surface the
            // reset URL inline so the operator can complete the flow without
            // an email round-trip. NEVER shown in production builds.
            <div style={{ marginTop: 16, padding: 12, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, wordBreak: 'break-all' }}>
              <Text type="warning" style={{ fontSize: 12 }}>
                <strong>DEV:</strong> SMTP не настроен. Ссылка для восстановления:
              </Text>
              <div style={{ marginTop: 4 }}>
                <Link to={devResetURL.replace(/^https?:\/\/[^/]+/, '')}>{devResetURL}</Link>
              </div>
            </div>
          )}
          <Link to="/login">
            <Button type="link" block style={{ marginTop: 16 }}>
              <ArrowLeftOutlined /> Вернуться к входу
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Card style={{ maxWidth: 400, width: '100%' }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          Восстановление пароля
        </Title>
        <Form onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Введите email' },
              { type: 'email', message: 'Некорректный email' }
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Email" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Отправить письмо
          </Button>
          <Link to="/login">
            <Button type="link" block style={{ marginTop: 16 }}>
              <ArrowLeftOutlined /> Вернуться к входу
            </Button>
          </Link>
        </Form>
      </Card>
    </div>
  );
}
