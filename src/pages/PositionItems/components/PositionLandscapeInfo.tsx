import { Typography, Tag } from 'antd';
import type { ClientPosition } from '../../../lib/types';

const { Text } = Typography;

interface PositionLandscapeInfoProps {
  position: ClientPosition;
  gpVolume: number;
  gpNote: string;
  workName: string;
  unitCode: string;
}

/**
 * Компактная read-only полоса для ландшафта телефона: показывает заголовок позиции
 * и сводку Заказчик/ГП (кол-во, ед.изм, примечание) над таблицей внутри оверлея.
 * Горизонтальная вёрстка с переносом — масштабируется вместе с таблицей в LandscapeTableOverlay.
 */
const PositionLandscapeInfo: React.FC<PositionLandscapeInfoProps> = ({
  position,
  gpVolume,
  gpNote,
  workName,
  unitCode,
}) => {
  const gpUnit = position.is_additional ? unitCode : position.unit_code;
  const name = position.is_additional ? workName : position.work_name;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {position.is_additional && <Tag color="orange">ДОП</Tag>}
        <Text strong style={{ fontSize: 13 }}>
          {position.position_number}. {position.item_no ? `${position.item_no} ` : ''}{name}
        </Text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 4, fontSize: 13 }}>
        {!position.is_additional && (
          <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
            Кол-во заказчика: <Text strong>{position.volume?.toFixed(2) || '-'}</Text>
            {position.unit_code && <> &nbsp;Ед. изм.: <Text strong>{position.unit_code}</Text></>}
          </Text>
        )}
        {!position.is_additional && position.client_note && (
          <Text type="secondary">
            Примечание заказчика: <Text strong>{position.client_note}</Text>
          </Text>
        )}
        <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
          Кол-во ГП: <Text strong>{gpVolume?.toLocaleString('ru-RU') || '-'}</Text>
          {gpUnit && <> &nbsp;<Text strong>{gpUnit}</Text></>}
        </Text>
        {gpNote && (
          <Text type="secondary">
            Примечание ГП: <Text strong>{gpNote}</Text>
          </Text>
        )}
      </div>
    </div>
  );
};

export default PositionLandscapeInfo;
