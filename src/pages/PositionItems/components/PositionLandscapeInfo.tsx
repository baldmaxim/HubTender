import { Typography, Tag } from 'antd';
import type { ClientPosition } from '../../../lib/types';
import { renderStrikeRuns, renderStruck } from '../../../components/RichText/StrikeText';
import GpInlineFields from './GpInlineFields';
import type { GpAutosave } from '../hooks/useGpAutosave';

const { Text } = Typography;

interface PositionLandscapeInfoProps {
  position: ClientPosition;
  gpVolume: number;
  gpNote: string;
  workName: string;
  unitCode: string;
  /** Шапка страницы закрыта оверлеем, поэтому ГП редактируется здесь. */
  gpEditable?: boolean;
  gp?: GpAutosave;
  disabled?: boolean;
}

/**
 * Компактная полоса для ландшафта телефона: заголовок позиции и сводка
 * Заказчик/ГП (кол-во, ед.изм, примечание) над таблицей внутри оверлея.
 * Горизонтальная вёрстка с переносом — масштабируется вместе с таблицей.
 *
 * Данные заказчика тут read-only всегда; ГП редактируемо при gpEditable —
 * PositionHeader в ландшафте не виден (оверлей fixed/inset:0/z-1100).
 */
const PositionLandscapeInfo: React.FC<PositionLandscapeInfoProps> = ({
  position,
  gpVolume,
  gpNote,
  workName,
  unitCode,
  gpEditable = false,
  gp,
  disabled = false,
}) => {
  const gpUnit = position.is_additional ? unitCode : position.unit_code;
  const nameNode = position.is_additional
    ? workName
    : renderStrikeRuns(position.rich_runs?.work_name, position.work_name);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {position.is_additional && <Tag color="orange">ДОП</Tag>}
        <Text strong style={{ fontSize: 13 }}>
          {position.position_number}. {position.item_no ? <>{renderStrikeRuns(position.rich_runs?.item_no, position.item_no)} </> : ''}{nameNode}
        </Text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 4, fontSize: 13 }}>
        {!position.is_additional && (
          <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
            Кол-во заказчика: <Text strong>{position.volume != null ? renderStruck(position.rich_runs?.volume_struck, position.volume.toFixed(2)) : '-'}</Text>
            {position.unit_code && <> &nbsp;Ед. изм.: <Text strong>{position.unit_code}</Text></>}
          </Text>
        )}
        {!position.is_additional && position.client_note && (
          <Text type="secondary">
            Примечание заказчика: <Text strong>{renderStrikeRuns(position.rich_runs?.client_note, position.client_note)}</Text>
          </Text>
        )}
        {gpEditable && gp ? (
          <GpInlineFields gp={gp} unitCode={gpUnit} disabled={disabled} compact />
        ) : (
          <>
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              Кол-во ГП: <Text strong>{gpVolume?.toLocaleString('ru-RU') || '-'}</Text>
              {gpUnit && <> &nbsp;<Text strong>{gpUnit}</Text></>}
            </Text>
            {gpNote && (
              <Text type="secondary">
                Примечание ГП: <Text strong>{gpNote}</Text>
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PositionLandscapeInfo;
