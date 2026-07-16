import { Input, InputNumber, Typography } from 'antd';
import type { GpAutosave } from '../hooks/useGpAutosave';

const { Text } = Typography;

interface GpInlineFieldsProps {
  gp: GpAutosave;
  /** Ед. изм. позиции — подпись справа от количества. */
  unitCode?: string | null;
  disabled?: boolean;
  /** Ландшафт: узкая полоска внутри оверлея — компактная горизонтальная раскладка. */
  compact?: boolean;
}

/**
 * Кол-во ГП + Примечание ГП, редактируемые сразу при открытии, с автосохранением.
 *
 * Чисто презентационный: состояние и debounce живут в useGpAutosave, который
 * вызывается ОДИН раз в PositionItems (в ландшафте PositionHeader остаётся
 * смонтированным под оверлеем — два хука дали бы два конкурирующих PATCH).
 *
 * Примечание рендерится ВСЕГДА, в т.ч. пустое: раньше оно было под `{gpNote && …}`
 * и заполнить его с телефона было физически невозможно.
 */
const GpInlineFields: React.FC<GpInlineFieldsProps> = ({
  gp,
  unitCode,
  disabled = false,
  compact = false,
}) => {
  const numberInput = (
    <InputNumber
      value={gp.volume}
      onChange={(v) => gp.setVolume(v || 0)}
      onFocus={gp.onFocus}
      onBlur={gp.onBlur}
      disabled={disabled}
      precision={5}
      size="small"
      style={compact ? { width: 110 } : { width: '100%' }}
      // type="number" нельзя: запятая-разделитель + parser требуют текстового инпута.
      inputMode="decimal"
      decimalSeparator=","
      parser={(value) => parseFloat((value ?? '').replace(/\s/g, '').replace(/,/g, '.'))}
    />
  );

  const noteInput = (
    <Input.TextArea
      value={gp.note}
      onChange={(e) => gp.setNote(e.target.value)}
      onFocus={gp.onFocus}
      onBlur={gp.onBlur}
      disabled={disabled}
      size="small"
      placeholder="Примечание ГП"
      autoSize={{ minRows: 1, maxRows: 2 }}
      style={compact ? { width: 220 } : { width: '100%' }}
    />
  );

  if (compact) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text type="secondary">Кол-во ГП:</Text>
          {numberInput}
          {unitCode && <Text type="secondary">{unitCode}</Text>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text type="secondary">Примечание ГП:</Text>
          {noteInput}
        </div>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Кол-во ГП{unitCode ? `, ${unitCode}` : ''}
        </Text>
        {numberInput}
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Примечание ГП
        </Text>
        {noteInput}
      </div>
    </div>
  );
};

export default GpInlineFields;
