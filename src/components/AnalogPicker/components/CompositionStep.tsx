import { useState, type FC } from 'react';
import { Alert, Button, Segmented, Spin } from 'antd';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { IAnalogHit, IAnalogSource, IAnalogTarget } from '../../../lib/api/analogs.types';
import { useAnalogSource } from '../hooks/useAnalogSource';
import { formatNumber } from '../utils/analogFormat';
import { ItemsGrid } from './ItemsGrid';
import styles from '../AnalogPicker.module.css';

interface ICompositionStepProps {
  target: IAnalogTarget;
  hit: IAnalogHit;
  onBack: () => void;
  onChoose: (hit: IAnalogHit) => void;
  onNoAnalog: () => void;
}

type Pane = 'target' | 'source';

const SourceHead: FC<{ source: IAnalogSource; hit: IAnalogHit }> = ({ source, hit }) => {
  const t = source.tender;
  const note = [source.position.client_note, source.position.manual_note].filter((x): x is string => !!x && x.trim() !== '');
  return (
    <div className={styles.stack}>
      <div className={styles.sectionTitle}>Аналог</div>
      <div className={styles.targetName}>{source.position.work_name}</div>
      <div className={styles.muted}>
        Тендер № {t.tender_number ?? '—'}{t.version ? ` v${t.version}` : ''}
        {[t.object_name ?? t.title, t.client_name].filter(Boolean).map((x) => ` · ${x}`).join('')}
      </div>
      <div className={styles.chips}>
        <span>Ед.: <b>{source.position.unit_code ?? hit.unit_code ?? '—'}</b></span>
        <span>Объём: <b>{source.position.volume === null ? '—' : formatNumber(source.position.volume, 3)}</b></span>
      </div>
      {note.length > 0 && <div className={styles.muted}>Примечание: {note.join(' · ')}</div>}
    </div>
  );
};

/** Шаг «Состав»: цель и источник рядом (на узком экране — переключатель), таблицы строк. */
export const CompositionStep: FC<ICompositionStepProps> = ({ target, hit, onBack, onChoose, onNoAnalog }) => {
  const { screens } = useIsMobile();
  const compact = !screens.lg;
  const [pane, setPane] = useState<Pane>('source');
  const { source, loading, error } = useAnalogSource(hit.position_id);

  const targetPane = (
    <div className={styles.pane}>
      <div className={styles.sectionTitle}>Моя позиция</div>
      <div className={styles.targetName}>{target.work_name}</div>
      <div className={styles.chips}>
        <span>Ед.: <b>{target.unit_code ?? '—'}</b></span>
        <span>Объём: <b>{target.volume === null ? '—' : formatNumber(target.volume, 3)}</b></span>
      </div>
      {[target.client_note, target.manual_note].some((x) => !!x) && (
        <div className={styles.muted}>Примечание: {[target.client_note, target.manual_note].filter(Boolean).join(' · ')}</div>
      )}
      <ItemsGrid rows={target.items} emptyText="Состава пока нет — его заполнит аналог." />
    </div>
  );

  const sourcePane = (
    <div className={styles.pane}>
      {loading && (
        <div className={styles.center}>
          <Spin />
        </div>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {source && (
        <>
          <SourceHead source={source} hit={hit} />
          <ItemsGrid rows={source.items} emptyText="В позиции-источнике нет строк." />
        </>
      )}
    </div>
  );

  return (
    <>
      <div className={styles.scroll}>
        <div className={styles.hint}>
          Похожее название ≠ подходящий состав — сверьте технологию (монолит/сборные и т.п.).
        </div>
        {compact ? (
          <>
            <Segmented<Pane>
              block
              className={styles.paneSwitch}
              size="large"
              value={pane}
              onChange={setPane}
              options={[
                { label: 'Моя позиция', value: 'target' },
                { label: 'Аналог', value: 'source' },
              ]}
            />
            {pane === 'target' ? targetPane : sourcePane}
          </>
        ) : (
          <div className={styles.panes}>
            {targetPane}
            {sourcePane}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <Button className={styles.btn} onClick={onBack}>
          Назад к кандидатам
        </Button>
        <Button className={styles.btn} onClick={onNoAnalog}>
          Подходящего аналога нет
        </Button>
        <span className={styles.footerSpacer} />
        <Button className={styles.btn} type="primary" onClick={() => onChoose(hit)}>
          Выбрать для предпросмотра
        </Button>
      </div>
    </>
  );
};
