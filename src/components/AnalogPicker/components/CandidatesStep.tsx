import type { FC } from 'react';
import { Alert, Button, Input, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { IAnalogHit } from '../../../lib/api/analogs.types';
import type { useAnalogSearch } from '../hooks/useAnalogSearch';
import { TargetSummary } from './TargetSummary';
import { CandidateCard } from './CandidateCard';
import { AnalogHistory } from './AnalogHistory';
import styles from '../AnalogPicker.module.css';

interface ICandidatesStepProps {
  search: ReturnType<typeof useAnalogSearch>;
  positionId: string;
  onViewItems: (hit: IAnalogHit) => void;
  onChoose: (hit: IAnalogHit) => void;
  onNoAnalog: () => void;
  onClose: () => void;
  onReverted: () => void;
}

/** Шаг «Кандидаты»: сводка цели, поиск, карточки, «Показать ещё», история аналогов. */
export const CandidatesStep: FC<ICandidatesStepProps> = ({
  search,
  positionId,
  onViewItems,
  onChoose,
  onNoAnalog,
  onClose,
  onReverted,
}) => {
  const { data, loading, error, query, setQuery, submit, showMore, canShowMore } = search;
  return (
    <>
      <div className={styles.scroll}>
        {data && <TargetSummary target={data.target} />}

        <div className={styles.searchRow}>
          <Input
            className={styles.searchInput}
            size="large"
            allowClear
            value={query}
            maxLength={500}
            placeholder="Что искать: название работы"
            aria-label="Поисковая фраза"
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={submit}
          />
          <Button className={styles.btn} type="primary" icon={<SearchOutlined />} loading={loading} onClick={submit}>
            Найти
          </Button>
        </div>

        {error && <Alert type="error" showIcon message={error} />}

        <Spin spinning={loading && !!data}>
          <div className={styles.hits}>
            {data?.hits.map((hit) => (
              <CandidateCard
                key={hit.position_id}
                hit={hit}
                targetUnit={data.target.unit_code}
                onViewItems={onViewItems}
                onChoose={onChoose}
              />
            ))}
            {data && data.hits.length === 0 && !loading && (
              <div className={styles.empty}>
                Подходящих позиций в архиве не найдено. Измените поисковую фразу (короче, без размеров) или составьте позицию вручную.
              </div>
            )}
            {!data && loading && (
              <div className={styles.center}>
                <Spin />
              </div>
            )}
          </div>
        </Spin>

        {canShowMore && (
          <Button className={styles.btn} onClick={showMore} loading={loading}>
            Показать ещё
          </Button>
        )}

        {data && data.hits.length > 0 && (
          <div className={styles.muted}>
            «Сходство названия» — похожесть формулировок, а не вероятность того, что состав подходит. Сверяйте технологию.
          </div>
        )}

        <AnalogHistory positionId={positionId} onReverted={onReverted} />
      </div>
      <div className={styles.footer}>
        <Button className={styles.btn} onClick={onNoAnalog}>
          Подходящего аналога нет
        </Button>
        <span className={styles.footerSpacer} />
        <Button className={styles.btn} onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </>
  );
};
