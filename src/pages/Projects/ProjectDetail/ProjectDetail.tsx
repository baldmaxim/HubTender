import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Tabs,
  Typography,
  Button,
  Space,
  Spin,
  message,
  Breadcrumb,
} from 'antd';
import { ArrowLeftOutlined, SettingOutlined, CalendarOutlined, FileTextOutlined } from '@ant-design/icons';
import {
  getProject,
  listProjectAgreements,
  listProjectMonthlyCompletion,
} from '../../../lib/api/projects';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { ProjectSettings } from './components/ProjectSettings';
import { MonthlyCompletion, type OptimisticCompletion } from './components/MonthlyCompletion';
import { AdditionalAgreements } from './components/AdditionalAgreements';
import type { ProjectFull, ProjectCompletion } from '../../../lib/supabase/types';

const { Title } = Typography;

interface TenderJoin {
  id: string;
  title: string;
  tender_number: string;
}

type RawProject = {
  id: string;
  name: string;
  client_name: string;
  contract_cost: number;
  area: number | null;
  contract_date: string | null;
  construction_start_date: string | null;
  construction_end_date: string | null;
  tender_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  tender: TenderJoin | null;
};

const buildProjectFull = (
  raw: RawProject,
  agreementsSum: number,
  completion: ProjectCompletion[],
): ProjectFull => {
  const completionSum = completion.reduce((sum, c) => sum + (Number(c.actual_amount) || 0), 0);
  const finalContractCost = Number(raw.contract_cost) + agreementsSum;
  const completionPercentage =
    finalContractCost > 0 ? (completionSum / finalContractCost) * 100 : 0;
  return {
    ...raw,
    contract_cost: Number(raw.contract_cost),
    area: raw.area ? Number(raw.area) : null,
    additional_agreements_sum: agreementsSum,
    final_contract_cost: finalContractCost,
    total_completion: completionSum,
    completion_percentage: completionPercentage,
    tender_name: raw.tender?.title,
    tender_number: raw.tender?.tender_number,
  };
};

const ProjectDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { isMobile, isPhoneDevice } = useIsMobile();
  // Генеральный директор и телефоны — только просмотр (без редактирования данных объекта)
  const readOnly = user?.role_code === 'general_director' || isMobile;
  const [activeTab, setActiveTab] = useState<string>('settings');
  const [project, setProject] = useState<ProjectFull | null>(null);
  const [completionData, setCompletionData] = useState<ProjectCompletion[]>([]);
  const [loading, setLoading] = useState(true);

  // Единый рефреш: один проход за project + agreements + completion.
  // silent=true — без полноэкранного спиннера (карточка и таблица не размонтируются).
  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!projectId) return;
      if (!opts?.silent) setLoading(true);
      try {
        const [projectData, agreementsData, completionRows] = await Promise.all([
          getProject(projectId),
          listProjectAgreements(projectId, 'asc'),
          listProjectMonthlyCompletion(projectId),
        ]);

        const raw = projectData as unknown as RawProject;
        const agreementsSum = (agreementsData || []).reduce(
          (sum, a) => sum + (Number(a.amount) || 0),
          0,
        );
        const completion: ProjectCompletion[] = (completionRows || []).map((item) => ({
          ...item,
          actual_amount: Number(item.actual_amount),
          forecast_amount: item.forecast_amount ? Number(item.forecast_amount) : null,
        }));

        setCompletionData(completion);
        setProject(buildProjectFull(raw, agreementsSum, completion));
      } catch (error) {
        console.error('Error loading project:', error);
        message.error('Ошибка загрузки объекта');
        if (!opts?.silent) navigate('/projects');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [projectId, navigate],
  );

  // Оптимистично отразить сохранённые строки сразу, до фоновой сверки.
  const applyCompletionOptimistic = useCallback(
    (saved: OptimisticCompletion[]) => {
      setCompletionData((prev) => {
        const next = [...prev];
        saved.forEach((s) => {
          const idx = next.findIndex((c) => c.year === s.year && c.month === s.month);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              actual_amount: s.actual_amount,
              forecast_amount: s.forecast_amount,
              note: s.note,
            };
          } else {
            next.push({
              id: `optimistic-${s.year}-${s.month}`,
              project_id: projectId ?? '',
              year: s.year,
              month: s.month,
              actual_amount: s.actual_amount,
              forecast_amount: s.forecast_amount,
              note: s.note,
              created_at: '',
            });
          }
        });
        return next;
      });
    },
    [projectId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Держим агрегаты проекта (закрыто/процент) в синхроне с completionData.
  useEffect(() => {
    setProject((p) => {
      if (!p) return p;
      const completionSum = completionData.reduce((s, c) => s + (Number(c.actual_amount) || 0), 0);
      const finalContractCost = p.final_contract_cost ?? 0;
      const completionPercentage =
        finalContractCost > 0 ? (completionSum / finalContractCost) * 100 : 0;
      if (
        p.total_completion === completionSum &&
        p.completion_percentage === completionPercentage
      ) {
        return p;
      }
      return { ...p, total_completion: completionSum, completion_percentage: completionPercentage };
    });
  }, [completionData]);

  const handleBack = () => {
    navigate('/projects');
  };

  const handleSave = async () => {
    await refresh();
  };

  const handleCompletionSave = async () => {
    await refresh({ silent: true });
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const tabItems = [
    {
      key: 'settings',
      label: (
        <span>
          <SettingOutlined style={{ marginRight: 8 }} />
          Настройки объекта
        </span>
      ),
      children: <ProjectSettings project={project} onSave={handleSave} readOnly={readOnly} />,
    },
    {
      key: 'agreements',
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 8 }} />
          Доп. соглашения
        </span>
      ),
      children: <AdditionalAgreements project={project} onSave={handleSave} readOnly={readOnly} />,
    },
    {
      key: 'completion',
      label: (
        <span>
          <CalendarOutlined style={{ marginRight: 8 }} />
          Выполнение по месяцам
        </span>
      ),
      children: (
        <MonthlyCompletion
          project={project}
          completionData={completionData}
          onSave={handleCompletionSave}
          onOptimistic={applyCompletionOptimistic}
          readOnly={readOnly}
        />
      ),
    },
  ];

  // На телефоне (любая ориентация) вкладку «Настройки объекта» скрываем.
  const visibleTabItems = isPhoneDevice
    ? tabItems.filter((t) => t.key !== 'settings')
    : tabItems;

  return (
    <div style={{ padding: '0 8px 8px' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: 'Текущие объекты', href: '#', onClick: handleBack },
          { title: project.name },
        ]}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Назад
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {project.name}
          </Title>
        </Space>
      </div>

      <Card
        bordered={false}
        bodyStyle={{ padding: '0 8px 8px' }}
        style={{
          background: theme === 'dark' ? '#141414' : '#fff',
        }}
      >
        <Tabs
          activeKey={isPhoneDevice && activeTab === 'settings' ? 'agreements' : activeTab}
          onChange={setActiveTab}
          items={visibleTabItems}
          size="large"
          style={{ width: '100%' }}
        />
      </Card>
    </div>
  );
};

export default ProjectDetail;