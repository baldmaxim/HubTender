import type { ReactNode } from 'react';
import { Tag, Tooltip } from 'antd';
import { CHANGED_TO_COLUMN } from '../constants';
import type { IPositionItem } from '../types';
import { formatNumber } from '../utils/format';
import { isLinkedToWork, isMaterialItemType } from '../utils/itemTypes';
import type { EditableFieldKey } from '../../PositionItems/utils/boqFieldPatch';
import { ItemTypeCell } from './ItemTypeTag';
import { InlineNumberCell } from './InlineNumberCell';
import { InlineMaterialTypeSelect } from './InlineMaterialTypeSelect';
import styles from '../AutopriceReview.module.css';

type ColumnKind = 'type' | 'name' | 'unit_rate' | 'conversion' | 'consumption';

/** Правка строк прямо в таблице; без пропа таблица только показывает текст. */
export interface IItemsEditing {
  /** Строки BOQ позиции загружены. */
  ready: boolean;
  /** Срок редактирования не истёк. */
  canEdit: boolean;
  saveField: (itemId: string, key: EditableFieldKey, draft: unknown) => Promise<void>;
}

const machineValue = (item: IPositionItem, kind: ColumnKind): string => {
  const m = item.machine;
  if (!m) return '—';
  switch (kind) {
    case 'type':
      return m.material_type || '—';
    case 'name':
      return m.name || '—';
    case 'unit_rate':
      return formatNumber(m.unit_rate);
    case 'conversion':
      return formatNumber(m.conversion_coefficient, 4);
    case 'consumption':
      return formatNumber(m.consumption_coefficient, 4);
  }
};

/** Ячейка; если поле изменено относительно машины — подсветка и подсказка «машина: X». */
const cell = (item: IPositionItem, kind: ColumnKind, content: ReactNode, fill = false): ReactNode => {
  if (!item.changed.some((f) => CHANGED_TO_COLUMN[f] === kind)) return content;
  return (
    <Tooltip title={`машина: ${machineValue(item, kind)}`}>
      <span className={fill ? `${styles.changedCell} ${styles.changedFill}` : styles.changedCell}>{content}</span>
    </Tooltip>
  );
};

const canEditRows = (editing?: IItemsEditing): editing is IItemsEditing =>
  !!editing && editing.ready && editing.canEdit;

const numberInput = (
  editing: IItemsEditing,
  item: IPositionItem,
  key: EditableFieldKey,
  value: number | null,
  digits: number,
  ariaLabel: string,
  invalid = false,
): ReactNode => (
  <InlineNumberCell
    value={value}
    digits={digits}
    invalid={invalid}
    ariaLabel={`${ariaLabel}: ${item.name}`}
    onCommit={(next) => editing.saveField(item.id, key, next)}
  />
);

export const renderTypeCell = (item: IPositionItem, works: Set<string>, editing?: IItemsEditing): ReactNode => {
  const linked = isLinkedToWork(item, works);
  if (!canEditRows(editing) || !isMaterialItemType(item.boq_item_type)) {
    return cell(item, 'type', <ItemTypeCell item={item} linked={linked} />);
  }
  const select = (
    <InlineMaterialTypeSelect
      value={item.material_type}
      ariaLabel={`Вид материала: ${item.name}`}
      onCommit={(next) => editing.saveField(item.id, 'material_type', next)}
    />
  );
  return <ItemTypeCell item={item} linked={linked} kindControl={cell(item, 'type', select, true)} />;
};

export const renderNameCell = (item: IPositionItem, works: Set<string>): ReactNode => {
  const linked = isLinkedToWork(item, works);
  return (
    <span className={`${styles.itemName} ${linked ? styles.childName : ''}`}>
      {linked && <span className={styles.childMark}>↳</span>}
      {cell(item, 'name', item.name)}
      {item.origin === 'manual' && <Tag color="blue">добавлено</Tag>}
    </span>
  );
};

/** Кол-во: у привязанного материала — расчётное (только текст). */
export const renderQtyCell = (item: IPositionItem, editing?: IItemsEditing): ReactNode => {
  if (!canEditRows(editing) || item.parent_work_item_id) return formatNumber(item.quantity, 4);
  return numberInput(editing, item, 'quantity', item.quantity, 5, 'Количество');
};

export const renderPriceCell = (item: IPositionItem, editing?: IItemsEditing): ReactNode => {
  if (!canEditRows(editing)) {
    return item.unit_rate === 0 ? (
      <span className={styles.danger}>0</span>
    ) : (
      cell(item, 'unit_rate', formatNumber(item.unit_rate))
    );
  }
  return cell(
    item,
    'unit_rate',
    numberInput(editing, item, 'unit_rate', item.unit_rate, 2, 'Цена', item.unit_rate === 0),
    true,
  );
};

/** Перев.: коэффициент перевода есть только у привязанного материала (как в листе). */
export const renderConvCell = (item: IPositionItem, editing?: IItemsEditing): ReactNode => {
  if (!canEditRows(editing)) return cell(item, 'conversion', formatNumber(item.conversion_coefficient, 4));
  if (!isMaterialItemType(item.boq_item_type)) return '—';
  if (!item.parent_work_item_id) {
    return cell(item, 'conversion', formatNumber(item.conversion_coefficient, 4));
  }
  return cell(
    item,
    'conversion',
    numberInput(editing, item, 'conversion_coefficient', item.conversion_coefficient, 5, 'Коэффициент перевода'),
    true,
  );
};

export const renderConsCell = (item: IPositionItem, editing?: IItemsEditing): ReactNode => {
  if (!canEditRows(editing)) return cell(item, 'consumption', formatNumber(item.consumption_coefficient, 4));
  if (!isMaterialItemType(item.boq_item_type)) return '—';
  return cell(
    item,
    'consumption',
    numberInput(editing, item, 'consumption_coefficient', item.consumption_coefficient, 5, 'Коэффициент расхода'),
    true,
  );
};
