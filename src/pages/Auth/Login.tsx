import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Typography, Spin, Result } from 'antd';
import { UserOutlined, LockOutlined, LoginOutlined, LoadingOutlined, ClockCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { HeaderIcon } from '../../components/Icons/HeaderIcon';

const { Title, Text } = Typography;

interface LoginFormValues {
  email: string;
  password: string;
}

const Login: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // Автоматический редирект если пользователь уже авторизован
  useEffect(() => {
    if (!user) return;

    setLoading(false);

    // pending/blocked — показываем соответствующий экран ниже
    if (user.access_status === 'pending' || user.access_status === 'blocked') {
      return;
    }

    if (user.access_status === 'approved' && user.access_enabled) {
      const targetPath = user.allowed_pages.length === 0 ? '/dashboard' : user.allowed_pages[0];
      navigate(targetPath, { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (values: LoginFormValues) => {
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          message.error('Неверный email или пароль');
        } else if (authError.message.includes('Email not confirmed')) {
          message.error('Email не подтверждён');
        } else {
          message.error(`Ошибка входа: ${authError.message}`);
        }
        setLoading(false);
        return;
      }

      // Успех: AuthContext получит SIGNED_IN и установит user,
      // useEffect выше сделает редирект и сбросит loading.
    } catch (error) {
      console.error('Ошибка при входе:', error);
      message.error('Произошла ошибка при входе');
      setLoading(false);
    }
  };

  // Показываем загрузку пока AuthContext инициализируется
  if (authLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: '#fff' }} spin />} />
        <Text style={{ marginTop: 24, fontSize: 18, color: '#fff' }}>Загрузка...</Text>
      </div>
    );
  }

  // Показываем сообщение если пользователь зарегистрирован но заявка на рассмотрении
  if (user && user.access_status === 'pending') {
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
          <Result
            icon={<ClockCircleOutlined style={{ color: '#faad14' }} />}
            title="Ваша заявка находится на рассмотрении Администратором"
            subTitle={
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  Пользователь: <strong>{user.full_name}</strong>
                </Text>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Email: <strong>{user.email}</strong>
                </Text>
                <Text type="secondary">
                  После одобрения заявки администратором вы получите доступ к системе.
                  Вы можете закрыть эту страницу и вернуться позже.
                </Text>
              </div>
            }
            extra={[
              <Button
                key="logout"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.reload();
                }}
              >
                Выйти
              </Button>,
              <Button
                key="refresh"
                type="primary"
                onClick={() => window.location.reload()}
              >
                Обновить страницу
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  // Показываем сообщение если доступ закрыт администратором
  if (user && user.access_status === 'approved' && !user.access_enabled) {
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
          <Result
            status="warning"
            title="Доступ к системе закрыт"
            subTitle={
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  Пользователь: <strong>{user.full_name}</strong>
                </Text>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Email: <strong>{user.email}</strong>
                </Text>
                <Text type="secondary">
                  Администратор временно закрыл ваш доступ к системе.
                  Для получения дополнительной информации обратитесь к администратору.
                </Text>
              </div>
            }
            extra={[
              <Button
                key="logout"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.reload();
                }}
              >
                Выйти
              </Button>,
              <Button
                key="refresh"
                type="primary"
                onClick={() => window.location.reload()}
              >
                Обновить страницу
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  // Показываем сообщение если заявка отклонена
  if (user && user.access_status === 'blocked') {
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
          <Result
            status="error"
            icon={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            title="Заявка на регистрацию отклонена"
            subTitle={
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  К сожалению, администратор отклонил вашу заявку на регистрацию.
                  Вы можете направить заявку повторно или обратиться к администратору для получения дополнительной информации.
                </Text>
              </div>
            }
            extra={[
              <Button
                key="logout"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.reload();
                }}
              >
                Вернуться к входу
              </Button>,
              <Button
                key="register"
                type="primary"
                onClick={async () => {
                  // Обновляем статус на pending для повторной заявки
                  const { error } = await supabase
                    .from('users')
                    .update({ access_status: 'pending' })
                    .eq('id', user.id);

                  if (error) {
                    message.error('Ошибка при отправке заявки');
                  } else {
                    message.success('Заявка на регистрацию отправлена повторно');
                    window.location.reload();
                  }
                }}
              >
                Отправить заявку повторно
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  // Полноэкранный индикатор загрузки при входе
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: '#fff' }} spin />} />
        <Text style={{ marginTop: 24, fontSize: 18, color: '#fff' }}>Вход в систему...</Text>
      </div>
    );
  }

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
          maxWidth: 450,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
          borderRadius: 8,
        }}
      >
        {/* Логотип и заголовок */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ marginBottom: 16 }}>
            <HeaderIcon size={64} color="#10b981" />
          </div>
          <Title level={3} style={{ marginBottom: 8, color: '#10b981' }}>
            TenderHUB
          </Title>
          <Text type="secondary">Портал управления тендерами</Text>
        </div>

        {/* Форма входа */}
        <Form
          form={form}
          name="login"
          onFinish={handleLogin}
          layout="vertical"
          requiredMark={false}
          autoComplete="off"
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Введите email' },
              { type: 'email', message: 'Введите корректный email' },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="example@su10.ru"
              size="large"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Введите пароль"
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<LoginOutlined />}
              loading={loading}
              block
              size="large"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
              }}
            >
              Войти
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Link to="/forgot-password" style={{ color: '#10b981' }}>
              Забыли пароль?
            </Link>
          </div>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary">
              Нет аккаунта?{' '}
              <Link to="/register" style={{ color: '#10b981' }}>
                Зарегистрироваться
              </Link>
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default Login;
