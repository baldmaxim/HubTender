import type { FC } from 'react';
import { Alert, Button } from 'antd';
import type { IAnalogApplyResult, IAnalogHit, IAnalogTarget } from '../../../lib/api/analogs.types';
import { useAnalogPreview } from '../hooks/useAnalogPreview';
import { TargetSummary } from './TargetSummary';
import { ScaleControls } from './ScaleControls';
import { PreviewResult } from './PreviewResult';
import styles from '../AnalogPicker.module.css';

interface IPreviewStepProps {
  positionId: string;
  target: IAnalogTarget;
  hit: IAnalogHit;
  onBack: () => void;
  onNoAnalog: () => void;
  onApplied: (result: IAnalogApplyResult) => void;
  /** «Открыть состав позиции» из ошибки ANALOG_TARGET_HAS_ROWS. */
  onOpenItems: () => void;
}

/** Шаги «Предпросмотр» и «Применить аналог»: масштаб, цены, предпросмотр сервера, применение. */
export const PreviewStep: FC<IPreviewStepProps> = ({ positionId, target, hit, onBack, onNoAnalog, onApplied, onOpenItems }) => {
  const p = useAnalogPreview(positionId, target, hit);
  const busy = p.loading || p.applying;

  const handleApply = async () => {
    const result = await p.runApply();
    if (result) onApplied(result);
  };

  return (
    <>
      <div className={styles.scroll}>
        <TargetSummary target={target} compact />
        <div className={styles.card}>
          <div className={styles.muted}>Аналог</div>
          <div className={styles.title}>{hit.work_name}</div>
          <div className={styles.muted}>
            Тендер № {hit.tender_number ?? '—'}{hit.tender_version ? ` v${hit.tender_version}` : ''} · ед. {hit.unit_code ?? '—'} · строк {hit.items_count}
          </div>
        </div>

        <ScaleControls
          target={target}
          hit={hit}
          mode={p.mode}
          factor={p.factor}
          copyPrices={p.copyPrices}
          disabled={busy}
          onMode={p.setMode}
          onFactor={p.setFactor}
          onCopyPrices={p.setCopyPrices}
        />

        {p.notice && (
          <Alert
            type={p.notice.type}
            showIcon
            message={p.notice.text}
            action={
              p.notice.openItems ? (
                <Button className={styles.btn} size="small" onClick={onOpenItems}>
                  Открыть состав позиции
                </Button>
              ) : undefined
            }
          />
        )}

        {p.preview && <PreviewResult preview={p.preview} />}
      </div>
      <div className={styles.footer}>
        <Button className={styles.btn} disabled={busy} onClick={onBack}>
          Назад
        </Button>
        <Button className={styles.btn} disabled={busy} onClick={onNoAnalog}>
          Подходящего аналога нет
        </Button>
        <span className={styles.footerSpacer} />
        <Button
          className={styles.btn}
          type={p.preview ? 'default' : 'primary'}
          loading={p.loading}
          disabled={!p.ready || p.applying}
          onClick={() => void p.runPreview()}
        >
          Предпросмотр
        </Button>
        {p.preview && (
          <Button
            className={styles.btn}
            type="primary"
            loading={p.applying}
            disabled={!p.preview.can_apply || p.loading}
            onClick={() => void handleApply()}
          >
            Применить аналог
          </Button>
        )}
      </div>
    </>
  );
};
