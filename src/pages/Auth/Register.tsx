import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { HeaderIcon } from '../../components/Icons/HeaderIcon';
import { registerWithPassword as appAuthRegister } from '../../lib/auth/client';
import type { AppAuthError } from '../../lib/auth/types';

const { Title, Text } = Typography;

interface RegisterFormValues {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
}

const Register: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (values: RegisterFormValues) => {
    setLoading(true);

    // One POST /api/v1/auth/register creates auth.users + public.users +
    // admin notification in a single transaction. No session is issued —
    // fresh users land in access_status=pending and must wait for admin
    // approval.
    try {
      await appAuthRegister({
        email: values.email,
        password: values.password,
        full_name: values.full_name,
      });
      message.success(
        'Запрос на регистрацию отправлен! После одобрения администратором вы сможете войти в систему.',
        5,
      );
      navigate('/login');
    } catch (err) {
      const e = err as AppAuthError;
      if (e.status === 409) {
        message.error('Пользователь с таким email уже зарегистрирован');
      } else if (e.status === 400) {
        message.error(e.message || 'Проверьте корректность данных');
      } else if (e.code === 'network') {
        message.error('Сервис недоступен. Проверьте соединение');
      } else {
        message.error(`Ошибка регистрации: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 24,
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 500,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          borderRadius: 8,
        }}
      >
        {/* Логотип и заголовок */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: 32,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <HeaderIcon size={64} color="#10b981" />
          </div>
          <Title level={3} style={{ marginBottom: 8, color: '#10b981' }}>
            Регистрация
          </Title>
          <Text type="secondary">Создание аккаунта в TenderHUB</Text>
        </div>

        {/* Форма регистрации */}
        <Form
          form={form}
          name="register"
          onFinish={handleRegister}
          layout="vertical"
          requiredMark={false}
          autoComplete="off"
        >
          <Form.Item
            name="full_name"
            label="ФИО"
            rules={[
              { required: true, message: 'Введите ФИО' },
              { min: 3, message: 'ФИО должно содержать минимум 3 символа' },
              {
                pattern: /^[а-яА-ЯёЁ\s-]+$/,
                message: 'ФИО должно содержать только русские буквы',
              },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="Иванов Иван Иванович"
              size="large"
              autoComplete="name"
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Введите email' },
              { type: 'email', message: 'Введите корректный email' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="example@su10.ru"
              size="large"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Пароль"
            rules={[
              { required: true, message: 'Введите пароль' },
              { min: 6, message: 'Пароль должен содержать минимум 6 символов' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Минимум 6 символов"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="Подтверждение пароля"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Подтвердите пароль' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Пароли не совпадают'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Повторите пароль"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
              }}
            >
              Зарегистрироваться
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary">
              Уже есть аккаунт?{' '}
              <Link to="/login" style={{ color: '#10b981' }}>
                Войти
              </Link>
            </Text>
          </div>
        </Form>

        {/* Информационное сообщение */}
        <div
          style={{
            marginTop: 24,
            padding: 12,
            background: '#1a1a1a',
            borderRadius: 4,
            border: '1px solid #333',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, color: '#999' }}>
            После регистрации ваш запрос будет отправлен администраторам для одобрения.
            Вы сможете войти в систему после одобрения вашей заявки.
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default Register;
