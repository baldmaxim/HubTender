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
import { ProjectSettings } from './components/ProjectSettings';
import { MonthlyCompletion } from './components/MonthlyCompletion';
import { AdditionalAgreements } from './components/AdditionalAgreements';
import type { ProjectFull, ProjectCompletion } from '../../../lib/supabase/types';

const { Title } = Typography;

interface TenderJoin {
  id: string;
  title: string;
  tender_number: string;
}

const ProjectDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<string>('settings');
  const [project, setProject] = useState<ProjectFull | null>(null);
  const [completionData, setCompletionData] = useState<ProjectCompletion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    try {
      const projectData = await getProject(projectId);

      const typedProject = projectData as unknown as {
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

      // Fetch additional agreements sum
      const agreementsData = await listProjectAgreements(projectId, 'asc');

      const agreementsSum = (agreementsData || []).reduce(
        (sum, a) => sum + (Number(a.amount) || 0),
        0
      );

      // Fetch completion total
      const completionSums = await listProjectMonthlyCompletion(projectId);

      const completionSum = (completionSums || []).reduce(
        (sum, c) => sum + (Number(c.actual_amount) || 0),
        0
      );

      const finalContractCost = Number(typedProject.contract_cost) + agreementsSum;
      const completionPercentage =
        finalContractCost > 0 ? (completionSum / finalContractCost) * 100 : 0;

      setProject({
        ...typedProject,
        contract_cost: Number(typedProject.contract_cost),
        area: typedProject.area ? Number(typedProject.area) : null,
        additional_agreements_sum: agreementsSum,
        final_contract_cost: finalContractCost,
        total_completion: completionSum,
        completion_percentage: completionPercentage,
        tender_name: typedProject.tender?.title,
        tender_number: typedProject.tender?.tender_number,
      });
    } catch (error) {
      console.error('Error loading project:', error);
      message.error('Ошибка загрузки объекта');
      navigate('/projects');
    } finally {
      setLoading(false);
    }
  }, [projectId, navigate]);

  const fetchCompletionData = useCallback(async () => {
    if (!projectId) return;

    try {
      const data = await listProjectMonthlyCompletion(projectId);

      setCompletionData(
        (data || []).map((item) => ({
          ...item,
          actual_amount: Number(item.actual_amount),
          forecast_amount: item.forecast_amount ? Number(item.forecast_amount) : null,
        }))
      );
    } catch (error) {
      console.error('Error loading completion data:', error);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
    fetchCompletionData();
  }, [fetchProject, fetchCompletionData]);

  const handleBack = () => {
    navigate('/projects');
  };

  const handleSave = async () => {
    await fetchProject();
  };

  const handleCompletionSave = async () => {
    await fetchProject();
    await fetchCompletionData();
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
      children: <ProjectSettings project={project} onSave={handleSave} />,
    },
    {
      key: 'agreements',
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 8 }} />
          Доп. соглашения
        </span>
      ),
      children: <AdditionalAgreements project={project} onSave={handleSave} />,
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
        />
      ),
    },
  ];

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
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="large"
          style={{ width: '100%' }}
        />
      </Card>
    </div>
  );
};

export default ProjectDetail;