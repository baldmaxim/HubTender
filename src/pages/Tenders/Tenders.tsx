import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { patchTenderRegistryFields } from '../../lib/api/tenderRegistry';
import type { TenderRegistryWithRelations } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTenderData } from './hooks/useTenderData';
import { useTenderDeleteMode } from './hooks/useTenderDeleteMode';
import { TenderAddForm } from './components';
import ImportTendersModal from './ImportTendersModal';
import TenderMonitorModal from './components/TenderMonitorModal';
import TenderMonitorTable, { type TenderViewMode } from './components/TenderMonitorTable';
import { TenderKanbanBoard } from './components/kanban/TenderKanbanBoard';
import { CallListPopover } from './components/CallListPopover';
import { CallNoteDialog } from './components/CallNoteDialog';
import { TenderPageActions } from './components/TenderPageActions';
import { TenderSelectionContext } from './components/selection/tenderSelection';
import { TenderSelectionBar } from './components/selection/TenderSelectionBar';
import { TenderDeleteConfirm } from './components/selection/TenderDeleteConfirm';
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
import {
  getTenderAntdTheme,
  getTenderControlVars,
  getTenderMonitorPalette,
  isCoarsePointer,
  mixHex,
  type TenderMonitorPalette,
} from './utils/tenderMonitorTheme';
import './Tenders.css';
import './TendersModern.css';
import './TenderMonitor.css';

const VIEW_MODE_STORAGE_KEY = 'tenderHub_tendersView';

const readViewMode = (): TenderViewMode => {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'kanban' ? 'kanban' : 'list';
  } catch {
    return 'list';
  }
};

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
}) => (
  <div
    className={blinking ? 'tm-metric tender-monitor-alert-card' : 'tm-metric'}
    style={
      {
        '--tm-metric-accent': accent,
        '--tm-metric-bg': palette.cardBg,
        '--tm-metric-border': palette.border,
        '--tm-metric-text': palette.text,
        // Текст статистики ярче приглушённого: на телефоне сильнее (0.5), на остальных экранах 0.2.
        '--tm-metric-muted': mixHex(palette.muted, palette.text, isPhone ? 0.5 : 0.2),
      } as React.CSSProperties
    }
  >
    <div className="tm-metric__title">{title}</div>
    <div className="tm-metric__row">
      <span className="tm-metric__value">{value}</span>
      <span className="tm-metric__caption" title={caption}>
        {caption}
      </span>
    </div>
  </div>
);

