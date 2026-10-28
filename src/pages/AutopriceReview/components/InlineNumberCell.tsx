import { useRef, useState, type FC, type KeyboardEvent } from 'react';
import { App, InputNumber } from 'antd';
import { getErrorMessage } from '../../../utils/errors';
import styles from '../AutopriceReview.module.css';

interface IInlineNumberCellProps {
  value: number | null;
  disabled?: boolean;
  /** Знаков после запятой при сохранении (округление введённого). */
  digits: number;
  /** Красная рамка (например, нулевая цена). */
  invalid?: boolean;
  /** Сохранить; ошибка отклоняет промис — ячейка откатывается. */
  onCommit: (next: number | null) => Promise<void>;
  ariaLabel: string;
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

// Пустое поле даёт NaN (parseFloat('')) — приводим к null, дальше решает validateField.
const parseInput = (value: string | undefined): number =>
  parseFloat((value ?? '').replace(/\s/g, '').replace(/,/g, '.'));

/**
 * Числовое поле прямо в ячейке: всегда открыто, сохраняет по Enter и blur
 * (только если значение изменилось), Esc — откат. `draft === undefined` значит
 * «пользователь не правит»: показываем серверное значение, поэтому после
 * перезагрузки данных новое значение подхватывается само.
 */
export const InlineNumberCell: FC<IInlineNumberCellProps> = ({
  value,
  disabled = false,
  digits,
  invalid = false,
  onCommit,
  ariaLabel,
}) => {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // Esc: blur() вызывает onBlur со старым draft из замыкания — флаг отменяет этот commit.
  const cancelledRef = useRef(false);

  const commit = async (): Promise<void> => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (draft === undefined || saving) return;
    const next = draft === null ? null : round(draft, digits);
    const current = value === null ? null : round(value, digits);
    if (next === current) {
      setDraft(undefined);
      return;
    }
    setSaving(true);
    try {
      await onCommit(next);
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setDraft(undefined);
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      cancelledRef.current = draft !== undefined;
      setDraft(undefined);
      e.currentTarget.blur();
    }
  };

  return (
    <InputNumber
      className={styles.inlineNum}
      size="small"
      controls={false}
      value={draft === undefined ? value : draft}
      disabled={disabled || saving}
      status={invalid ? 'error' : undefined}
      aria-label={ariaLabel}
      inputMode="decimal"
      decimalSeparator=","
      // type="number" нельзя: запятая-разделитель + parser требуют текстового инпута.
      // min/max не задаём: rc-input-number не эмитит onChange для значений вне диапазона.
      parser={parseInput}
      onChange={(v) => setDraft(typeof v === 'number' && Number.isFinite(v) ? v : null)}
      onPressEnter={() => void commit()}
      onBlur={() => void commit()}
      onKeyDown={handleKeyDown}
    />
  );
};
