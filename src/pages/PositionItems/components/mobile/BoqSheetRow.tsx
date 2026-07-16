import { theme } from 'antd';
import BoqSheetCell from './BoqSheetCell';
import type { FieldState, SheetCtx, SheetField } from './sheetFieldTypes';

interface BoqSheetRowProps {
  /** Ячейки строки (1–4): состав собирает toRows() по ключу строки. */
  fields: SheetField[];
  ctx: SheetCtx;
  stateOf: (key: string) => FieldState;
  /** Ключ поля, которое сейчас правится (на весь лист — один). */
  editingKey: string | null;
  error: string | null;
  /** Дедлайн не истёк. FX-гейт накладывается отдельно, на каждое поле. */
  canEdit: boolean;
  fxBlocked: boolean;
  onStart: (key: string) => void;
  onCancel: () => void;
  onCommit: (field: SheetField, draft: unknown) => void;
}

/**
 * Строка листа: разделитель снизу и N равных ячеек в ряд (портрет — до двух,
 * ландшафт — до четырёх; ширину делит flex, состав задаёт toRows).
 *
 * Строка из одной ячейки — норма, а не вырожденный случай: toRows() строит
 * строки из уже отфильтрованных по visible полей, поэтому «К перев» у
 * непривязанного материала и «Сум. дост.» вне режима «суммой» просто не
 * доезжают сюда. Единственная ячейка при этом растягивается на всю ширину —
 * flex: 1 на одном ребёнке занимает 100% контейнера.
 */
const BoqSheetRow: React.FC<BoqSheetRowProps> = ({
  fields,
  ctx,
  stateOf,
  editingKey,
  error,
  canEdit,
  fxBlocked,
  onStart,
  onCancel,
  onCommit,
}) => {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: `1px solid ${token.colorSplit}`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {fields.map((field) => (
        // minWidth: 0 обязателен — иначе длинное значение распирает flex-колонку.
        <div key={field.key} style={{ flex: 1, minWidth: 0 }}>
          <BoqSheetCell
            field={field}
            ctx={ctx}
            state={stateOf(field.key)}
            error={editingKey === field.key ? error : null}
            // Курс не задан → сервер уронит любой патч; чинится только сменой валюты.
            canEdit={canEdit && (!fxBlocked || field.key === 'currency_type')}
            locked={editingKey !== null && editingKey !== field.key}
            onStart={() => onStart(field.key)}
            onCancel={onCancel}
            onCommit={(draft) => onCommit(field, draft)}
          />
        </div>
      ))}
    </div>
  );
};

export default BoqSheetRow;
