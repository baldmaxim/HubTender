/**
 * Карточный (read-only) вид таблицы КП для телефона в портрете.
 * Расчёт долей/итогов повторяет CommerceTable намеренно — десктопная таблица
 * покрыта тестом консистентности, её summary не трогаем.
 */

import { memo } from 'react';
import { Card, Tag, Typography, Empty, Space } from 'antd';
import type { PositionWithCommercialCost } from '../types';
import { formatCommercialCost } from '../../../utils/markupCalculator';
import { useIncrementalRender } from '../../../hooks/useIncrementalRender';

const { Text } = Typography;

interface CommerceCardsProps {
  positions: PositionWithCommercialCost[];
  insuranceTotal?: number;
  /** Флаг «Распределить во все строки». false → доля страхования по строкам = 0. */
  distributeToRows?: boolean;
  onNavigateToPosition: (positionId: string) => void;
  selectedTenderId: string | undefined;
}

const Metric: React.FC<{ label: string; value: string; color?: string; strong?: boolean }> = ({
  label,
  value,
  color,
  strong,
}) => (
  <div style={{ minWidth: 0 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
    <Text strong={strong} style={{ fontSize: 13, color, wordBreak: 'break-word' }}>{value}</Text>
  </div>
);

interface CommerceCardProps {
  record: PositionWithCommercialCost;
  /** Доля страхования позиции — число, посчитанное родителем по полному массиву. */
  ins: number;
  hasTender: boolean;
  onNavigateToPosition: (positionId: string) => void;
}

/**
 * Одна карточка КП. memo: шаги доращивания useIncrementalRender перерендеривают весь
 * visible-map — с границей уже отрендеренные карточки байлятся (record/ins у них те же).
 * На рефетче (loadPositions на каждую правку BOQ) объекты новые — там граница не
 * срабатывает, полный фикс только windowing.
 *
 * content-visibility: auto — браузер пропускает layout/paint карточек вне экрана;
 * contain-intrinsic-size держит высоту скроллбара до первого рендера карточки.
 */
const CommerceCard = memo(({ record, ins, hasTender, onNavigateToPosition }: CommerceCardProps) => {
  const isLeaf = record.is_leaf ?? true;
  const itemNoColor = isLeaf ? '#52c41a' : '#ff7875';
  const workCost = (record.work_cost_total || 0) + ins;
  const matCost = record.material_cost_total || 0;
  const commercial = (record.commercial_total || 0) + ins;
  const coeff = record.markup_percentage || 1;

  return (
    <Card
      size="small"
      hoverable={isLeaf}
      onClick={() => {
        if (isLeaf && hasTender) onNavigateToPosition(record.id);
      }}
      styles={{ body: { padding: 12 } }}
      style={{
        cursor: isLeaf ? 'pointer' : 'default',
        borderLeft: `3px solid ${isLeaf ? '#52c41a' : '#ff7875'}`,
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 140px',
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 8 }}>
        {record.is_additional ? (
          <Tag color="orange">ДОП</Tag>
        ) : record.position_number ? (
          <Tag color="blue">{record.position_number}</Tag>
        ) : null}
        {record.item_no && (
          <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>{record.item_no}</span>
        )}
        <span style={{ textDecoration: isLeaf ? 'underline' : 'none', fontWeight: isLeaf ? undefined : 700 }}>
          {record.work_name}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
        <Metric label="Кол-во" value={`${record.manual_volume || 0} ${record.unit_code || ''}`} />
        <Metric label="Базовая" value={formatCommercialCost(record.base_total || 0)} />
        <Metric label="Итого мат. (КП)" value={formatCommercialCost(matCost)} color="#1890ff" />
        <Metric label="Итого раб. (КП)" value={formatCommercialCost(workCost)} color="#52c41a" />
        <Metric label="Коммерческая" value={formatCommercialCost(commercial)} color="#52c41a" strong />
        <div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Коэфф.</Text>
          <Tag color={coeff > 1 ? 'green' : coeff < 1 ? 'red' : 'default'}>{coeff.toFixed(4)}</Tag>
        </div>
      </div>
    </Card>
  );
});

function CommerceCardsInner({
  positions,
  insuranceTotal = 0,
  distributeToRows = true,
  onNavigateToPosition,
  selectedTenderId,
}: CommerceCardsProps) {
  // Инкрементальный рендер: единственный список КП, у которого не было НИКАКОЙ границы —
  // голый .map по всем позициям тендера (сотни карточек в первый кадр).
  // resetKey — selectedTenderId, а не идентичность массива: Commerce намеренно не глушит
  // self-echo (см. useCommerceData), поэтому loadPositions срабатывает на каждую правку BOQ
  // и на идентичности выкидывало бы к первым 40 посреди прокрутки.
  // Хук вызываем ДО раннего return — правила хуков.
  const { visible, sentinelRef, hasMore } = useIncrementalRender(positions, 40, selectedTenderId);

  // ВАЖНО: итоги и insShare считаются по ПОЛНОМУ массиву, а не по visible. Резать можно
  // только .map ниже — иначе доля страхования в каждой карточке и весь блок «Итого»
  // молча посчитаются по видимой части и покажут неверные ДЕНЬГИ, а не просто лаг.
  let totalWorks = 0;
  let totalBase = 0;
  let totalMaterials = 0;
  let totalCommercial = 0;
  for (const p of positions) {
    totalWorks += p.work_cost_total || 0;
    totalBase += p.base_total || 0;
    totalMaterials += p.material_cost_total || 0;
    totalCommercial += p.commercial_total || 0;
  }
  const insShare = (pos: PositionWithCommercialCost) => {
    // Разнесение выключено → доля страхования по строкам = 0 (страхование остаётся
    // только в скалярном итоге totalWorksWithIns / «Финансовые показатели»).
    if (!distributeToRows) return 0;
    if (pos.insurance_share != null) return pos.insurance_share;
    return totalWorks > 0 ? insuranceTotal * ((pos.work_cost_total || 0) / totalWorks) : 0;
  };
  const totalWorksWithIns = totalWorks + insuranceTotal;
  const totalCommercialWithIns = totalCommercial + insuranceTotal;

  if (!positions.length) {
    return <Empty description="Нет позиций заказчика" />;
  }

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {visible.map((record) => (
        <CommerceCard
          key={record.id}
          record={record}
          ins={insShare(record)}
          hasTender={!!selectedTenderId}
          onNavigateToPosition={onNavigateToPosition}
        />
      ))}

      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      {/* Итоги показываем только когда список дорендерен целиком: иначе блок «Итого» всплыл
          бы сразу после 40-й карточки, изображая конец списка, и уезжал вниз по мере
          подгрузки. Так поведение совпадает с прежним — итоги в самом низу. */}
      {!hasMore && (
      <Card size="small" styles={{ body: { padding: 12 } }} style={{ borderLeft: '3px solid #10b981' }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Итого:</Text>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
          <Metric label="Базовая" value={formatCommercialCost(totalBase)} strong />
          <Metric label="Материалы (КП)" value={formatCommercialCost(totalMaterials)} color="#1890ff" strong />
          <Metric label="Работы (КП)" value={formatCommercialCost(totalWorksWithIns)} color="#52c41a" strong />
          <Metric label="Коммерческая" value={formatCommercialCost(totalCommercialWithIns)} color="#52c41a" strong />
          {insuranceTotal > 0 && (
            <Metric label="в т.ч. страхование" value={formatCommercialCost(insuranceTotal)} color="#10b981" />
          )}
          <Metric label="Коэфф." value={(totalBase > 0 ? totalCommercialWithIns / totalBase : 1).toFixed(4)} strong />
        </div>
      </Card>
      )}
    </Space>
  );
}

/**
 * memo: под keep-alive «Форма КП» остаётся смонтированной, пока пользователь работает во
 * вкладке позиции, и перерисовывалась на каждую навигацию — вместе со всем списком карточек.
 * Держится только пока onNavigateToPosition стабилен (в Commerce.tsx он на useCallback с
 * navigate в ref — см. комментарий там).
 */
export default memo(CommerceCardsInner);
