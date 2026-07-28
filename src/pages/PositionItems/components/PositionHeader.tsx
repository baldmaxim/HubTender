import { Card, Typography, Tag, Input, InputNumber, Select } from 'antd';
import type { ClientPosition } from '../../../lib/types';
import { renderStrikeRuns, renderStruck } from '../../../components/RichText/StrikeText';
import GpInlineFields from './GpInlineFields';
import type { GpAutosave } from '../hooks/useGpAutosave';

const { Text } = Typography;

interface PositionHeaderProps {
  position: ClientPosition;
  gpVolume: number;
  setGpVolume: (v: number) => void;
  gpNote: string;
  setGpNote: (v: string) => void;
  workName: string;
  setWorkName: (v: string) => void;
  unitCode: string;
  setUnitCode: (v: string) => void;
  units: { code: string }[];
  disabled: boolean;
  /** Значения передаются явно: замыкание на gpVolume/gpNote ломало бы telephone-драфт
   *  (WS-рефетч перезаписывает их безусловно). */
  onSaveGPData: (volume: number, note: string, opts?: { refetch?: boolean }) => void;
  onSaveAdditionalWorkData: () => void;
  /** Телефон (обе ориентации): вертикальный стек вместо широкой раскладки. */
  isPhone: boolean;
  /** Портретный телефон: ГП редактируется прямо в шапке. В ландшафте шапка закрыта
   *  оверлеем, и ГП живёт в PositionLandscapeInfo — поэтому отдельный флаг. */
  gpEditable?: boolean;
  gp?: GpAutosave;
}

const PositionHeader: React.FC<PositionHeaderProps> = ({
  position,
  gpVolume,
  setGpVolume,
  gpNote,
  setGpNote,
  workName,
  setWorkName,
  unitCode,
  setUnitCode,
  units,
  disabled,
  onSaveGPData,
  onSaveAdditionalWorkData,
  isPhone,
  gpEditable = false,
  gp,
}) => {
  const saveGp = () => onSaveGPData(gpVolume, gpNote);
  const titleBlock = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {position.is_additional && <Tag color="orange">ДОП</Tag>}
      <Text strong style={{ margin: 0 }}>
        {position.position_number}. {position.item_no ? <>{renderStrikeRuns(position.rich_runs?.item_no, position.item_no)} </> : ''}{renderStrikeRuns(position.rich_runs?.work_name, position.work_name)}
      </Text>
    </div>
  );

  // ─── Телефон: только просмотр, вертикальный стек ───
  if (isPhone) {
    return (
      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        {titleBlock}
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!position.is_additional && (
            <Text type="secondary">
              Кол-во заказчика: <Text strong>{position.volume != null ? renderStruck(position.rich_runs?.volume_struck, position.volume.toFixed(2)) : '-'}</Text>
              {position.unit_code && <> &nbsp;Ед. изм.: <Text strong>{position.unit_code}</Text></>}
            </Text>
          )}
          {position.is_additional && (
            <Text type="secondary">
              Наименование: <Text strong>{workName || '-'}</Text>
            </Text>
          )}
          {position.client_note && (
            <Text type="secondary">
              Примечание заказчика: <Text strong>{renderStrikeRuns(position.rich_runs?.client_note, position.client_note)}</Text>
            </Text>
          )}
          {gpEditable && gp ? (
            <GpInlineFields
              gp={gp}
              unitCode={position.is_additional ? unitCode : position.unit_code}
              disabled={disabled}
            />
          ) : (
            <>
              <Text type="secondary">
                Кол-во ГП: <Text strong>{gpVolume?.toLocaleString('ru-RU') || '-'}</Text>
                {' '}<Text strong>{position.is_additional ? unitCode : position.unit_code}</Text>
              </Text>
              {gpNote && (
                <Text type="secondary">
                  Примечание ГП: <Text strong>{gpNote}</Text>
                </Text>
              )}
            </>
          )}
        </div>
      </Card>
    );
  }

  // ─── Десктоп/планшет: редактируемый макет (как раньше) ───
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
        <div>
          {titleBlock}

          {!position.is_additional && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Text type="secondary">
                Кол-во заказчика: <Text strong>{position.volume != null ? renderStruck(position.rich_runs?.volume_struck, position.volume.toFixed(2)) : '-'}</Text>
                {position.unit_code && <> &nbsp;Ед. изм.: <Text strong>{position.unit_code}</Text></>}
              </Text>
              {position.client_note && (
                <Text type="secondary">
                  Примечание заказчика: <Text strong>{renderStrikeRuns(position.rich_runs?.client_note, position.client_note)}</Text>
                </Text>
              )}
            </div>
          )}

          {position.is_additional && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text type="secondary">Наименование:</Text>
                <Input
                  value={workName}
                  onChange={(e) => setWorkName(e.target.value)}
                  onBlur={onSaveAdditionalWorkData}
                  disabled={disabled}
                  style={{ width: 300 }}
                  size="small"
                  placeholder="Наименование работы"
                />
                <Text type="secondary" style={{ marginLeft: 16, paddingTop: 4 }}>Примечание ГП:</Text>
                <Input.TextArea
                  value={gpNote}
                  onChange={(e) => setGpNote(e.target.value)}
                  onBlur={saveGp}
                  disabled={disabled}
                  style={{ width: 300 }}
                  size="small"
                  placeholder="Примечание"
                  autoSize={{ minRows: 1, maxRows: 2 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text type="secondary">Кол-во ГП:</Text>
                <InputNumber
                  value={gpVolume}
                  onChange={(value) => setGpVolume(value || 0)}
                  onBlur={saveGp}
                  disabled={disabled}
                  precision={5}
                  style={{ width: 120 }}
                  size="small"
                  decimalSeparator=","
                  parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                />
                <Text type="secondary" style={{ marginLeft: 16 }}>Ед. изм:</Text>
                <Select
                  value={unitCode}
                  onChange={(value) => {
                    setUnitCode(value);
                    setTimeout(() => onSaveAdditionalWorkData(), 100);
                  }}
                  disabled={disabled}
                  style={{ width: 100 }}
                  size="small"
                  showSearch
                  placeholder="Выберите"
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={units.map((unit) => ({ value: unit.code, label: unit.code }))}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          {!position.is_additional && (
            <>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                  <Text type="secondary">Кол-во ГП:</Text>
                  <InputNumber
                    value={gpVolume}
                    onChange={(value) => setGpVolume(value || 0)}
                    onBlur={saveGp}
                    disabled={disabled}
                    precision={5}
                    style={{ width: 120 }}
                    size="small"
                    decimalSeparator=","
                    parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                  />
                  <Text type="secondary">{position.unit_code}</Text>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, whiteSpace: 'nowrap' }}>
                <Text type="secondary" style={{ paddingTop: 4 }}>Примечание ГП:</Text>
                <Input.TextArea
                  value={gpNote}
                  onChange={(e) => setGpNote(e.target.value)}
                  onBlur={saveGp}
                  disabled={disabled}
                  style={{ width: 400 }}
                  size="small"
                  placeholder="Примечание"
                  autoSize={{ minRows: 1, maxRows: 2 }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

export default PositionHeader;
