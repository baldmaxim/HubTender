import type { FC } from 'react';
import { InputNumber, Radio, Switch } from 'antd';
import type { AnalogScaleMode, IAnalogHit, IAnalogTarget } from '../../../lib/api/analogs.types';
import { canVolumeRatio, formatDate, formatNumber, unitsMatch, volumeRatioHint } from '../utils/analogFormat';
import styles from '../AnalogPicker.module.css';

interface IScaleControlsProps {
  target: IAnalogTarget;
  hit: IAnalogHit;
  mode: AnalogScaleMode | null;
  factor: number | null;
  copyPrices: boolean;
  disabled: boolean;
  onMode: (m: AnalogScaleMode) => void;
  onFactor: (f: number | null) => void;
  onCopyPrices: (v: boolean) => void;
}

const ratioReason = (target: IAnalogTarget, hit: IAnalogHit): string => {
  if (!unitsMatch(target.unit_code, hit.unit_code)) {
    return `единицы не совпадают («${hit.unit_code ?? '—'}» у аналога, «${target.unit_code ?? '—'}» у вас)`;
  }
  return 'объём цели или источника не задан';
};

/** Масштаб количеств и перенос цен. По умолчанию — «по объёму» только при совпадении единиц и объёмов > 0. */
export const ScaleControls: FC<IScaleControlsProps> = ({
  target,
  hit,
  mode,
  factor,
  copyPrices,
  disabled,
  onMode,
  onFactor,
  onCopyPrices,
}) => {
  const ratioOk = canVolumeRatio(target, hit);
  const ratio = volumeRatioHint(target.volume, hit.volume);
  const priceDate = hit.tender_created_at ? formatDate(hit.tender_created_at) : null;
  return (
    <div className={styles.scale}>
      <div className={styles.sectionTitle}>Масштаб количеств</div>
      {mode === null && (
        <div className={styles.hint}>
          Единицы или объёмы не позволяют посчитать масштаб сами — выберите способ явно, без выбора предпросмотр недоступен.
        </div>
      )}
      <Radio.Group
        className={styles.radioRow}
        value={mode ?? undefined}
        disabled={disabled}
        onChange={(e) => onMode(e.target.value as AnalogScaleMode)}
      >
        <Radio value="volume_ratio" disabled={!ratioOk}>
          По объёму{ratioOk && ratio !== null ? `: × ${formatNumber(ratio, 4)} = ${formatNumber(target.volume, 3)} / ${formatNumber(hit.volume, 3)}` : ''}
          {!ratioOk && <span className={styles.muted}> — недоступно: {ratioReason(target, hit)}</span>}
        </Radio>
        <Radio value="factor">Свой коэффициент</Radio>
        {mode === 'factor' && (
          <InputNumber
            className={styles.factorInput}
            size="large"
            min={0}
            step={0.1}
            inputMode="decimal"
            placeholder="Например, 0,5"
            aria-label="Коэффициент масштаба"
            value={factor}
            disabled={disabled}
            status={factor !== null && factor <= 0 ? 'error' : undefined}
            onChange={(v) => onFactor(typeof v === 'number' ? v : null)}
          />
        )}
        <Radio value="none">Без масштабирования (как в источнике)</Radio>
      </Radio.Group>

      <div className={styles.switchRow}>
        <Switch checked={copyPrices} disabled={disabled} onChange={onCopyPrices} aria-label="Перенести исторические цены как черновые" />
        <div>
          <div>Перенести исторические цены как черновые</div>
          <div className={styles.muted}>
            Цены источника от {priceDate ?? 'неизвестной даты'} не считаются актуальными. Без переноса цены будут пустыми,
            и подтвердить позицию нельзя, пока они не заполнены.
          </div>
        </div>
      </div>
    </div>
  );
};
