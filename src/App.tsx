import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import MainLayout from './components/Layout/MainLayout';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import ForgotPassword from './pages/Auth/ForgotPassword';
import ResetPassword from './pages/Auth/ResetPassword';
import Dashboard from './pages/Dashboard/Dashboard';
import Tasks from './pages/Tasks';
import Nomenclatures from './pages/Admin/Nomenclatures/Nomenclatures';
import AdminTenders from './pages/Admin/Tenders/Tenders';
import Tenders from './pages/Tenders/Tenders';
import ConstructionCost from './pages/Admin/ConstructionCost/ConstructionCost';
import ConstructionCostNew from './pages/Admin/ConstructionCostNew';
import MarkupConstructor from './pages/Admin/MarkupConstructor/MarkupConstructor';
import MarkupPercentages from './pages/Admin/MarkupPercentages/MarkupPercentages';
import Library from './pages/Library';
import Templates from './pages/Library/Templates';
import ClientPositions from './pages/ClientPositions/ClientPositions';
import PositionItems from './pages/PositionItems/PositionItems';
import ImportLog from './pages/Admin/ImportLog/ImportLog';
import Insurance from './pages/Admin/Insurance/Insurance';
import Commerce from './pages/Commerce';
import CostRedistribution from './pages/CostRedistribution';
import Bsm from './pages/Bsm/Bsm';
import ObjectComparison from './pages/Analytics/ObjectComparison';
import FinancialIndicators from './pages/FinancialIndicators/FinancialIndicators';
import Users from './pages/Users/Users';
import Projects from './pages/Projects';
import ProjectDetail from './pages/Projects/ProjectDetail';
import TenderTimeline from './pages/TenderTimeline';
import './App.css';

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
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="tenders" element={<Tenders />} />
            <Route path="tender-timeline" element={<TenderTimeline />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="positions" element={<ClientPositions />} />
            <Route path="positions/:positionId/items" element={<PositionItems />} />
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
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App
