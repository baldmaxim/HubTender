import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { registerUser as apiRegisterUser } from '../../lib/api/users';
import { HeaderIcon } from '../../components/Icons/HeaderIcon';

const { Title, Text } = Typography;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEFAULT_ROLE_PAGES = [];

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

    try {
      // 1. Создаем пользователя в auth.users через Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
      });

      if (authError) {
        console.error('Ошибка регистрации:', authError);

        if (authError.message.includes('already registered')) {
          message.error('Пользователь с таким email уже зарегистрирован');
        } else {
          message.error(`Ошибка регистрации: ${authError.message}`);
        }
        return;
      }

      if (!authData.user) {
        message.error('Не удалось создать пользователя');
        return;
      }

      // 2. Получаем allowed_pages для роли инженера
      const { data: engineerRole } = await supabase
        .from('roles')
        .select('allowed_pages')
        .eq('code', 'engineer')
        .single();

      // 3. Создаем запись в public.users со статусом pending через helper,
      // который при VITE_API_USERS_ENABLED=true идёт на Go BFF (user_id и
      // email в этом случае приходят из JWT — клиент не подменит их).
      try {
        await apiRegisterUser({
          user_id: authData.user.id,
          full_name: values.full_name,
          email: values.email,
          role_code: 'engineer',
          allowed_pages: engineerRole?.allowed_pages || [],
        });
      } catch (userInsertError) {
        const err = userInsertError as { message?: string };
        console.error('Ошибка создания записи пользователя:', userInsertError);

        // Выходим из созданной сессии (auth.users останется, но пользователь не сможет войти без public.users)
        await supabase.auth.signOut();

        message.error(`Ошибка при создании профиля: ${err.message ?? 'unknown'}`);
        return;
      }

      // 3. Получаем всех администраторов, руководителей и разработчиков для отправки уведомлений
      const { data: admins } = await supabase
        .from('users')
        .select('id')
        .in('role', ['Администратор', 'Руководитель', 'Разработчик'])
        .eq('access_status', 'approved');

      // 4. Создаем уведомления для администраторов, руководителей и разработчиков
      const userId = authData.user?.id;
      if (admins && admins.length > 0 && userId && authData.user) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: 'pending' as const,
          title: 'Новый запрос на регистрацию',
          message: `${values.full_name} (${values.email}) запросил доступ к системе`,
          related_entity_type: 'registration_request',
          related_entity_id: userId,
          is_read: false,
        }));

        const { error: notificationError } = await supabase
          .from('notifications')
          .insert(notifications);

        if (notificationError) {
          console.error('Ошибка создания уведомлений:', notificationError);
          // Не прерываем процесс регистрации, если не удалось создать уведомления
        }
      }

      // 5. Выходим из системы (пользователь должен дождаться одобрения)
      await supabase.auth.signOut();

      // 6. Показываем успешное сообщение и перенаправляем на страницу входа
      message.success(
        'Запрос на регистрацию отправлен! После одобрения администратором вы сможете войти в систему.',
        5
      );

      navigate('/login');
    } catch (error) {
      console.error('Неожиданная ошибка при регистрации:', error);
      message.error('Произошла неожиданная ошибка при регистрации');
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
