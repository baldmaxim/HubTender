import type { ReactNode } from 'react';
import { Tag, Tooltip, Typography } from 'antd';

const { Text } = Typography;

export interface PositionCardLine {
  label: string;
  value: ReactNode;
}

interface PositionSelectCardProps {
  positionNumber: number;
  itemNo: string | null;
  workName: string;
  isAdditional: boolean;
  /** Лист (расценка) vs раздел — влияет на начертание и цвет itemNo. */
  isLeaf: boolean;
  /** Строки «метка — значение» под заголовком (стоимости). */
  lines: PositionCardLine[];
}

/**
 * Карточное представление одной строки Заказчика для телефонного портрета.
 * Заголовок в одну строку с ellipsis (фикс. высота обязательна для virtual),
 * значения — под ним. Общая для «Снижения» и «Обнуления», чтобы не дублировать
 * верстку в двух таблицах.
 */
export function PositionSelectCard({
  positionNumber,
  itemNo,
  workName,
  isAdditional,
  isLeaf,
  lines,
}: PositionSelectCardProps) {
  const itemNoColor = isLeaf ? '#52c41a' : '#ff7875';
  return (
    <div className="fi-position-card">
      <div className="fi-position-card__head">
        {isAdditional && (
          <Tag color="orange" style={{ marginRight: 4 }}>
            ДОП
          </Tag>
        )}
        <span style={{ marginRight: 6, color: '#8c8c8c', fontVariantNumeric: 'tabular-nums' }}>
          {positionNumber}
        </span>
        {itemNo && (
          <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>{itemNo}</span>
        )}
        <Tooltip title={workName}>
          <span
            className="fi-position-card__name"
            style={{
              fontWeight: isLeaf ? undefined : 700,
              fontFamily: isLeaf ? undefined : 'Georgia, "Times New Roman", serif',
            }}
          >
            {workName}
          </span>
        </Tooltip>
      </div>
      {lines.map((line) => (
        <div key={line.label} className="fi-position-card__line">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {line.label}
          </Text>
          <span style={{ textAlign: 'right' }}>{line.value}</span>
        </div>
      ))}
    </div>
  );
}
