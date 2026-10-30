import type { FC } from 'react';
import { Tooltip } from 'antd';
import { ItemTypeTag } from '../../../pages/AutopriceReview/components/ItemTypeTag';
import { isMaterialItemType, shortMaterialType } from '../../../pages/AutopriceReview/utils/itemTypes';
import type { IAnalogRow } from '../../../lib/api/analogs.types';
import { currencySymbol, formatDate, formatNumber } from '../utils/analogFormat';
import styles from '../AnalogPicker.module.css';

interface IItemsGridProps {
  rows: IAnalogRow[];
  /** Колонка «Сумма» (серверный расчёт предпросмотра). */
  showTotal?: boolean;
  emptyText?: string;
}

const safeHref = (url: string): string | null => (/^https?:\/\//i.test(url.trim()) ? url.trim() : null);

const priceText = (r: IAnalogRow): string =>
  r.unit_rate === null || r.unit_rate === 0 ? '—' : `${formatNumber(r.unit_rate, 2)} ${currencySymbol(r.currency_type)}`.trim();

/** Таблица строк состава: тип, название со связью материал → работа, ед., коэффициенты, цена, дата, КП. */
export const ItemsGrid: FC<IItemsGridProps> = ({ rows, showTotal = false, emptyText = 'Строк нет' }) => {
  if (rows.length === 0) return <div className={styles.muted}>{emptyText}</div>;
  const parentNames = new Map(rows.map((r) => [r.index, r.name]));
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Тип</th>
            <th>Название</th>
            <th>Ед.</th>
            <th className={styles.num}>Кол-во</th>
            <th className={styles.num}>Коэф. перев.</th>
            <th className={styles.num}>Коэф. расх.</th>
            <th className={styles.num}>Цена</th>
            {showTotal && <th className={styles.num}>Сумма</th>}
            <th>Дата цены</th>
            <th>КП</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const kind = isMaterialItemType(r.boq_item_type) ? shortMaterialType(r.material_type) : null;
            const hasPrice = r.unit_rate !== null && r.unit_rate > 0;
            const parent = r.parent_index !== null ? parentNames.get(r.parent_index) : undefined;
            return (
              <tr key={r.id ?? `i${r.index}`} className={r.is_draft ? styles.rowDraft : undefined}>
                <td>
                  <span className={styles.typeCell}>
                    <ItemTypeTag type={r.boq_item_type} />
                    {kind && <span className={styles.typeKind}>{kind}</span>}
                  </span>
                </td>
                <td className={styles.nameCell}>
                  {r.parent_index !== null ? (
                    <Tooltip title={parent ? `Привязан к работе: ${parent}` : 'Привязан к работе'}>
                      <span className={styles.childName}>
                        <span className={styles.childMark}>↳</span>
                        {r.name}
                      </span>
                    </Tooltip>
                  ) : (
                    r.name
                  )}
                </td>
                <td>{r.unit_code ?? '—'}</td>
                <td className={styles.num}>{formatNumber(r.quantity, 4)}</td>
                <td className={styles.num}>{formatNumber(r.conversion_coefficient, 4)}</td>
                <td className={styles.num}>{formatNumber(r.consumption_coefficient, 4)}</td>
                <td className={styles.num}>{priceText(r)}</td>
                {showTotal && <td className={styles.num}>{r.total_amount === null ? '—' : formatNumber(r.total_amount, 2)}</td>}
                <td>{hasPrice ? (r.quote_price_date ? formatDate(r.quote_price_date) : <span className={styles.noDate}>дата неизвестна</span>) : '—'}</td>
                <td>
                  {r.quote_link && safeHref(r.quote_link) ? (
                    <a className={styles.quoteLink} href={safeHref(r.quote_link) ?? undefined} target="_blank" rel="noopener noreferrer">
                      КП
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
