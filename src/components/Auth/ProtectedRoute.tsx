import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { hasPageAccess } from '../../lib/types/types';

const { Text } = Typography;

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Показываем индикатор загрузки пока проверяем сессию
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
        <Spin
          indicator={<LoadingOutlined style={{ fontSize: 48, color: '#fff' }} spin />}
        />
        <Text style={{ marginTop: 24, fontSize: 18, color: '#fff' }}>
          Загрузка...
        </Text>
      </div>
    );
  }

  // Если пользователь не авторизован - перенаправляем на логин
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Проверяем, одобрен ли пользователь
  if (user.access_status !== 'approved') {
    return <Navigate to="/login" replace />;
  }

  // Проверяем, включен ли доступ
  if (!user.access_enabled) {
    return <Navigate to="/login" replace />;
  }

  // Проверяем доступ к текущей странице
  if (!hasPageAccess(user, location.pathname)) {
    // Перенаправляем на первую доступную страницу или dashboard
    const redirectPath = user.allowed_pages.length > 0
      ? user.allowed_pages[0]
      : '/dashboard';
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