const Tenders: React.FC = () => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { isMobile, isPhoneDevice, isLandscapePhone } = useIsMobile();
  const isDirector = user?.role_code === 'director' || user?.role_code === 'general_director';
  const isGeneralDirector = user?.role_code === 'general_director';
  const palette = getTenderMonitorPalette(theme === 'dark');
  const antdTheme = useMemo(() => getTenderAntdTheme(getTenderMonitorPalette(theme === 'dark'), theme === 'dark'), [theme]);

  const [activeTab, setActiveTab] = useState<TenderMonitorTab>('all');
  const [searchValue, setSearchValue] = useState('');
  const [sortField, setSortField] = useState<TenderMonitorSortField>('submission_date');
  const [sortDirection, setSortDirection] = useState<TenderMonitorSortDirection>('asc');
  const [selectedTender, setSelectedTender] = useState<TenderRegistryWithRelations | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<'info' | 'timeline' | 'package'>('info');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewMode, setViewMode] = useState<TenderViewMode>(readViewMode);
  const [callTender, setCallTender] = useState<TenderRegistryWithRelations | null>(null);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callSaving, setCallSaving] = useState(false);

  const { tenders, statuses, constructionScopes, tenderNumbers, loading, refetch } = useTenderData();
  const deleteMode = useTenderDeleteMode({ tenders, onDeleted: refetch });

  useEffect(() => {
    if (!selectedTender) {
      return;
    }

    const updatedTender = tenders.find((tender) => tender.id === selectedTender.id) || null;
    setSelectedTender(updatedTender);
  }, [selectedTender, tenders]);

  const searchedTenders = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase('ru-RU');
    return query ? tenders.filter((tender) => getTenderSearchText(tender).includes(query)) : tenders;
  }, [searchValue, tenders]);

  const visibleTenders = useMemo(() => {
    const filteredByTab =
      activeTab === 'all'
        ? searchedTenders
        : searchedTenders.filter((tender) => getDashboardStatus(tender) === activeTab);

    return sortTenders(filteredByTab, sortField, sortDirection);
  }, [activeTab, searchedTenders, sortDirection, sortField]);

  // Доска показывает все статусы колонками: вкладки к ней не применяются.
  const boardTenders = useMemo(
    () => sortTenders(searchedTenders, sortField, sortDirection),
    [searchedTenders, sortDirection, sortField]
  );

  const handleViewModeChange = (mode: TenderViewMode) => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // приватный режим — выбор живёт до перезагрузки
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && 'startViewTransition' in document) {
      document.startViewTransition(() => flushSync(() => setViewMode(mode)));
      return;
    }
    setViewMode(mode);
  };

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

  const callTenders = useMemo(() => tenders.filter((tender) => shouldShowCallAction(tender)), [tenders]);
  const needCallCount = callTenders.length;

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

  // «Позвонить» открывает окно описания — без текста звонок в хронологию не записывается.
  const handleQuickCall = (tender: TenderRegistryWithRelations) => {
    setCallTender(tender);
    setCallDialogOpen(true);
  };

  const handleCallSave = async (text: string) => {
    if (!callTender) {
      return;
    }

    // Пока писали описание, список мог обновиться по realtime — дописываем к свежей хронологии.
    const tender = tenders.find((item) => item.id === callTender.id) ?? callTender;
    const updatedItems = [...(tender.chronology_items || []), buildCallFollowUpItem(dayjs().toISOString(), text)];

    setCallSaving(true);
    try {
      await patchTenderRegistryFields(tender.id, { chronology_items: updatedItems });
    } catch (err) {
      message.error((err as Error).message);
      return;
    } finally {
      setCallSaving(false);
    }

    setCallDialogOpen(false);
    message.success(`В хронологию "${tender.title}" добавлен звонок`);
    await refetch();
  };

  return (
    // Тема antd страницы: поля, списки и окна (они рендерятся порталом, но контекст доходит) — в палитре.
    <ConfigProvider theme={antdTheme} componentSize={isCoarsePointer() ? 'large' : undefined}>
      <div
        // Канбан — страница ровно в экран: прокручиваются только колонки доски.
        className={[
          'tender-monitor-page',
          viewMode === 'kanban' && 'tender-monitor-page--fit',
          deleteMode.active && 'tender-monitor-page--selecting',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          {
            '--tm-page-bg': palette.pageBg,
            '--tm-page-glow-primary': palette.pageGlowPrimary,
            '--tm-page-glow-secondary': palette.pageGlowSecondary,
            '--tm-card-border': palette.border,
            '--tm-call-pulse-shadow': palette.callPulseShadow,
            '--tm-alert-pulse-shadow': palette.alertPulseShadow,
            '--tm-alert-pulse-border': palette.alertPulseBorder,
            ...getTenderControlVars(palette),
          } as React.CSSProperties
        }
      >
        <div className="tm-page-body">
          {/* Описание и кнопки управления — скрыты на телефонах (заголовок страницы — в общей шапке, здесь режим просмотра).
              В ландшафте телефона isMobile=false, поэтому добавляем !isLandscapePhone, чтобы не дублировать шапку. */}
          {!isMobile && !isLandscapePhone && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: palette.muted, fontSize: 14 }}>
                  Реестр с контролем подачи КП, звонков и общей хронологии тендера.
                </div>
              </div>

              {!isDirector ? (
                <TenderPageActions
                  showAddForm={showAddForm}
                  selecting={deleteMode.active}
                  onToggleSelect={deleteMode.active ? deleteMode.cancel : deleteMode.start}
                  onToggleAddForm={() => setShowAddForm((prev) => !prev)}
                  onImport={() => setImportModalOpen(true)}
                />
              ) : null}
            </div>
          )}

          <div className={isPhoneDevice ? 'tm-metrics tm-metrics--phone' : 'tm-metrics'}>
            <MetricCard title="Всего тендеров" value={counts.all} caption="активных позиций" accent={palette.title} palette={palette} isPhone={isPhoneDevice} />
            <MetricCard title="В расчете" value={counts.calc} caption="готовятся КП" accent={palette.info} palette={palette} isPhone={isPhoneDevice} />
            <MetricCard title="Направлено" value={counts.sent} caption="ожидает ответа" accent={palette.sent} palette={palette} isPhone={isPhoneDevice} />
            {needCallCount > 0 ? (
              <CallListPopover
                tenders={callTenders}
                palette={palette}
                readOnly={isGeneralDirector || isMobile}
                placement="bottom"
                onOpenTender={(tender) => handleOpenTender(tender, 'info')}
                onQuickCall={handleQuickCall}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="tm-metric-trigger"
                  aria-label={`Требуют звонка: ${needCallCount}. Показать, кому позвонить`}
                  aria-haspopup="dialog"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.currentTarget.click();
                    }
                  }}
                >
                  <MetricCard
                    title="Требуют звонка"
                    value={needCallCount}
                    caption="более 7 дней без контроля"
                    accent={palette.danger}
                    blinking
                    palette={palette}
                    isPhone={isPhoneDevice}
                  />
                </div>
              </CallListPopover>
            ) : (
              <MetricCard
                title="Требуют звонка"
                value={0}
                caption="более 7 дней без контроля"
                accent={palette.success}
                palette={palette}
                isPhone={isPhoneDevice}
              />
            )}
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

          <TenderSelectionContext.Provider value={deleteMode.selection}>
            <TenderMonitorTable
              tenders={visibleTenders}
              loading={loading && (viewMode === 'list' || tenders.length === 0)}
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
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              kanban={
                <TenderKanbanBoard
                  tenders={boardTenders}
                  statuses={statuses}
                  dragEnabled={!isGeneralDirector && !isPhoneDevice && !deleteMode.active}
                  readOnly={isGeneralDirector || isMobile}
                  onOpenTender={(tender) => handleOpenTender(tender, 'info')}
                  onOpenTimeline={(tender) => handleOpenTender(tender, 'timeline')}
                  onOpenPackage={(tender) => handleOpenTender(tender, 'package')}
                  onQuickCall={handleQuickCall}
                  onUpdate={refetch}
                />
              }
            />
          </TenderSelectionContext.Provider>
        </div>

        {deleteMode.active ? (
          <TenderSelectionBar
            count={deleteMode.selectedTenders.length}
            onCancel={deleteMode.cancel}
            onDelete={deleteMode.openConfirm}
          />
        ) : null}

        <TenderDeleteConfirm
          open={deleteMode.confirmOpen}
          tenders={deleteMode.selectedTenders}
          deleting={deleteMode.deleting}
          palette={palette}
          onCancel={deleteMode.closeConfirm}
          onConfirm={() => void deleteMode.confirmDelete()}
        />

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

        <CallNoteDialog
          open={callDialogOpen}
          tender={callTender}
          saving={callSaving}
          palette={palette}
          onCancel={() => setCallDialogOpen(false)}
          onSave={(text) => void handleCallSave(text)}
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
          palette={palette}
        />
      </div>
    </ConfigProvider>
  );
};

export default Tenders;
