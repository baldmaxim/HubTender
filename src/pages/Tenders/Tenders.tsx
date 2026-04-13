import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Space } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { supabase } from '../../lib/supabase';
import type { TenderRegistryWithRelations } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useTenderData } from './hooks/useTenderData';
import { TenderAddForm } from './components';
import ImportTendersModal from './ImportTendersModal';
import TenderMonitorModal from './components/TenderMonitorModal';
import TenderMonitorTable from './components/TenderMonitorTable';
import {
  buildCallFollowUpItem,
  formatArea,
  formatMoney,
  getDashboardStatus,
  getTenderSearchText,
  shouldShowCallAction,
  sortTenders,
  type TenderMonitorSortDirection,
  type TenderMonitorSortField,
  type TenderMonitorTab,
} from './utils/tenderMonitor';
import { getTenderMonitorPalette, type TenderMonitorPalette } from './utils/tenderMonitorTheme';
import './Tenders.css';
import './TendersModern.css';
import './TenderMonitor.css';

interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  caption: string;
  accent: string;
  blinking?: boolean;
  palette: TenderMonitorPalette;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  caption,
  accent,
  blinking = false,
  palette,
}) => (
  <div
    className={blinking ? 'tender-monitor-alert-card' : undefined}
    style={{
      background: palette.cardBg,
      border: `1px solid ${palette.border}`,
      borderRadius: 14,
      padding: '14px 18px',
      position: 'relative',
      overflow: 'hidden',
      minHeight: 104,
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        background: accent,
      }}
    />
    <div style={{ color: palette.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{title}</div>
    <div style={{ color: palette.text, fontSize: 28, fontWeight: 700, marginTop: 8 }}>{value}</div>
    <div style={{ color: palette.muted, fontSize: 13, marginTop: 8 }}>{caption}</div>
  </div>
);

const Tenders: React.FC = () => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDirector = user?.role_code === 'director' || user?.role_code === 'general_director';
  const palette = getTenderMonitorPalette(theme === 'dark');

  const [activeTab, setActiveTab] = useState<TenderMonitorTab>('all');
  const [searchValue, setSearchValue] = useState('');
  const [sortField, setSortField] = useState<TenderMonitorSortField>('submission_date');
  const [sortDirection, setSortDirection] = useState<TenderMonitorSortDirection>('asc');
  const [selectedTender, setSelectedTender] = useState<TenderRegistryWithRelations | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<'info' | 'timeline' | 'package'>('info');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const { tenders, statuses, constructionScopes, tenderNumbers, loading, refetch } = useTenderData();

  useEffect(() => {
    if (!selectedTender) {
      return;
    }

    const updatedTender = tenders.find((tender) => tender.id === selectedTender.id) || null;
    setSelectedTender(updatedTender);
  }, [selectedTender, tenders]);

  const visibleTenders = useMemo(() => {
    const filteredBySearch = searchValue.trim()
      ? tenders.filter((tender) =>
          getTenderSearchText(tender).includes(searchValue.trim().toLocaleLowerCase('ru-RU'))
        )
      : tenders;

    const filteredByTab =
      activeTab === 'all'
        ? filteredBySearch
        : filteredBySearch.filter((tender) => getDashboardStatus(tender) === activeTab);

    return sortTenders(filteredByTab, sortField, sortDirection);
  }, [activeTab, searchValue, sortDirection, sortField, tenders]);

  const counts = useMemo(() => {
    const base = {
      all: 0,
      calc: 0,
      sent: 0,
      waiting_pd: 0,
      archive: 0,
    } satisfies Record<TenderMonitorTab, number>;

    tenders.forEach((tender) => {
      const status = getDashboardStatus(tender);
      base.all += 1;
      base[status] += 1;
    });

    return base;
  }, [tenders]);

  const needCallCount = useMemo(
    () => tenders.filter((tender) => shouldShowCallAction(tender)).length,
    [tenders]
  );

  const totalCost = useMemo(
    () => tenders.reduce((sum, tender) => sum + (tender.total_cost || tender.manual_total_cost || 0), 0),
    [tenders]
  );

  const totalArea = useMemo(
    () => tenders.reduce((sum, tender) => sum + (tender.area || 0), 0),
    [tenders]
  );

  const handleSortChange = (field: TenderMonitorSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
  };

  const handleOpenTender = (
    tender: TenderRegistryWithRelations,
    tab: 'info' | 'timeline' | 'package' = 'info'
  ) => {
    setSelectedTender(tender);
    setDetailInitialTab(tab);
    setDetailOpen(true);
  };

  const handleQuickCall = async (tender: TenderRegistryWithRelations) => {
    const chronologyItems = tender.chronology_items || [];
    const updatedItems = [...chronologyItems, buildCallFollowUpItem(dayjs().toISOString())];

    const { error } = await supabase
      .from('tender_registry')
      .update({ chronology_items: updatedItems })
      .eq('id', tender.id);

    if (error) {
      message.error(error.message);
      return;
    }

    message.success(`В хронологию "${tender.title}" добавлено событие звонка`);
    await refetch();
  };

  return (
    <div
      className="tender-monitor-page"
      style={
        {
          '--tm-page-bg': palette.pageBg,
          '--tm-page-glow-primary': palette.pageGlowPrimary,
          '--tm-page-glow-secondary': palette.pageGlowSecondary,
          '--tm-card-border': palette.border,
          '--tm-call-pulse-shadow': palette.callPulseShadow,
          '--tm-alert-pulse-shadow': palette.alertPulseShadow,
          '--tm-alert-pulse-border': palette.alertPulseBorder,
        } as React.CSSProperties
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: palette.text, fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Перечень тендеров</div>
            <div style={{ color: palette.muted, fontSize: 14 }}>
              Реестр с контролем подачи КП, звонков и общей хронологии тендера.
            </div>
          </div>

          {!isDirector ? (
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowAddForm((prev) => !prev)}>
                {showAddForm ? 'Скрыть форму' : 'Добавить тендер'}
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
                Импорт из Excel
              </Button>
            </Space>
          ) : null}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          <MetricCard title="Всего тендеров" value={counts.all} caption="активных позиций" accent={palette.title} palette={palette} />
          <MetricCard title="В расчете" value={counts.calc} caption="готовятся КП" accent={palette.info} palette={palette} />
          <MetricCard title="Направлено" value={counts.sent} caption="ожидает ответа" accent="#ef9f27" palette={palette} />
          <MetricCard
            title="Требуют звонка"
            value={needCallCount}
            caption="более 7 дней без контроля"
            accent={palette.danger}
            blinking={needCallCount > 0}
            palette={palette}
          />
          <MetricCard
            title="Сумма КП"
            value={formatMoney(totalCost)}
            caption={`${formatArea(totalArea)} в работе`}
            accent={palette.success}
            palette={palette}
          />
        </div>

        {showAddForm && !isDirector ? (
          <TenderAddForm
            statuses={statuses}
            constructionScopes={constructionScopes}
            tenderNumbers={tenderNumbers}
            onSuccess={async () => {
              setShowAddForm(false);
              await refetch();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        ) : null}

        <TenderMonitorTable
          tenders={visibleTenders}
          loading={loading}
          activeTab={activeTab}
          searchValue={searchValue}
          sortField={sortField}
          sortDirection={sortDirection}
          counts={counts}
          onTabChange={setActiveTab}
          onSearchChange={setSearchValue}
          onSortChange={handleSortChange}
          onOpenTender={(tender) => handleOpenTender(tender, 'info')}
          onOpenTimeline={(tender) => handleOpenTender(tender, 'timeline')}
          onQuickCall={handleQuickCall}
          onAddTender={!isDirector ? () => setShowAddForm((prev) => !prev) : undefined}
        />
      </div>

      <TenderMonitorModal
        open={detailOpen}
        tender={selectedTender}
        initialTab={detailInitialTab}
        statuses={statuses}
        constructionScopes={constructionScopes}
        onClose={() => setDetailOpen(false)}
        onQuickCall={handleQuickCall}
        onUpdate={refetch}
      />

      <ImportTendersModal
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onSuccess={async () => {
          setImportModalOpen(false);
          await refetch();
        }}
        constructionScopes={constructionScopes}
        statuses={statuses}
      />
    </div>
  );
};

export default Tenders;
