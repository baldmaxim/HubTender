import { useState, type FC } from 'react';
import { App, Select } from 'antd';
import { getErrorMessage } from '../../../utils/errors';
import styles from '../AutopriceReview.module.css';

interface IInlineMaterialTypeSelectProps {
  /** material_type с сервера: «основн.» / «вспомогат.» или null. */
  value: string | null;
  disabled?: boolean;
  /** Сохранить выбранный вид; ошибка отклоняет промис — выбор откатывается. */
  onCommit: (next: string) => Promise<void>;
  ariaLabel: string;
}

const OPTIONS = [
  { value: 'основн.', label: 'осн.' },
  { value: 'вспомогат.', label: 'вспом.' },
];

const normalize = (v: string | null): string | undefined =>
  !v ? undefined : v.startsWith('осн') ? 'основн.' : v.startsWith('вспом') ? 'вспомогат.' : v;

/** Вид материала прямо в строке: сохраняется сразу при выборе. */
export const InlineMaterialTypeSelect: FC<IInlineMaterialTypeSelectProps> = ({
  value,
  disabled = false,
  onCommit,
  ariaLabel,
}) => {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: string): Promise<void> => {
    if (next === normalize(value)) return;
    setSaving(true);
    try {
      await onCommit(next);
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select
      className={styles.inlineSelect}
      size="small"
      value={normalize(value)}
      options={OPTIONS}
      disabled={disabled}
      loading={saving}
      popupMatchSelectWidth={false}
      aria-label={ariaLabel}
      onChange={(next) => void handleChange(next)}
    />
  );
};
