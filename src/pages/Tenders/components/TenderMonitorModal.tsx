import React, { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, Modal, Space, Tag, Typography } from 'antd';
import { CloseOutlined, EditOutlined, LoadingOutlined, PhoneOutlined, SaveOutlined } from '@ant-design/icons';
import type {
  ConstructionScope,
  TenderRegistryWithRelations,
  TenderStatus,
} from '../../../lib/types';
import { useTheme } from '../../../contexts/ThemeContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useHorizontalSwipe } from '../../../hooks/useHorizontalSwipe';
import {
  getChronologyItems,
  getDashboardStatus,
  getPackageItems,
  getStatusBadgeStyle,
  getTenderStatusDisplayLabel,
  shouldShowCallAction,
} from '../utils/tenderMonitor';
import { getTenderMonitorPalette } from '../utils/tenderMonitorTheme';
import { SENT_STATUS_VALUE } from '../utils/tenderMonitorDraft';
import { useTenderMonitorEdit } from '../hooks/useTenderMonitorEdit';
import { TenderMonitorInfo } from './TenderMonitorInfo';
import {
  ChronologyEditor,
  PackageEditor,
  ReadOnlyChronologySection,
  ReadOnlyPackageSection,
} from './TenderMonitorTabs';

const { Text } = Typography;

type ModalTab = 'info' | 'timeline' | 'package';

// iPad и другие сенсорные экраны: крупные поля (шрифт 16px — Safari не зумит форму); кнопки окна увеличивает CSS.
const isCoarsePointer = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

interface TenderMonitorModalProps {
  open: boolean;
  tender: TenderRegistryWithRelations | null;
  initialTab?: ModalTab;
  statuses: TenderStatus[];
  constructionScopes: ConstructionScope[];
  onClose: () => void;
  onQuickCall?: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  onUpdate: () => Promise<void> | void;
  /** Режим «только просмотр» — скрывает «Редактировать» и кнопку звонка (Генеральный директор, телефон) */
  readOnly?: boolean;
}

