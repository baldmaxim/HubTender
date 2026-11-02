import { useMemo, useState, type FC } from 'react';
import { AutoComplete, Modal } from 'antd';
import type { IPositionItem } from '../types';
import { isWorkItemType } from '../utils/itemTypes';
import { useReplaceLibrary, type ReplaceChoice } from '../hooks/useReplaceLibrary';
import styles from '../AutopriceReview.module.css';

interface IReplaceItemModalProps {
  item: IPositionItem;
  busy: boolean;
  /** true — модалку закрыть (замена удалась). */
  onConfirm: (choice: ReplaceChoice) => Promise<boolean>;
  onClose: () => void;
}

const MAX_OPTIONS = 100;

export const ReplaceItemModal: FC<IReplaceItemModalProps> = ({ item, busy, onConfirm, onClose }) => {
  const isWork = isWorkItemType(item.boq_item_type);
  const { entries, loading } = useReplaceLibrary(isWork ? 'work' : 'material');
  const [text, setText] = useState('');

  const query = text.trim().toLowerCase();
  const options = useMemo(
    () =>
      entries
        .filter((e) => !query || e.name.toLowerCase().includes(query))
        .slice(0, MAX_OPTIONS)
        .map((e) => ({ value: e.name, label: e.name })),
    [entries, query],
  );
  // Заменить можно только на точно выбранную позицию библиотеки.
  const selected = useMemo(
    () => (query ? entries.find((e) => e.name.trim().toLowerCase() === query) : undefined),
    [entries, query],
  );

  const handleOk = async (): Promise<void> => {
    if (!selected) return;
    if (await onConfirm(selected.choice)) onClose();
  };

  return (
    <Modal
      open
      centered
      title="Заменить строку"
      okText="Заменить"
      cancelText="Отмена"
      okButtonProps={{ disabled: !selected || loading }}
      confirmLoading={busy}
      onOk={() => void handleOk()}
      onCancel={busy ? undefined : onClose}
      width="min(560px, calc(100vw - 24px))"
    >
      <div className={styles.replaceCurrent}>
        <span className={styles.muted}>{isWork ? 'Текущая работа: ' : 'Текущий материал: '}</span>
        {item.name}
      </div>
      <AutoComplete
        className={styles.replaceSearch}
        autoFocus
        allowClear
        disabled={busy}
        placeholder={isWork ? 'Начните вводить новую работу…' : 'Начните вводить новый материал…'}
        options={options}
        value={text}
        onChange={setText}
        filterOption={false}
        notFoundContent={loading ? 'Загрузка…' : 'Ничего не найдено'}
      />
    </Modal>
  );
};
