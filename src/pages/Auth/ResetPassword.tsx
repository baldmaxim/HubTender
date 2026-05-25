import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Result, Typography, message } from 'antd';
import { LockOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { resetPassword as appAuthReset } from '../../lib/auth/client';
import type { AppAuthError } from '../../lib/auth/types';

const { Title, Text } = Typography;

// Reset-password flow. Reads `?token=...` from the URL (the link the BFF
// mailed to the user), POSTs to /api/v1/auth/reset-password with the new
// password. On success — redirect to /login.
export default function ResetPassword() {
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) {
      message.error('В ссылке отсутствует токен. Запросите восстановление пароля заново.');
      navigate('/forgot-password');
      return;
    }
    setToken(t);
  }, [navigate]);

  const handleSubmit = async (values: { password: string }) => {
    if (!token) return;
    setLoading(true);
    try {
      await appAuthReset(token, values.password);
      setDone(true);
      message.success('Пароль изменён. Войдите с новым паролем.');
      setTimeout(() => navigate('/login'), 800);
    } catch (err) {
      const e = err as AppAuthError;
      if (e.status === 401) {
        message.error('Ссылка недействительна, использована или просрочена. Запросите восстановление заново.');
      } else if (e.status === 400) {
        message.error(e.message || 'Проверьте корректность пароля');
      } else if (e.code === 'network') {
        message.error('Сервис недоступен. Проверьте соединение');
      } else {
        message.error('Не удалось изменить пароль');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null;
  if (done) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <Card style={{ maxWidth: 400, width: '100%' }}>
          <Result status="success" title="Пароль изменён" subTitle={<Text type="secondary">Перенаправляем на страницу входа…</Text>} />
        </Card>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Card style={{ maxWidth: 400, width: '100%' }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          Новый пароль
        </Title>
        <Form onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Введите пароль' },
              { min: 6, message: 'Минимум 6 символов' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Новый пароль" size="large" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Подтвердите пароль' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('Пароли не совпадают'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Подтвердите пароль" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Сменить пароль
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
