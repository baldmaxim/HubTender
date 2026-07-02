import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Space } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { patchTenderRegistryFields } from '../../lib/api/tenderRegistry';
import type { TenderRegistryWithRelations } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
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
import { getTenderMonitorPalette, mixHex, type TenderMonitorPalette } from './utils/tenderMonitorTheme';
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
  isPhone?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  caption,
  accent,
  blinking = false,
  palette,
  isPhone = false,
}) => {
  // Текст блоков статистики ярче: на телефоне сильнее (0.5), на остальных экранах 0.2.
  const brightMuted = mixHex(palette.muted, palette.text, isPhone ? 0.5 : 0.2);
  return (
  <div
    className={blinking ? 'tender-monitor-alert-card' : undefined}
    style={{
      background: palette.cardBg,
      border: `1px solid ${palette.border}`,
      borderRadius: 14,
      padding: isPhone ? '6px 8px' : '14px 18px',
      position: 'relative',
      overflow: 'hidden',
      minHeight: isPhone ? 40 : 104,
      textAlign: isPhone ? 'center' : undefined,
      flex: isPhone ? '0 0 calc((100% - 16px) / 3)' : undefined,
      minWidth: isPhone ? 0 : undefined,
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
    <div style={{ color: brightMuted, fontSize: isPhone ? 9 : 12, textTransform: 'uppercase', letterSpacing: isPhone ? '0.04em' : '0.12em', lineHeight: 1.15 }}>{title}</div>
    <div style={{ color: isPhone ? brightMuted : palette.text, fontSize: isPhone ? 'clamp(13px, 4.4vw, 19px)' : 28, fontWeight: isPhone ? 600 : 700, marginTop: isPhone ? 1 : 8, lineHeight: 1.15 }}>{value}</div>
    <div style={{ color: brightMuted, fontSize: isPhone ? 9 : 13, marginTop: isPhone ? 1 : 8, lineHeight: 1.15 }}>{caption}</div>
  </div>
  );
};

const Tenders: React.FC = () => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { isMobile, isPhoneDevice, isLandscapePhone } = useIsMobile();
  const isDirector = user?.role_code === 'director' || user?.role_code === 'general_director';
  const isGeneralDirector = user?.role_code === 'general_director';
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

  const activeTenders = useMemo(
    () =>
      tenders.filter((tender) => {
        const status = getDashboardStatus(tender);
        return status === 'calc' || status === 'sent';
      }),
    [tenders]
  );

  const totalCost = useMemo(
    () => activeTenders.reduce((sum, tender) => sum + (tender.total_cost || tender.manual_total_cost || 0), 0),
    [activeTenders]
  );

  const totalArea = useMemo(
    () => activeTenders.reduce((sum, tender) => sum + (tender.area || 0), 0),
    [activeTenders]
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

    try {
      await patchTenderRegistryFields(tender.id, { chronology_items: updatedItems });
    } catch (err) {
      message.error((err as Error).message);
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
        {/* Заголовок и кнопки управления — скрыты на телефонах (название в шапке, режим просмотра).
            В ландшафте телефона isMobile=false, поэтому добавляем !isLandscapePhone, чтобы не дублировать шапку. */}
        {!isMobile && !isLandscapePhone && (
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
        )}

        <div
          style={
            isPhoneDevice
              ? { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }
              : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }
          }
        >
          <MetricCard title="Всего тендеров" value={counts.all} caption="активных позиций" accent={palette.title} palette={palette} isPhone={isPhoneDevice} />
          <MetricCard title="В расчете" value={counts.calc} caption="готовятся КП" accent={palette.info} palette={palette} isPhone={isPhoneDevice} />
          <MetricCard title="Направлено" value={counts.sent} caption="ожидает ответа" accent="#ef9f27" palette={palette} isPhone={isPhoneDevice} />
          <MetricCard
            title="Требуют звонка"
            value={needCallCount}
            caption="более 7 дней без контроля"
            accent={needCallCount > 0 ? palette.danger : palette.success}
            blinking={needCallCount > 0}
            palette={palette}
            isPhone={isPhoneDevice}
          />
          <MetricCard
            title="Сумма КП"
            value={formatMoney(totalCost)}
            caption={`${formatArea(totalArea)} в работе`}
            accent={palette.success}
            palette={palette}
            isPhone={isPhoneDevice}
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
          onOpenPackage={(tender) => handleOpenTender(tender, 'package')}
          onQuickCall={handleQuickCall}
          onUpdate={refetch}
          readOnly={isGeneralDirector || isMobile}
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
        readOnly={isGeneralDirector || isPhoneDevice}
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
        existingTenders={tenders}
      />
    </div>
  );
};

export default Tenders;
