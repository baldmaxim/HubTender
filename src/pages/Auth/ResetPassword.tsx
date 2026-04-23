import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const { Title } = Typography;

export default function ResetPassword() {
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const initResetPassword = async () => {
      try {
        // Проверяем наличие recovery token в URL
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const token = hashParams.get('access_token');
        const tokenType = hashParams.get('type');

        console.log('🔐 Reset Password Init', { hasToken: !!token, tokenType });

        if (!token || tokenType !== 'recovery') {
          message.error('Недействительная ссылка восстановления');
          navigate('/login');
          return;
        }

        // НЕ выходим из сессии - даем Supabase обработать recovery token автоматически
        // Supabase увидит #access_token и type=recovery в URL и создаст recovery сессию

        // Ждем пока Supabase обработает recovery token из URL
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Проверяем что recovery сессия создана
        const { data: { session } } = await supabase.auth.getSession();

        console.log('📋 Session after recovery token processing:', {
          hasSession: !!session,
          userId: session?.user?.id,
        });

        if (!session) {
          message.error('Не удалось установить recovery сессию');
          navigate('/login');
          return;
        }

        setValidSession(true);
        console.log('✅ Ready for password reset');
      } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        message.error('Ошибка загрузки');
        navigate('/login');
      }
    };

    initResetPassword();

    // Подписка на событие USER_UPDATED для отслеживания успешной смены пароля
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED') {
        console.log('✅ USER_UPDATED event received - password changed');
        setPasswordUpdated(true);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [navigate]);

  // Редирект после успешной смены пароля
  useEffect(() => {
    if (passwordUpdated) {
      console.log('🎉 Password updated, redirecting...');
      message.success('Пароль успешно изменен');

      // Выходим из recovery сессии
      supabase.auth.signOut().then(() => {
        console.log('🚪 Signed out from recovery session');
      }).catch((err) => {
        console.warn('⚠️ SignOut error (ignored):', err);
      });

      setLoading(false);

      // Редирект через 500ms
      setTimeout(() => {
        navigate('/login');
      }, 500);
    }
  }, [passwordUpdated, navigate]);

  const handleSubmit = async (values: { password: string }) => {
    try {
      setLoading(true);

      console.log('🔄 Updating password...');

      // Проверяем текущую сессию перед обновлением
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      console.log('📋 Current session before update:', {
        hasSession: !!currentSession,
        userId: currentSession?.user?.id,
      });

      // Вызываем updateUser БЕЗ await - результат обработаем через событие USER_UPDATED
      supabase.auth.updateUser({
        password: values.password,
      }).then(({ error }) => {
        if (error) {
          console.error('❌ Update password error:', error);
          message.error(error.message || 'Ошибка смены пароля');
          setLoading(false);
        }
      });

      // Не ждем результата - обработаем через событие USER_UPDATED
    } catch (err: any) {
      console.error('❌ Submit error:', err);
      message.error(err.message || 'Ошибка смены пароля');
      setLoading(false);
    }
  };

  if (!validSession) {
    return null;
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
              { min: 6, message: 'Минимум 6 символов' }
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
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
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
        </Form>
      </Card>
    </div>
  );
}
