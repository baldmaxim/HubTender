import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { Alert, Drawer, Empty, Select, Spin, theme } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspaceTabActions } from '../../contexts/WorkspaceTabsContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { buildPositionTabPath } from '../../lib/cache/workspaceTabsStorage';
import { useAutopriceList } from './hooks/useAutopriceList';
import { usePositionDetail } from './hooks/usePositionDetail';
import { useWideScreen } from './hooks/useWideScreen';
import { ReviewFilters } from './components/ReviewFilters';
import { ReviewTable } from './components/ReviewTable';
import { PositionPanel } from './components/PositionPanel';
import { getReviewCssVars } from './utils/cssVars';
import { formatDateTime } from './utils/format';
import {
  DEFAULT_FILTERS,
  calcProgress,
  canApprove,
  filterReviews,
  sortReviews,
  uniqueSections,
  type IReviewFilters,
} from './utils/reviewPolicy';
import styles from './AutopriceReview.module.css';

const DRAWER_WIDTH = 640;

const AutopriceReview: FC = () => {
  const { token } = theme.useToken();
  const { isPhone } = useIsMobile();
  const wide = useWideScreen();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openPositionTab } = useWorkspaceTabActions();
  const list = useAutopriceList();
  const [filters, setFilters] = useState<IReviewFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { tenderId, runId, reload } = list;

  useEffect(() => setSelectedId(null), [runId]);

  const detail = usePositionDetail(runId, selectedId, reload);

  const rows = useMemo(() => sortReviews(filterReviews(list.reviews, filters)), [list.reviews, filters]);
  const progress = useMemo(() => calcProgress(list.reviews), [list.reviews]);
  const sections = useMemo(() => uniqueSections(list.reviews), [list.reviews]);

  const handleOpenPosition = useCallback(
    (positionId: string) => {
      if (!tenderId) return;
      openPositionTab({ positionId, tenderId, title: 'Позиция' });
      navigate(buildPositionTabPath(positionId, tenderId));
    },
    [tenderId, openPositionTab, navigate],
  );

  const panel = (
    <PositionPanel
      detail={detail.detail}
      loading={detail.loading}
      busy={detail.busy}
      error={detail.error}
      isApprover={canApprove(user?.role_code)}
      onSave={detail.save}
      onAction={(action, okText, comment) => detail.act(action, okText, comment)}
      onOpenPosition={handleOpenPosition}
      onClose={() => setSelectedId(null)}
    />
  );

  const tenderOptions = list.tenders.map((t) => ({
    value: t.tender_id,
    label: `${t.tender_number} — ${t.title} (v${t.version})`,
  }));
  const runOptions = list.runs.map((r) => ({
    value: r.id,
    label: `${r.label ?? r.source_ref ?? 'Прогон'} · ${formatDateTime(r.imported_at)}${r.cancelled_at ? ' (отменён)' : ''}`,
  }));

  let content;
  if (list.tendersLoading) {
    content = (
      <div className={styles.center}>
        <Spin />
      </div>
    );
  } else if (list.tenders.length === 0) {
    content = (
      <Empty description="Нет тендеров с авторасценкой. Они появятся здесь после загрузки прогона авторасценки." />
    );
  } else {
    content = (
      <>
        <div className={styles.selectors}>
          <Select<string>
            className={styles.tenderSelect}
            showSearch
            optionFilterProp="label"
            value={list.tenderId ?? undefined}
            options={tenderOptions}
            placeholder="Тендер"
            onChange={list.setTenderId}
          />
          <Select<string>
            className={styles.runSelect}
            value={list.runId ?? undefined}
            options={runOptions}
            placeholder="Прогон"
            onChange={list.setRunId}
            disabled={runOptions.length === 0}
          />
        </div>
        {list.error && <Alert type="error" showIcon message={list.error} />}
        {list.runId && (
          <>
            <ReviewFilters
              filters={filters}
              sections={sections}
              progress={progress}
              shown={rows.length}
              onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            />
            <div className={styles.split}>
              <div className={styles.listArea}>
                <Spin spinning={list.loading}>
                  <ReviewTable rows={rows} selectedId={selectedId} isPhone={isPhone} onSelect={setSelectedId} />
                </Spin>
              </div>
              {wide && <aside className={styles.aside}>{selectedId ? panel : <Empty description="Выберите позицию" />}</aside>}
            </div>
          </>
        )}
        {!list.runId && !list.error && <Empty description="У тендера нет действующих прогонов авторасценки" />}
      </>
    );
  }

  return (
    <div className={styles.page} style={getReviewCssVars(token)}>
      <h2 className={styles.title}>Подтверждение авторасценки</h2>
      {content}
      {!wide && (
        <Drawer
          open={!!selectedId}
          onClose={() => setSelectedId(null)}
          width={isPhone ? '100%' : DRAWER_WIDTH}
          closable={false}
          destroyOnClose
          styles={{ body: { padding: 0 } }}
        >
          {panel}
        </Drawer>
      )}
    </div>
  );
};

export default AutopriceReview;
