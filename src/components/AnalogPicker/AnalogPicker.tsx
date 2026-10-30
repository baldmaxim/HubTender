import { useCallback, useEffect, useState, type FC } from 'react';
import { Drawer, Modal, theme } from 'antd';
import { useIsMobile } from '../../hooks/useIsMobile';
import { notifyAutopriceTendersChanged } from '../../lib/api/autoprice';
import { buildPositionTabPath } from '../../lib/cache/workspaceTabsStorage';
import type { IAnalogApplyResult, IAnalogHit } from '../../lib/api/analogs.types';
import { useAnalogSearch } from './hooks/useAnalogSearch';
import { CandidatesStep } from './components/CandidatesStep';
import { CompositionStep } from './components/CompositionStep';
import { PreviewStep } from './components/PreviewStep';
import { DoneStep } from './components/DoneStep';
import { getAnalogCssVars } from './utils/cssVars';
import styles from './AnalogPicker.module.css';

export interface IAnalogPickerProps {
  open: boolean;
  /** Стартовая целевая позиция; внутри можно перейти к следующей без состава. */
  positionId: string;
  onClose: () => void;
  onApplied?: (result: IAnalogApplyResult) => void;
  /** Применение отменено (из «Истории аналогов» или с экрана «Черновик сохранён»): строки позиции изменились. */
  onReverted?: () => void;
  /** «Подходящего аналога нет»: позиция остаётся в расценивании, ничего не пишем. */
  onManual?: () => void;
}

type Step = 'candidates' | 'composition' | 'preview' | 'done';

interface IBodyProps extends Omit<IAnalogPickerProps, 'open' | 'positionId'> {
  targetId: string;
  startPositionId: string;
  variant: 'modal' | 'drawer';
  onSwitchTarget: (positionId: string) => void;
}

/** Содержимое: один экземпляр на целевую позицию (смена цели — новый key, всё с нуля). */
const AnalogPickerBody: FC<IBodyProps> = ({
  targetId,
  startPositionId,
  variant,
  onClose,
  onApplied,
  onReverted,
  onManual,
  onSwitchTarget,
}) => {
  const { token } = theme.useToken();
  const search = useAnalogSearch(targetId);
  const [step, setStep] = useState<Step>('candidates');
  const [hit, setHit] = useState<IAnalogHit | null>(null);
  const [result, setResult] = useState<IAnalogApplyResult | null>(null);
  const target = search.data?.target ?? null;
  const { refresh } = search;

  const handleNoAnalog = useCallback(() => {
    onManual?.();
    onClose();
  }, [onManual, onClose]);

  const handleOpenItems = useCallback(() => {
    if (targetId === startPositionId || !target) {
      onClose();
      return;
    }
    window.open(buildPositionTabPath(targetId, target.tender_id), '_blank', 'noopener,noreferrer');
  }, [targetId, startPositionId, target, onClose]);

  const handleReverted = useCallback(() => {
    refresh();
    onReverted?.();
  }, [refresh, onReverted]);

  let content = null;
  if (step === 'done' && result) {
    content = (
      <DoneStep
        positionId={targetId}
        result={result}
        onClose={onClose}
        onNext={onSwitchTarget}
        onReverted={() => {
          setResult(null);
          setStep('candidates');
          handleReverted();
        }}
      />
    );
  } else if (step === 'composition' && hit && target) {
    content = (
      <CompositionStep
        target={target}
        hit={hit}
        onBack={() => setStep('candidates')}
        onChoose={(h) => {
          setHit(h);
          setStep('preview');
        }}
        onNoAnalog={handleNoAnalog}
      />
    );
  } else if (step === 'preview' && hit && target) {
    content = (
      <PreviewStep
        key={hit.position_id}
        positionId={targetId}
        target={target}
        hit={hit}
        onBack={() => setStep('candidates')}
        onNoAnalog={handleNoAnalog}
        onOpenItems={handleOpenItems}
        onApplied={(res) => {
          setResult(res);
          setStep('done');
          notifyAutopriceTendersChanged();
          onApplied?.(res);
        }}
      />
    );
  } else {
    content = (
      <CandidatesStep
        search={search}
        positionId={targetId}
        onViewItems={(h) => {
          setHit(h);
          setStep('composition');
        }}
        onChoose={(h) => {
          setHit(h);
          setStep('preview');
        }}
        onNoAnalog={handleNoAnalog}
        onClose={onClose}
        onReverted={handleReverted}
      />
    );
  }

  return (
    <div
      className={`${styles.root} ${variant === 'drawer' ? styles.rootDrawer : styles.rootModal}`}
      style={getAnalogCssVars(token)}
    >
      {content}
    </div>
  );
};

/**
 * «Подобрать аналог»: поиск похожей позиции в архиве → состав → предпросмотр → применение черновиком.
 * Десктоп/планшет — Modal, телефон — Drawer на весь экран.
 */
export const AnalogPicker: FC<IAnalogPickerProps> = ({ open, positionId, ...rest }) => {
  const { isPhoneDevice } = useIsMobile();
  const [targetId, setTargetId] = useState(positionId);

  useEffect(() => {
    if (open) setTargetId(positionId);
  }, [open, positionId]);

  const body = (
    <AnalogPickerBody
      key={targetId}
      {...rest}
      targetId={targetId}
      startPositionId={positionId}
      variant={isPhoneDevice ? 'drawer' : 'modal'}
      onSwitchTarget={setTargetId}
    />
  );

  if (isPhoneDevice) {
    return (
      <Drawer
        open={open}
        onClose={rest.onClose}
        title="Подбор аналога"
        placement="right"
        width="100%"
        rootClassName={styles.drawer}
        destroyOnClose
      >
        {body}
      </Drawer>
    );
  }
  return (
    <Modal
      open={open}
      onCancel={rest.onClose}
      title="Подбор аналога"
      footer={null}
      width="min(1280px, 96vw)"
      centered
      rootClassName={styles.modal}
      destroyOnClose
    >
      {body}
    </Modal>
  );
};
