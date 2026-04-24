import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (values: { email: string }) => {
    try {
      setLoading(true);

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
          <Text>Проверьте почту и перейдите по ссылке для восстановления пароля</Text>
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
