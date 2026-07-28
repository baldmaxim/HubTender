import { useEffect, useMemo } from 'react';
import { Alert, App as AntApp, Divider, Drawer, Tag, Typography, theme } from 'antd';
import type { BoqItemFull, MaterialName, WorkName } from '../../../../lib/types';
import type { CostCategoryOption } from '../editFormShared';
import type { BoqItemFieldPatch } from '../../utils/boqFieldPatch';
import { isWorkItemType } from '../../utils/boqFieldPatch';
import { missingFXMessage } from '../../../../utils/boq/currencyGuard';
import { useIsMobile } from '../../../../hooks/useIsMobile';
import { formatRu } from '../../../../utils/format/currency';
import { getBoqTypeTagStyle } from '../boqColors';
import { useBoqFieldSave } from '../../hooks/useBoqFieldSave';
import BoqSheetRow from './BoqSheetRow';
import { WORK_SHEET_FIELDS } from './workSheetFields';
import { materialFieldsFor } from './materialSheetFields';
import { SHEET_GROUP_LABEL, toRows } from './sheetFieldTypes';
import type { SheetCtx, SheetGroup } from './sheetFieldTypes';

const { Text } = Typography;

const GROUP_ORDER: SheetGroup[] = ['classification', 'quantity', 'other'];

interface BoqItemSheetProps {
  itemId: string | null;
  /** Живой список: лист читает запись отсюда, снапшот не держит. */
  items: BoqItemFull[];
  workNames: WorkName[];
  materialNames: MaterialName[];
  costCategories: CostCategoryOption[];
  units: Array<{ code: string; name?: string }>;
  currencyRates: { usd: number; eur: number; cny: number };
  gpVolume: number;
  editDataState: 'idle' | 'loading' | 'ready' | 'error';
  /** Дедлайн не истёк — иначе лист работает как detail-view без карандашей. */
  canEdit: boolean;
  onFieldSave: (
    itemId: string,
    patch: BoqItemFieldPatch,
    opts: { recomputeWorkId?: string },
  ) => Promise<void>;
  onClose: () => void;
}

/**
 * Телефонный лист редактирования BOQ-элемента: bottom-sheet со списком полей,
 * у каждого — ярлык-карандаш с явным «Сохранить».
 *
 * zIndex 1200 обязателен: в ландшафте LandscapeTableOverlay занимает 1100, а
 * дефолтная 1000 у Drawer спрятала бы лист ПОД оверлей (прецедент —
 * CategoryPositionsModal на «Затратах»).
 */
const BoqItemSheet: React.FC<BoqItemSheetProps> = ({
  itemId,
  items,
  workNames,
  materialNames,
  costCategories,
  units,
  currencyRates,
  gpVolume,
  editDataState,
  canEdit,
  onFieldSave,
  onClose,
}) => {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  // Ориентацию лист спрашивает сам, а не получает пропом: он самодостаточный
  // мобильный компонент, а хук и так реактивен на поворот (rAF-коалесинг +
  // equality-guard внутри), поэтому лишним рендерам взяться неоткуда.
  const { isLandscapePhone } = useIsMobile();
  const { editingKey, error, start, cancel, commit, stateOf } = useBoqFieldSave({
    itemId,
    onFieldSave,
  });

  const item = useMemo(
    () => (itemId ? items.find((i) => i.id === itemId) ?? null : null),
    [items, itemId],
  );

  // Запись удалили (в т.ч. из другой вкладки) — закрываем, а не показываем пустоту.
  useEffect(() => {
    if (itemId && items.length > 0 && !items.some((i) => i.id === itemId)) {
      message.warning('Элемент был удалён');
      onClose();
    }
  }, [itemId, items, message, onClose]);

  const ctx = useMemo<SheetCtx | null>(() => {
    if (!item) return null;
    return {
      item,
      workItems: items.filter((i) => isWorkItemType(i.boq_item_type)),
      materialNames,
      workNames,
      costCategories,
      units,
      gpVolume,
      currencyRates,
      hasChildren: items.some((i) => i.parent_work_item_id === item.id),
      editDataState,
    };
  }, [item, items, materialNames, workNames, costCategories, units, gpVolume, currencyRates, editDataState]);

  const fields = useMemo(() => {
    if (!ctx) return [];
    return isWorkItemType(ctx.item.boq_item_type) ? WORK_SHEET_FIELDS : materialFieldsFor(ctx);
  }, [ctx]);

  // Курс валюты не задан → сервер уронит ЛЮБОЙ патч (он пересчитывает total_amount
  // на каждой правке, включая Примечание). Оставляем один выход — сменить валюту.
  const fxWarning = item ? missingFXMessage([item], {
    usd_rate: currencyRates.usd,
    eur_rate: currencyRates.eur,
    cny_rate: currencyRates.cny,
  }) : null;
  const fxBlocked = !!fxWarning;

  const title = item ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Tag
        style={{
          ...(() => {
            const { bgColor, textColor } = getBoqTypeTagStyle(item.boq_item_type);
            return { backgroundColor: bgColor, color: textColor };
          })(),
          border: 'none',
          margin: 0,
        }}
      >
        {item.boq_item_type}
      </Tag>
      <Text strong style={{ fontSize: 14, wordBreak: 'break-word' }}>
        {item.work_name || item.material_name || 'Элемент'}
      </Text>
    </div>
  ) : null;

  const footer = item ? (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 4px' }}>
      <Text type="secondary">Итого</Text>
      <Text strong style={{ fontSize: 16, color: token.colorPrimary }}>
        {/* Округление ВНУТРИ non-null ветки: Math.round(null) === 0 съел бы прочерк
            у строки без курса. Идиома та же, что в карточках и десктопном тулбаре. */}
        {item.total_amount == null ? '—' : formatRu(Math.round(item.total_amount))}
      </Text>
    </div>
  ) : null;

  return (
    <Drawer
      open={!!itemId && !!item}
      onClose={onClose}
      placement="bottom"
      height="92%"
      zIndex={1200}
      destroyOnHidden
      // Крестика нет — лист закрывается тапом по маске, и она закрывает ВСЕГДА.
      // Гейт по editingKey убран намеренно: без крестика он оставлял пользователя
      // без выхода при активном редакторе, а во время сохранения — совсем (там и
      // «Отмена» в поле disabled). Недосохранённый черновик и так не был записан:
      // в per-field модели значение уходит только по явному ✓.
      closable={false}
      title={title}
      footer={footer}
      styles={{
        body: {
          padding: 12,
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
        },
      }}
    >
      {ctx && (
        <>
          {fxWarning && <Alert type="error" showIcon message={fxWarning} style={{ marginBottom: 12 }} />}

          {GROUP_ORDER.map((group) => {
            const groupFields = fields.filter(
              (f) => f.group === group && (!f.visible || f.visible(ctx)),
            );
            if (groupFields.length === 0) return null;
            return (
              <div key={group}>
                <Divider plain style={{ margin: '4px 0', fontSize: 11 }}>
                  {SHEET_GROUP_LABEL[group]}
                </Divider>
                {toRows(groupFields, isLandscapePhone).map((rowFields) => (
                  <BoqSheetRow
                    key={rowFields.map((f) => f.key).join('+')}
                    fields={rowFields}
                    ctx={ctx}
                    stateOf={stateOf}
                    editingKey={editingKey}
                    error={error}
                    canEdit={canEdit}
                    fxBlocked={fxBlocked}
                    onStart={start}
                    onCancel={cancel}
                    onCommit={(field, draft) => void commit(field, draft, ctx)}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}
    </Drawer>
  );
};

export default BoqItemSheet;
