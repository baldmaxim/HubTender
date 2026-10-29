import { type FC } from 'react';
import { Checkbox, Select } from 'antd';
import {
  UNPRICED_REASON_OPTIONS,
  type IUnpricedFilters,
  type UnpricedReasonFilter,
} from '../utils/unpricedPolicy';
import styles from '../AutopriceReview.module.css';

interface IUnpricedFiltersProps {
  filters: IUnpricedFilters;
  shown: number;
  total: number;
  onChange: (patch: Partial<IUnpricedFilters>) => void;
}

export const UnpricedFilters: FC<IUnpricedFiltersProps> = ({ filters, shown, total, onChange }) => (
  <div className={styles.filters}>
    <div className={styles.unpricedRow}>
      <Select<UnpricedReasonFilter>
        className={styles.filterSelect}
        value={filters.reason ?? undefined}
        options={UNPRICED_REASON_OPTIONS}
        placeholder="Причина"
        allowClear
        onChange={(reason) => onChange({ reason: reason ?? null })}
        popupMatchSelectWidth={false}
      />
      <Checkbox
        className={styles.unpricedCheck}
        checked={filters.showHeaders}
        onChange={(e) => onChange({ showHeaders: e.target.checked })}
      >
        Показывать заголовки и позиции без объёма
      </Checkbox>
      <span className={styles.muted}>
        Показано: {shown} из {total}
      </span>
    </div>
  </div>
);
