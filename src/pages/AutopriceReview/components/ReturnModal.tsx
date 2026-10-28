import { useEffect, useState, type FC } from 'react';
import { Input, Modal } from 'antd';
import styles from '../AutopriceReview.module.css';

interface IReturnModalProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

export const ReturnModal: FC<IReturnModalProps> = ({ open, busy, onCancel, onSubmit }) => {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const trimmed = reason.trim();
  return (
    <Modal
      open={open}
      title="Вернуть позицию"
      okText="Вернуть"
      cancelText="Отмена"
      okButtonProps={{ disabled: !trimmed, loading: busy }}
      onOk={() => onSubmit(trimmed)}
      onCancel={onCancel}
    >
      <Input.TextArea
        className={styles.input}
        autoFocus
        allowClear
        autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="Причина возврата (обязательно)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
};
