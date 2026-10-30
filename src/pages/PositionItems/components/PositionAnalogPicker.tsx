import { useCallback, type FC, type RefObject } from 'react';
import { App, Button } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { AnalogPicker } from '../../../components/AnalogPicker';
import styles from './PositionAnalogPicker.module.css';

interface IAnalogOpenButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/** Кнопка входа «Подобрать аналог» (тулбар десктопа и заголовок карточки на телефоне). */
export const AnalogOpenButton: FC<IAnalogOpenButtonProps> = ({ onClick, disabled }) => (
  <Button type="primary" icon={<BranchesOutlined />} className={styles.openBtn} onClick={onClick} disabled={disabled}>
    Подобрать аналог
  </Button>
);

interface IPositionAnalogPickerProps {
  open: boolean;
  positionId: string;
  onClose: () => void;
  /** Строки позиции изменились (аналог применён или отменён). */
  onItemsChanged: () => void;
  /** Блок ручного добавления строк — прокрутить к нему при «Подходящего аналога нет». */
  addFormRef: RefObject<HTMLElement>;
}

/** AnalogPicker с привязкой к странице позиции: перечитывание строк и переход к ручному составлению. */
export const PositionAnalogPicker: FC<IPositionAnalogPickerProps> = ({
  open,
  positionId,
  onClose,
  onItemsChanged,
  addFormRef,
}) => {
  const { message } = App.useApp();

  const handleManual = useCallback(() => {
    const el = addFormRef.current;
    if (!el) {
      message.info('Составьте позицию вручную');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [addFormRef, message]);

  return (
    <AnalogPicker
      open={open}
      positionId={positionId}
      onClose={onClose}
      onApplied={onItemsChanged}
      onReverted={onItemsChanged}
      onManual={handleManual}
    />
  );
};
