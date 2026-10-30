import { useCallback, useEffect, useState, type FC } from 'react';
import { Alert, Button, Input, Spin, Tag, theme } from 'antd';
import { CloseOutlined, LinkOutlined } from '@ant-design/icons';
import { BASIS_COLORS, BASIS_LABELS, STATUS_COLORS, STATUS_LABELS } from '../constants';
import type { AutopriceAction, IPositionDetail, IReviewPatch } from '../types';
import { decisionText, formatNumber, positionLabel } from '../utils/format';
import { getReviewCssVars } from '../utils/cssVars';
import { isStaleApproval } from '../utils/reviewPolicy';
import { formatVolumeValue, volumeSourceParts, volumesDiffer } from '../utils/volumeFormat';
import { useReviewDraft } from '../hooks/useReviewDraft';
import { useRowEditing } from '../hooks/useRowEditing';
import { useWideScreen } from '../hooks/useWideScreen';
import BoqItemSheet from '../../PositionItems/components/mobile/BoqItemSheet';
import { ItemsTable } from './ItemsTable';
import { BasisSection } from './BasisSection';
import { FindingsEditor } from './FindingsEditor';
import { QuestionsEditor } from './QuestionsEditor';
import { VolumeSourceTag } from './VolumeSourceTag';
import { EventsList } from './EventsList';
import { PanelActions } from './PanelActions';
import { AnalogPicker } from '../../../components/AnalogPicker';
import styles from '../AutopriceReview.module.css';

interface IPositionPanelProps {
  detail: IPositionDetail | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  isApprover: boolean;
  onSave: (patch: IReviewPatch) => Promise<boolean>;
  onAction: (action: AutopriceAction, okText: string, comment?: string) => Promise<boolean>;
  onOpenPosition: (positionId: string) => void;
  tenderId: string | null;
  /** Строки BOQ правили из панели: перечитать деталь и список. */
  onRowsChanged: () => Promise<void>;
  onClose: () => void;
}

