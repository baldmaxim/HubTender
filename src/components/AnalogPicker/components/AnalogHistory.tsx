import { useCallback, useState, type FC } from 'react';
import { App, Button, Collapse, Popconfirm, Spin, Tag } from 'antd';
import {
  analogErrorMessage,
  fetchAnalogApplications,
  revertAnalogApplication,
} from '../../../lib/api/analogs';
import type { IAnalogApplication } from '../../../lib/api/analogs.types';
import { formatDateTime, formatNumber } from '../utils/analogFormat';
import styles from '../AnalogPicker.module.css';

interface IAnalogHistoryProps {
  positionId: string;
  /** Применение отменено: строки позиции изменились. */
  onReverted: () => void;
}

const STATUS_TEXT: Record<IAnalogApplication['status'], { text: string; color: string }> = {
  applied: { text: 'применено', color: 'green' },
  superseded: { text: 'заменено', color: 'default' },
  reverted: { text: 'отменено', color: 'orange' },
};

const SCALE_TEXT: Record<string, string> = {
  volume_ratio: 'по объёму',
  factor: 'коэффициент',
  none: 'без масштабирования',
};

/** «История аналогов» позиции — свёрнутый блок; грузится при первом раскрытии. */
export const AnalogHistory: FC<IAnalogHistoryProps> = ({ positionId, onReverted }) => {
  const { message } = App.useApp();
  const [items, setItems] = useState<IAnalogApplication[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchAnalogApplications(positionId));
    } catch (e) {
      setError(analogErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [positionId]);

  const handleRevert = async (id: string) => {
    setBusyId(id);
    try {
      await revertAnalogApplication(id);
      message.success('Применение аналога отменено');
      onReverted();
      await load();
    } catch (e) {
      message.error(analogErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Collapse
      size="small"
      onChange={(keys) => {
        if (keys.length > 0 && items === null && !loading) void load();
      }}
      items={[
        {
          key: 'history',
          label: 'История аналогов',
          children: (
            <Spin spinning={loading}>
              {error && <div className={styles.muted}>{error}</div>}
              {items !== null && items.length === 0 && <div className={styles.muted}>По этой позиции аналоги не применялись.</div>}
              {(items ?? []).map((a) => {
                const st = STATUS_TEXT[a.status];
                return (
                  <div key={a.id} className={styles.historyItem}>
                    <div className={styles.title}>{a.source_work_name}</div>
                    <div className={styles.muted}>
                      Тендер № {a.source_tender_number ?? '—'}{a.source_tender_version ? ` v${a.source_tender_version}` : ''}
                      {' · '}{a.created_by_name ?? '—'} · {formatDateTime(a.created_at)}
                    </div>
                    <div className={styles.chips}>
                      <Tag color={st.color}>{st.text}</Tag>
                      <span>
                        Масштаб: {SCALE_TEXT[a.scale_mode] ?? a.scale_mode}
                        {a.scale_mode !== 'none' ? ` ×${formatNumber(a.scale_factor, 4)}` : ''}
                      </span>
                      <span>Цены: {a.copy_prices ? 'перенесены как черновые' : 'не переносились'}</span>
                      <span>Строк: {a.items_created}</span>
                    </div>
                    {a.status === 'reverted' && (
                      <div className={styles.muted}>Отменил {a.reverted_by_name ?? '—'} · {formatDateTime(a.reverted_at)}</div>
                    )}
                    {a.status === 'applied' && (
                      <div>
                        <Popconfirm
                          title="Отменить применение аналога?"
                          description="Строки, созданные этим решением, будут удалены."
                          okText="Отменить применение"
                          cancelText="Нет"
                          onConfirm={() => handleRevert(a.id)}
                        >
                          <Button className={styles.btn} danger loading={busyId === a.id}>Отменить</Button>
                        </Popconfirm>
                      </div>
                    )}
                  </div>
                );
              })}
            </Spin>
          ),
        },
      ]}
    />
  );
};
