import { useState } from 'react';
import type { FC } from 'react';
import { Input } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import styles from './ObjectPhotosDrawer.module.css';

const MAX_CAPTION = 200;

interface IPhotoCaptionProps {
  value: string | null;
  editable: boolean;
  onSave: (caption: string) => Promise<boolean>;
}

/** Подпись под фото; при editable — правка по клику (Enter/потеря фокуса сохраняет, Esc отменяет). */
export const PhotoCaption: FC<IPhotoCaptionProps> = ({ value, editable, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!editable) {
    return value ? <div className={styles.caption}>{value}</div> : null;
  }

  const start = () => {
    setDraft(value ?? '');
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    if (draft.trim() === (value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        allowClear
        className={styles.captionInput}
        value={draft}
        maxLength={MAX_CAPTION}
        disabled={saving}
        placeholder="Подпись к фото"
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={() => void commit()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <button type="button" className={styles.captionButton} onClick={start}>
      <span className={value ? styles.captionText : styles.captionEmpty}>{value ?? 'Добавить подпись'}</span>
      <EditOutlined className={styles.captionIcon} />
    </button>
  );
};