export const PositionPanel: FC<IPositionPanelProps> = ({
  detail,
  loading,
  busy,
  error,
  isApprover,
  onSave,
  onAction,
  onOpenPosition,
  tenderId,
  onRowsChanged,
  onClose,
}) => {
  const { token } = theme.useToken();
  const { draft, dirty, toPatch, setComment, setQuestions, setFindings } = useReviewDraft(detail);
  const positionId = detail?.position.id ?? null;
  const rowEditing = useRowEditing({ positionId, tenderId, onSaved: onRowsChanged });
  const { activate } = rowEditing;
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [analogOpen, setAnalogOpen] = useState(false);
  const wide = useWideScreen();

  // Сменилась позиция — лист закрываем.
  useEffect(() => {
    setEditItemId(null);
    setAnalogOpen(false);
  }, [positionId]);

  const handleEditItem = useCallback(
    (itemId: string) => {
      activate();
      setEditItemId(itemId);
    },
    [activate],
  );
  const handleCloseSheet = useCallback(() => setEditItemId(null), []);

  if (loading && !detail) {
    return (
      <div className={styles.panel} style={getReviewCssVars(token)}>
        <div className={styles.center}>
          <Spin />
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className={styles.panel} style={getReviewCssVars(token)}>
        {error ? <Alert type="error" showIcon message={error} /> : <div className={styles.center}>Выберите позицию</div>}
      </div>
    );
  }

  const { review, position } = detail;
  const locked = review.status === 'approved';
  const decision = decisionText(review, true);
  const aiSource = review.volume_source?.kind === 'ai_model' ? review.volume_source : null;
  const aiLine = aiSource ? volumeSourceParts(aiSource).join(' · ') : '';
  const customerVolume = position.customer_volume ?? null;
  const volumeDiff =
    aiSource && customerVolume !== null && typeof aiSource.value === 'number' && volumesDiffer(customerVolume, aiSource.value)
      ? `ВОР ${formatVolumeValue(customerVolume)} → ИИ ${formatVolumeValue(aiSource.value, aiSource.unit)}`
      : '';

  // Несохранённые правки уходят вместе с действием: иначе после перезагрузки карточки они пропали бы.
  const handleAction = async (action: AutopriceAction, okText: string, comment?: string): Promise<boolean> => {
    if (dirty && !locked && !(await onSave(toPatch()))) return false;
    return onAction(action, okText, comment);
  };

  return (
    <div className={styles.panel} style={getReviewCssVars(token)}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>
          <span className={styles.positionNo}>№ {positionLabel(position)}</span>
          {isStaleApproval(review) ? (
            <Tag color="red">Подтверждение снято</Tag>
          ) : (
            <Tag color={STATUS_COLORS[review.status]}>{STATUS_LABELS[review.status]}</Tag>
          )}
          {review.basis && <Tag color={BASIS_COLORS[review.basis]}>{BASIS_LABELS[review.basis]}</Tag>}
          <VolumeSourceTag source={review.volume_source} />
        </div>
        <Button className={styles.closeBtn} type="text" icon={<CloseOutlined />} aria-label="Закрыть" onClick={onClose} />
      </div>

      <Spin spinning={loading || busy}>
        <div className={styles.panelBody}>
          <div className={styles.positionText}>{position.work_name}</div>
          <div className={styles.muted}>
            {position.volume !== null && `Объём: ${formatNumber(position.volume, 3)} ${position.unit_code ?? ''}`}
            {review.section ? ` · ${review.section}` : ''}
          </div>
          {aiLine && <div className={styles.muted}>{aiLine}</div>}
          {volumeDiff && <div className={styles.muted}>{volumeDiff}</div>}
          <div className={styles.decision}>
            <span className={styles.muted}>Решение: </span>
            {decision ?? <span className={styles.muted}>Решения ещё не было</span>}
          </div>

          {error && <Alert type="error" showIcon message={error} />}
          {isStaleApproval(review) && (
            <Alert
              type="warning"
              showIcon
              message="После подтверждения цены или состав строк изменены — подтверждение снято"
            />
          )}
          {review.zero_price_count > 0 && (
            <Alert type="warning" showIcon message={`Строк без цены: ${review.zero_price_count}`} />
          )}

          <Button className={styles.linkBtn} icon={<LinkOutlined />} onClick={() => onOpenPosition(position.id)}>
            Открыть позицию
          </Button>

          <ItemsTable
            items={detail.items}
            deleted={detail.deleted}
            onEditItem={handleEditItem}
            editing={{ ready: rowEditing.ready, canEdit: rowEditing.canEdit, saveField: rowEditing.saveField }}
          />

          <BasisSection refs={review.pd_refs} note={review.pd_note} />

          <FindingsEditor findings={draft.findings} disabled={locked} onChange={setFindings} />
          <QuestionsEditor questions={draft.questions} disabled={locked} onChange={setQuestions} />

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Комментарий инженера</div>
            <Input.TextArea
              className={styles.input}
              autoSize={{ minRows: 2, maxRows: 8 }}
              allowClear
              disabled={locked}
              value={draft.comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button
              className={styles.saveBtn}
              type={dirty ? 'primary' : 'default'}
              disabled={!dirty || locked || busy}
              onClick={() => void onSave(toPatch())}
            >
              Сохранить
            </Button>
            {locked && <div className={styles.muted}>Позиция подтверждена — для правок переоткройте её.</div>}
          </div>

          <PanelActions
            review={review}
            busy={busy}
            isApprover={isApprover}
            onAction={handleAction}
            onPickAnalog={() => setAnalogOpen(true)}
          />

          <EventsList events={review.events ?? []} />
        </div>
      </Spin>

      <AnalogPicker
        open={analogOpen}
        positionId={position.id}
        onClose={() => setAnalogOpen(false)}
        onApplied={() => void onRowsChanged()}
        onReverted={() => void onRowsChanged()}
      />

      <BoqItemSheet
        itemId={editItemId}
        items={rowEditing.items}
        workNames={rowEditing.workNames}
        materialNames={rowEditing.materialNames}
        costCategories={rowEditing.costCategories}
        units={rowEditing.units}
        currencyRates={rowEditing.currencyRates}
        gpVolume={rowEditing.gpVolume}
        editDataState={rowEditing.editDataState}
        canEdit={rowEditing.canEdit}
        onFieldSave={rowEditing.onFieldSave}
        onClose={handleCloseSheet}
        placement={wide ? 'right' : 'bottom'}
      />
    </div>
  );
};
