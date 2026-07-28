import { useEffect, useRef, useState } from 'react';
import { Spin, Typography, theme } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { validateField } from '../../utils/boqFieldPatch';
import IconTagButton from './IconTagButton';
import SheetControl from './SheetControl';
import { toPatchCtx } from './sheetFieldTypes';
import type { FieldState, SheetCtx, SheetField } from './sheetFieldTypes';

const { Text } = Typography;

interface BoqSheetCellProps {
  field: SheetField;
  ctx: SheetCtx;
  state: FieldState;
  error: string | null;
  /** Дедлайн не истёк и FX-гейт пропускает это поле. */
  canEdit: boolean;
  /** Редактируется другое поле → ✎ этого disabled (один редактор за раз). */
  locked: boolean;
  onStart: () => void;
  onCancel: () => void;
  onCommit: (draft: unknown) => void;
}

/**
 * Одно поле листа: метка + ✎ сверху, значение/контрол снизу. Занимает либо всю
 * строку, либо её половину — ширину задаёт BoqSheetRow, ячейка тянется на 100%.
 */
const BoqSheetCell: React.FC<BoqSheetCellProps> = ({
  field,
  ctx,
  state,
  error,
  canEdit,
  locked,
  onStart,
  onCancel,
  onCommit,
}) => {
  const { token } = theme.useToken();
  const editing = state === 'editing' || state === 'saving';
  const saving = state === 'saving';

  const [draft, setDraft] = useState<unknown>(null);
  const wasEditing = useRef(false);

  // Драфт сеется ОДИН раз — на входе в редактирование. Пересев на каждый ctx
  // затирал бы ввод пользователя рефетчем items (он идёт после каждого save).
  useEffect(() => {
    if (editing && !wasEditing.current) setDraft(field.toDraft ? field.toDraft(ctx) : null);
    wasEditing.current = editing;
    // ctx намеренно вне deps: см. выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const refsPending = !!field.needsRefs && ctx.editDataState !== 'ready';
  const editable = !!field.editKey && canEdit;
  const invalid = field.editKey ? validateField(field.editKey, draft, toPatchCtx(ctx)) : null;

  const refsHint =
    ctx.editDataState === 'error'
      ? 'Справочники не загрузились, откройте карточку снова'
      : 'Загрузка справочников…';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
        <Text
          style={{
            fontSize: 12,
            color: token.colorTextTertiary,
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {field.label}
        </Text>

        {refsPending && editable && !editing && <Spin size="small" />}

        {editable && !editing && (
          <IconTagButton
            icon={state === 'saved' ? <CheckOutlined /> : <EditOutlined />}
            tone={state === 'saved' ? 'primary' : 'neutral'}
            label={refsPending ? refsHint : `Редактировать: ${field.label}`}
            disabled={locked || refsPending}
            onClick={onStart}
          />
        )}

        {editing && (
          // gap 20: хитбоксы 44px иначе перекрываются на 12px.
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <IconTagButton
              icon={saving ? <LoadingOutlined /> : <CheckOutlined />}
              tone="primary"
              label="Сохранить"
              disabled={saving || !!invalid}
              onClick={() => onCommit(draft)}
            />
            <IconTagButton
              icon={<CloseOutlined />}
              label="Отмена"
              disabled={saving}
              onClick={onCancel}
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 4 }}>
        {editing && field.control ? (
          <SheetControl
            spec={field.control}
            draft={draft}
            setDraft={setDraft}
            ctx={ctx}
            onCommit={() => !invalid && onCommit(draft)}
            disabled={saving}
          />
        ) : (
          <Text strong style={{ fontSize: 14, wordBreak: 'break-word' }}>
            {field.render(ctx)}
          </Text>
        )}
      </div>

      {editing && (invalid || error) && (
        <div style={{ marginTop: 4, fontSize: 12, color: token.colorError }}>{invalid || error}</div>
      )}
    </>
  );
};

export default BoqSheetCell;
