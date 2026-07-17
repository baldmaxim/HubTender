import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceTabsProvider } from './contexts/WorkspaceTabsContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import MainLayout from './components/Layout/MainLayout';
import ErrorFallback from './components/ErrorFallback';
import { Sentry } from './lib/sentry';
// Страницы аутентификации — статически: нужны на первом рендере неавторизованному пользователю.
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import ForgotPassword from './pages/Auth/ForgotPassword';
import ResetPassword from './pages/Auth/ResetPassword';
// Keep-alive страницы «рабочего стола» — статически: их уже статически импортирует
// MainLayout (workspacePages/WorkspaceKeepAlive), dynamic import их из бандла не вынесет.
import ClientPositions from './pages/ClientPositions/ClientPositions';
import PositionItemsRoute from './pages/PositionItems/PositionItemsRoute';
import Commerce from './pages/Commerce';
import ConstructionCostNew from './pages/Admin/ConstructionCostNew';
import './App.css';

// Остальные страницы — lazy-чанки: клик по меню перестаёт синхронно монтировать
// страницу из монолитного бандла (INP), чанк догружается в startTransition-навигации
// react-router v7 (старый экран висит до готовности, Suspense-фолбэк — в MainLayout).
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Nomenclatures = lazy(() => import('./pages/Admin/Nomenclatures/Nomenclatures'));
const AdminTenders = lazy(() => import('./pages/Admin/Tenders/Tenders'));
const Tenders = lazy(() => import('./pages/Tenders/Tenders'));
const ConstructionCost = lazy(() => import('./pages/Admin/ConstructionCost/ConstructionCost'));
const MarkupConstructor = lazy(() => import('./pages/Admin/MarkupConstructor/MarkupConstructor'));
const MarkupPercentages = lazy(() => import('./pages/Admin/MarkupPercentages/MarkupPercentages'));
const Library = lazy(() => import('./pages/Library'));
const Templates = lazy(() => import('./pages/Library/Templates'));
const ImportLog = lazy(() => import('./pages/Admin/ImportLog/ImportLog'));
const Insurance = lazy(() => import('./pages/Admin/Insurance/Insurance'));
const CostRedistribution = lazy(() => import('./pages/CostRedistribution'));
const Bsm = lazy(() => import('./pages/Bsm/Bsm'));
const ObjectComparison = lazy(() => import('./pages/Analytics/ObjectComparison'));
const FinancialIndicators = lazy(() => import('./pages/FinancialIndicators/FinancialIndicators'));
const Users = lazy(() => import('./pages/Users/Users'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/Projects/ProjectDetail'));
const TenderTimeline = lazy(() => import('./pages/TenderTimeline'));

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
        <Routes>
          {/* Публичные маршруты */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="tenders" element={<Tenders />} />
            <Route path="tender-timeline" element={<TenderTimeline />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="positions" element={<ClientPositions />} />
            <Route path="positions/:positionId/items" element={<PositionItemsRoute />} />
            <Route path="commerce/proposal" element={<Commerce />} />
            <Route path="commerce/redistribution" element={<CostRedistribution />} />
            <Route path="commerce" element={<Navigate to="/commerce/proposal" replace />} />
            <Route path="library" element={<Library />} />
            <Route path="library/templates" element={<Templates />} />
            <Route path="bsm" element={<Bsm />} />
            <Route path="analytics">
              <Route path="comparison" element={<ObjectComparison />} />
            </Route>
            <Route path="admin">
              <Route index element={<Navigate to="/admin/nomenclatures" replace />} />
              <Route path="nomenclatures" element={<Nomenclatures />} />
              <Route path="tenders" element={<AdminTenders />} />
              <Route path="construction_cost" element={<ConstructionCost />} />
              <Route path="markup_constructor" element={<MarkupConstructor />} />
              <Route path="markup" element={<MarkupPercentages />} />
              <Route path="import-log" element={<ImportLog />} />
              <Route path="insurance" element={<Insurance />} />
            </Route>
            <Route path="costs" element={<ConstructionCostNew />} />
            <Route path="financial-indicators" element={<FinancialIndicators />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<div>Настройки</div>} />
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
