import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { Alert, Segmented, Skeleton, Switch, Typography, theme as antdTheme } from 'antd';
import dayjs from 'dayjs';
import { fetchPageStats } from '../../../lib/api/usage';
import type { IPageStats } from '../../../lib/api/usage';
import { getErrorMessage } from '../../../utils/errors';
import { UsageHeatmap } from './components/UsageHeatmap';
import { buildUsageTable, OTHER_GROUP, sortUsageRows } from './utils/buildUsageRows';
import { getUsageCssVars } from './utils/cssVars';
import styles from './Usage.module.css';

type Period = 7 | 30 | 90;

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
];

/** Для 90 дней колонки по неделям, иначе карта не помещается. */
const WEEKLY_FROM_DAYS = 90;

const Usage: FC = () => {
  const { token } = antdTheme.useToken();
  const [days, setDays] = useState<Period>(30);
  const [unusedFirst, setUnusedFirst] = useState(false);
  const [stats, setStats] = useState<IPageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPageStats(days)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const byWeek = days >= WEEKLY_FROM_DAYS;

  const table = useMemo(() => {
    if (!stats) return null;
    const built = buildUsageTable(stats, byWeek);
    return { ...built, rows: sortUsageRows(built.rows, unusedFirst) };
  }, [stats, byWeek, unusedFirst]);

  const summary = useMemo(() => {
    if (!stats || !table) return '';
    const menuRows = table.rows.filter((r) => r.group !== OTHER_GROUP);
    const unused = menuRows.filter((r) => r.views === 0).length;
    const total = stats.pages.reduce((sum, p) => sum + p.views, 0);
    const period = `${dayjs(stats.from).format('DD.MM.YYYY')} — ${dayjs(stats.to).format('DD.MM.YYYY')}`;
    return `${period}. Просмотров: ${total}. Страниц меню: ${menuRows.length}, не открывали: ${unused}.`;
  }, [stats, table]);

  return (
    <div className={styles.page} style={getUsageCssVars(token)}>
      <div>
        <Typography.Title level={4} className={styles.title}>
          Использование портала
        </Typography.Title>
        <p className={styles.subtitle}>
          Просмотры страниц по дням (по Москве): чем темнее ячейка, тем чаще страницу открывали.
        </p>
      </div>

      <div className={styles.toolbar}>
        <Segmented<Period> options={PERIOD_OPTIONS} value={days} onChange={setDays} />
        <label className={styles.switchLabel}>
          <Switch checked={unusedFirst} onChange={setUnusedFirst} />
          Сначала неиспользуемые
        </label>
      </div>

      {error && <Alert type="error" showIcon message="Не удалось загрузить статистику" description={error} />}
      {summary && <div className={styles.summary}>{summary}</div>}

      {loading && !table ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        table && (
          <UsageHeatmap
            buckets={table.buckets}
            rows={table.rows}
            maxCellViews={table.maxCellViews}
            byWeek={byWeek}
          />
        )
      )}
    </div>
  );
};

export default Usage;