export const TenderMonitorModal: React.FC<TenderMonitorModalProps> = ({
  open,
  tender,
  initialTab = 'info',
  statuses,
  constructionScopes,
  onClose,
  onQuickCall,
  onUpdate,
  readOnly,
}) => {
  const { theme } = useTheme();
  const { isPhoneDevice } = useIsMobile();
  const palette = getTenderMonitorPalette(theme === 'dark');
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);
  // Плавная смена «просмотр ↔ редактирование»; при открытии окна — без неё, у окна своя анимация.
  const [animateMode, setAnimateMode] = useState(false);
  const edit = useTenderMonitorEdit({ tender, open, statuses, onUpdate });
  const { draft, editing } = edit;

  const modalTabKeys: ModalTab[] = ['info', 'timeline', 'package'];
  const goToTabOffset = (delta: number) => {
    const index = modalTabKeys.indexOf(activeTab);
    // Циклический переход по вкладкам модалки (последняя↔первая в обе стороны).
    const next = ((index + delta) % modalTabKeys.length + modalTabKeys.length) % modalTabKeys.length;
    if (next !== index) {
      setActiveTab(modalTabKeys[next]);
    }
  };
  const contentSwipe = useHorizontalSwipe({
    onSwipeLeft: () => goToTabOffset(1),
    onSwipeRight: () => goToTabOffset(-1),
  });

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [initialTab, open, tender?.id]);

  const chronologyItems = useMemo(() => (tender ? getChronologyItems(tender) : []), [tender]);
  const packageItems = useMemo(() => (tender ? getPackageItems(tender) : []), [tender]);

  if (!tender) {
    return null;
  }

  const dashboardStatus = getDashboardStatus(tender);
  const statusStyle = getStatusBadgeStyle(dashboardStatus);
  const canQuickCall = shouldShowCallAction(tender);
  const coarsePointer = isCoarsePointer();

  const scopeOptions = constructionScopes.map((scope) => ({
    value: scope.id,
    label: scope.name,
  }));

  const statusOptions = [
    { value: SENT_STATUS_VALUE, label: 'Направлено' },
    ...statuses.map((status) => ({ value: status.id, label: status.name })),
  ];

  const handleClose = () => {
    setAnimateMode(false);
    onClose();
  };

  const startEdit = () => {
    setAnimateMode(true);
    edit.startEdit();
  };

  const cancelEdit = () => {
    setAnimateMode(true);
    edit.cancelEdit();
  };

  const handleSave = async () => {
    setAnimateMode(true);
    if ((await edit.save()) === 'invalid') {
      setActiveTab('info');
    }
  };
  const submit = () => void handleSave();

  // Скрытая вкладка — без CSS-переходов: у antd-полей transition: all, и visibility: hidden
  // иначе срабатывает через 0,2 с — поля прошлой вкладки мелькают поверх новой.
  const panelClassName = (tab: ModalTab) => (activeTab === tab ? undefined : 'tm-modal-panel--inactive');
  const panelStyle = (tab: ModalTab): React.CSSProperties => ({
    gridArea: '1 / 1',
    minWidth: 0,
    visibility: activeTab === tab ? 'visible' : 'hidden',
    pointerEvents: activeTab === tab ? undefined : 'none',
  });

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      // При редактировании окно закрывается только кнопкой: промах мимо окна или Esc не теряют правки.
      maskClosable={!editing}
      keyboard={!editing}
      footer={null}
      closeIcon={null}
      width={860}
      centered
      styles={{
        content: {
          background: palette.cardBg,
          border: `1px solid ${palette.warningBorder}`,
          borderRadius: 14,
          padding: 0,
          overflow: 'hidden',
        },
        body: {
          padding: 0,
        },
        mask: {
          backdropFilter: 'blur(4px)',
        },
      }}
    >
      <div
        style={
          {
            padding: '18px 18px 14px',
            borderRight: `3px solid ${palette.warning}`,
            // Кнопки окна (.tm-modal-btn) — как кнопки страницы: фон секции, тонкая рамка, золотой акцент.
            '--tm-btn-bg': palette.sectionBg,
            '--tm-btn-border': palette.border,
            '--tm-btn-text': palette.textSecondary,
            '--tm-btn-muted': palette.muted,
            '--tm-accent': palette.warning,
            '--tm-accent-bg': palette.warningBg,
            '--tm-danger': palette.danger,
            '--tm-danger-bg': palette.dangerBg,
            '--tm-danger-border': palette.dangerBorder,
          } as React.CSSProperties
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div
                style={{
                  color: palette.title,
                  fontSize: 18,
                  lineHeight: 1.2,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                }}
              >
                {tender.title}
              </div>
              <Tag style={{ margin: 0, paddingInline: 8, fontSize: 11, lineHeight: '18px', ...statusStyle }}>
                {getTenderStatusDisplayLabel(tender)}
              </Tag>
            </div>
            <Text style={{ color: palette.muted, display: 'block', marginTop: 6, fontSize: 11 }}>
              {(tender.construction_scope?.name || 'Объект') + ' · ' + (tender.client_name || 'Клиент не указан')}
            </Text>
          </div>

          <Space size={6}>
            {editing ? (
              <>
                <button type="button" className="tm-modal-btn" onClick={cancelEdit} disabled={edit.saving}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="tm-modal-btn tm-modal-btn--accent"
                  onClick={submit}
                  disabled={edit.saving}
                  aria-busy={edit.saving || undefined}
                >
                  {edit.saving ? <LoadingOutlined aria-hidden /> : <SaveOutlined aria-hidden />}
                  Сохранить
                </button>
              </>
            ) : (
              <>
                {canQuickCall && onQuickCall && !readOnly ? (
                  <button type="button" className="tm-modal-btn tm-modal-btn--danger" onClick={() => void onQuickCall(tender)}>
                    <PhoneOutlined aria-hidden />
                    Позвонить
                  </button>
                ) : null}
                {!readOnly ? (
                  <button type="button" className="tm-modal-btn" onClick={startEdit}>
                    <EditOutlined aria-hidden />
                    Редактировать
                  </button>
                ) : null}
              </>
            )}
            <button type="button" className="tm-modal-btn tm-modal-btn--icon" onClick={handleClose} aria-label="Закрыть">
              <CloseOutlined aria-hidden />
            </button>
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, borderBottom: `1px solid ${palette.border}`, flexWrap: 'wrap' }}>
          {[
            { key: 'info' as const, label: 'Информация' },
            { key: 'timeline' as const, label: `Хронология (${chronologyItems.length})` },
            { key: 'package' as const, label: `Тендерный пакет (${packageItems.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                border: 'none',
                borderBottom: activeTab === tab.key ? `2px solid ${palette.warning}` : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab.key ? palette.warning : palette.muted,
                padding: '0 0 8px',
                marginRight: 14,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          {...(isPhoneDevice ? contentSwipe : {})}
          style={{ paddingTop: 14, ...(isPhoneDevice ? { touchAction: 'pan-y' as const } : {}) }}
        >
          <ConfigProvider componentSize={coarsePointer ? 'large' : undefined}>
            {/* Все три панели рендерятся всегда и накладываются в одну grid-ячейку:
                высота окна = самой высокой (Информация), активная видна и прижата к верху — окно не «прыгает». */}
            <div
              key={editing ? 'edit' : 'view'}
              className={animateMode ? 'tm-view-enter' : undefined}
              style={{ display: 'grid', gridTemplateColumns: '1fr', alignItems: 'start' }}
            >
              <div className={panelClassName('info')} style={panelStyle('info')}>
                <TenderMonitorInfo
                  tender={tender}
                  palette={palette}
                  isPhone={isPhoneDevice}
                  draft={draft?.info ?? null}
                  scopeOptions={scopeOptions}
                  statusOptions={statusOptions}
                  onChange={edit.updateInfo}
                  onSubmit={submit}
                />
              </div>

              <div className={panelClassName('timeline')} style={panelStyle('timeline')}>
                {draft ? (
                  <ChronologyEditor rows={draft.chronology} palette={palette} onChange={edit.updateChronology} onSubmit={submit} />
                ) : (
                  <ReadOnlyChronologySection items={chronologyItems} palette={palette} />
                )}
              </div>

              <div className={panelClassName('package')} style={panelStyle('package')}>
                {draft ? (
                  <PackageEditor rows={draft.packageItems} palette={palette} onChange={edit.updatePackageItems} onSubmit={submit} />
                ) : (
                  <ReadOnlyPackageSection items={packageItems} palette={palette} />
                )}
              </div>
            </div>
          </ConfigProvider>
        </div>
      </div>
    </Modal>
  );
};

export default TenderMonitorModal;
