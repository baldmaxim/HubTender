import { useState, useEffect, useCallback } from 'react';
import { Typography, Spin, Card, Tabs, Select, Button, Row, Col, Tag, Input, message } from 'antd';
import { BarChartOutlined, TableOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { getVersionColorByTitle } from '../../utils/versionColor';
import { supabase } from '../../lib/supabase';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
import dayjs from 'dayjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { useFinancialData } from './hooks/useFinancialData';
import { IndicatorsCharts } from './components/IndicatorsCharts';
import { IndicatorsTable } from './components/IndicatorsTable';
import { IndicatorsFilters } from './components/IndicatorsFilters';


ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ChartTitle,
  ChartTooltip,
  Legend,
  ArcElement,
  ChartDataLabels
);

const { Title, Text } = Typography;

const FinancialIndicators: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const {
    tenders,
    loading,
    data,
    spTotal,
    customerTotal,
    isVatInConstructor,
    vatCoefficient,
    loadTenders,
    fetchFinancialIndicators,
  } = useFinancialData();

  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'table' | 'charts'>('charts');
  const [editingVolumeTitle, setEditingVolumeTitle] = useState(false);
  const [volumeTitle, setVolumeTitle] = useState('Полный объём строительства');
  const [tempVolumeTitle, setTempVolumeTitle] = useState('Полный объём строительства');

  const loadVolumeTitle = useCallback(async (tenderId: string) => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('volume_title')
        .eq('id', tenderId)
        .single();

      if (error) throw error;

      const title = data?.volume_title || 'Полный объём строительства';
      setVolumeTitle(title);
      setTempVolumeTitle(title);
    } catch (error) {
      console.error('Ошибка загрузки заголовка:', error);
    }
  }, []);

  useEffect(() => {
    loadTenders();
  }, [loadTenders]);

  useEffect(() => {
    if (selectedTenderId) {
      fetchFinancialIndicators(selectedTenderId);
      loadVolumeTitle(selectedTenderId);
    }
  }, [selectedTenderId, fetchFinancialIndicators, loadVolumeTitle]);

  // Native WS hub when VITE_API_REALTIME_ENABLED=true.
  const wsActive = useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) {
        fetchFinancialIndicators(selectedTenderId);
        loadVolumeTitle(selectedTenderId);
      }
    },
  );

  // Supabase Realtime fallback when WS is disabled.
  useEffect(() => {
    if (!selectedTenderId || wsActive) return;

    const channel = supabase
      .channel(`tender_changes_${selectedTenderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenders',
          filter: `id=eq.${selectedTenderId}`,
        },
        () => {
          fetchFinancialIndicators(selectedTenderId);
          loadVolumeTitle(selectedTenderId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTenderId, wsActive, fetchFinancialIndicators, loadVolumeTitle]);

  const handleUpdateVolumeTitle = async () => {
    if (!selectedTenderId) return;

    try {
      const { error } = await supabase
        .from('tenders')
        .update({ volume_title: tempVolumeTitle })
        .eq('id', selectedTenderId);

      if (error) throw error;

      setVolumeTitle(tempVolumeTitle);
      setEditingVolumeTitle(false);
      message.success('Заголовок обновлен');
    } catch (error: any) {
      message.error('Ошибка обновления заголовка: ' + error.message);
    }
  };

  const handleCancelVolumeTitle = () => {
    setTempVolumeTitle(volumeTitle);
    setEditingVolumeTitle(false);
  };

  const formatNumber = (value: number | undefined) => {
    if (value === undefined) return '';
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const getTenderTitles = () => {
    const uniqueTitles = new Map<string, { value: string; label: string }>();
    tenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
        });
      }
    });
    return Array.from(uniqueTitles.values());
  };

  const getVersionsForTitle = (title: string) => {
    return tenders
      .filter(t => t.title === title)
      .map(t => ({
        value: t.version || 1,
        label: `Версия ${t.version || 1}`,
      }));
  };

  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
    } else {
      setSelectedVersion(null);
      setSelectedTenderId(null);
    }
  };

  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
    }
  };

  if (!selectedTenderId) {
    return (
      <div>
        <Card bordered={false} style={{ height: '100%' }}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Title level={4} style={{ marginBottom: 24 }}>
              Финансовые показатели
            </Title>
            <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
              Выберите тендер для просмотра показателей
            </Text>
            <Select
              className="tender-select"
              style={{ width: 400, marginBottom: 32 }}
              placeholder="Выберите тендер"
              value={selectedTenderTitle}
              onChange={handleTenderTitleChange}
              showSearch
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={getTenderTitles()}
              size="large"
            />

            {selectedTenderTitle && (
              <Select
                style={{ width: 200, marginBottom: 32, marginLeft: 16 }}
                placeholder="Выберите версию"
                value={selectedVersion}
                onChange={handleVersionChange}
                options={getVersionsForTitle(selectedTenderTitle)}
                size="large"
              />
            )}

            {tenders.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Или выберите из списка:
                </Text>
                <Row gutter={[16, 16]} justify="center">
                  {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
                    <Col key={tender.id}>
                      <Card
                        hoverable
                        style={{
                          width: 200,
                          textAlign: 'center',
                          cursor: 'pointer',
                          borderColor: '#10b981',
                          borderWidth: 1,
                        }}
                        onClick={() => {
                          setSelectedTenderTitle(tender.title);
                          setSelectedVersion(tender.version || 1);
                          setSelectedTenderId(tender.id);
                        }}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            window.open(`/financial-indicators?tenderId=${tender.id}`, '_blank');
                          }
                        }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <Tag color="#10b981">{tender.tender_number}</Tag>
                        </div>
                        <div style={{
                          marginBottom: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexWrap: 'nowrap',
                          gap: 4
                        }}>
                          <Text strong style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 140
                          }}>
                            {tender.title}
                          </Text>
                          <Tag color={getVersionColorByTitle(tender.version, tender.title, tenders)} style={{ flexShrink: 0, margin: 0 }}>v{tender.version || 1}</Tag>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {tender.client_name}
                        </Text>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
          onClick={() => {
            setSelectedTenderId(null);
            setSelectedTenderTitle('');
            setSelectedVersion(null);
          }}
        >
          ← Назад к выбору тендера
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Финансовые показатели
        </Title>
      </div>

      <IndicatorsFilters
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        loading={loading}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
        onRefresh={() => fetchFinancialIndicators(selectedTenderId)}
      />

      <Card bordered={false}>
        <div style={{ marginBottom: 24 }}>
          {editingVolumeTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              <Input
                value={tempVolumeTitle}
                onChange={(e) => setTempVolumeTitle(e.target.value)}
                style={{ maxWidth: 400, fontSize: 24, fontWeight: 600, color: '#ff4d4f', textAlign: 'center' }}
                size="large"
              />
              <CheckOutlined
                style={{ fontSize: 20, color: '#52c41a', cursor: 'pointer' }}
                onClick={handleUpdateVolumeTitle}
              />
              <CloseOutlined
                style={{ fontSize: 20, color: '#ff4d4f', cursor: 'pointer' }}
                onClick={handleCancelVolumeTitle}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Title level={3} style={{ margin: 0, textAlign: 'center', color: '#ff4d4f' }}>
                {volumeTitle}
              </Title>
              <EditOutlined
                style={{ fontSize: 16, cursor: 'pointer', color: '#1890ff' }}
                onClick={() => setEditingVolumeTitle(true)}
              />
            </div>
          )}
          {selectedTenderTitle && (
            <Title level={4} style={{ margin: '8px 0 0 0', textAlign: 'center', color: '#ff4d4f' }}>
              {selectedTenderTitle}
            </Title>
          )}
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Text type="secondary">
              {dayjs().format('DD.MM.YYYY')}
            </Text>
          </div>
        </div>

        <Spin spinning={loading}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'table' | 'charts')}
            items={[
              {
                key: 'charts',
                label: (
                  <span>
                    <BarChartOutlined style={{ marginRight: 8 }} />
                    Графики
                  </span>
                ),
                children: (
                  <IndicatorsCharts
                    data={data}
                    spTotal={spTotal}
                    formatNumber={formatNumber}
                    selectedTenderId={selectedTenderId}
                    isVatInConstructor={isVatInConstructor}
                    vatCoefficient={vatCoefficient}
                  />
                ),
              },
              {
                key: 'table',
                label: (
                  <span>
                    <TableOutlined style={{ marginRight: 8 }} />
                    Таблица
                  </span>
                ),
                children: (
                  <IndicatorsTable
                    data={data}
                    spTotal={spTotal}
                    customerTotal={customerTotal}
                    formatNumber={formatNumber}
                    currentTheme={currentTheme}
                    tenderTitle={selectedTenderTitle}
                    tenderVersion={selectedVersion || 1}
                    tenderId={selectedTenderId}
                    onAreaUpdated={() => fetchFinancialIndicators(selectedTenderId)}
                  />
                ),
              },
            ]}
          />
        </Spin>
      </Card>
    </div>
  );
};

export default FinancialIndicators;
