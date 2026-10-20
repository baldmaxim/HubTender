import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceTabsProvider } from './contexts/WorkspaceTabsContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import MainLayout from './components/Layout/MainLayout';
import { WORKSPACE_PAGES } from './components/Layout/workspacePages';
import ErrorFallback from './components/ErrorFallback';
import UpdateBanner from './components/UpdateBanner';
import { Sentry } from './lib/sentry';
// Страницы аутентификации — статически: нужны на первом рендере неавторизованному пользователю.
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import ForgotPassword from './pages/Auth/ForgotPassword';
import ResetPassword from './pages/Auth/ResetPassword';
import AgentConnect from './pages/AgentConnect/AgentConnect';
import PositionItemsRoute from './pages/PositionItems/PositionItemsRoute';
import './App.css';

// Страницы приложения (реестр WORKSPACE_PAGES: lazy-чанки, кроме якорей) рендерит не <Outlet/>,
// а keep-alive контейнер MainLayout (WorkspaceKeepAlive). Поэтому их роуты ниже — с element={null}:
// они нужны только чтобы путь сматчился и MainLayout отрисовался (без element react-router
// ругается в консоль «leaf route does not have an element» на каждой навигации).

function AppContent() {
  const { theme: currentTheme } = useTheme();

  return (
    <ConfigProvider
      theme={{
        algorithm: currentTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#10b981',
          colorSuccess: '#159957',
          colorInfo: '#0891b2',
        },
      }}
    >
      <AntApp>
        {/* Вне Routes: обновление фронтенда не связано с сессией и должно
            предлагаться в том числе на /login */}
        <UpdateBanner />
        <Routes>
          {/* Публичные маршруты */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/agent-connect" element={<AgentConnect />} />

          {/* Защищенные маршруты */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <WorkspaceTabsProvider>
                  <MainLayout />
                </WorkspaceTabsProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            {WORKSPACE_PAGES.map((page) => (
              <Route key={page.pattern} path={page.pattern} element={null} />
            ))}
            <Route path="positions/:positionId/items" element={<PositionItemsRoute />} />
            <Route path="pricing-drafts" element={<Navigate to="/positions" replace />} />
            <Route path="commerce" element={<Navigate to="/commerce/proposal" replace />} />
            <Route path="admin" element={<Navigate to="/admin/nomenclatures" replace />} />
            <Route path="settings" element={<Navigate to="/settings/agents" replace />} />
          </Route>

          {/* Перенаправление на главную для неизвестных маршрутов */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AntApp>
    </ConfigProvider>
  );
}

function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => <ErrorFallback error={error} resetError={resetError} />}
    >
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App
