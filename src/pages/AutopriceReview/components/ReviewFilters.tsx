import { type FC } from 'react';
import { Button, Input, Progress, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { BASIS_LABELS, STATUS_LABELS } from '../constants';
import type { AutopriceBasis } from '../types';
import type { IProgress, IReviewFilters, StatusFilter } from '../utils/reviewPolicy';
import styles from '../AutopriceReview.module.css';

interface IReviewFiltersProps {
  filters: IReviewFilters;
  sections: string[];
  progress: IProgress;
  shown: number;
  onChange: (patch: Partial<IReviewFilters>) => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'not_approved', label: 'Не подтверждено' },
  { value: 'all', label: 'Все' },
  { value: 'stale', label: 'Подтверждение снято' },
  { value: 'pending', label: STATUS_LABELS.pending },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'needs_customer', label: STATUS_LABELS.needs_customer },
  { value: 'returned', label: STATUS_LABELS.returned },
  { value: 'approved', label: STATUS_LABELS.approved },
  { value: 'excluded', label: STATUS_LABELS.excluded },
];

const BASIS_OPTIONS = (Object.keys(BASIS_LABELS) as AutopriceBasis[]).map((b) => ({
  value: b,
  label: BASIS_LABELS[b],
}));

export const ReviewFilters: FC<IReviewFiltersProps> = ({ filters, sections, progress, shown, onChange }) => {
  const percent = progress.total > 0 ? Math.round((progress.approved / progress.total) * 100) : 0;
  const toggle = (key: 'hasQuestions' | 'hasFindings' | 'noPrice', label: string) => (
    <Button
      className={styles.toggle}
      type={filters[key] ? 'primary' : 'default'}
      onClick={() => onChange({ [key]: !filters[key] })}
    >
      {label}
    </Button>
  );

  return (
    <div className={styles.filters}>
      <div className={styles.progressRow}>
        <span className={styles.progressText}>
          Подтверждено {progress.approved} из {progress.total}
        </span>
        <Progress className={styles.progressBar} percent={percent} showInfo={false} size="small" />
        <span className={styles.muted}>Показано: {shown}</span>
      </div>
      <div className={styles.filterRow}>
        <Select<StatusFilter>
          className={styles.filterSelect}
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => onChange({ status })}
          popupMatchSelectWidth={false}
        />
        <Select<AutopriceBasis>
          className={styles.filterSelect}
          value={filters.basis ?? undefined}
          options={BASIS_OPTIONS}
          placeholder="Основание"
          allowClear
          onChange={(basis) => onChange({ basis: basis ?? null })}
          popupMatchSelectWidth={false}
        />
        <Select<string>
          className={styles.filterSelect}
          value={filters.section ?? undefined}
          options={sections.map((s) => ({ value: s, label: s }))}
          placeholder="Раздел"
          allowClear
          showSearch
          onChange={(section) => onChange({ section: section ?? null })}
          popupMatchSelectWidth={false}
        />
      </div>
      <div className={styles.filterRow}>
        {toggle('hasQuestions', 'Есть вопросы')}
        {toggle('hasFindings', 'Есть находки')}
        {toggle('noPrice', 'Без цены')}
        <Input
          className={styles.search}
          prefix={<SearchOutlined />}
          placeholder="Номер или наименование"
          allowClear
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>
    </div>
  );
};
