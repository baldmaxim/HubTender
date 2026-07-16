import React from 'react';
import { Card, Tag, Typography, Empty, Spin, Space } from 'antd';
import type { ClientPosition, Tender } from '../../../lib/types';
import { formatRu } from '../../../utils/format/currency';
import { useIncrementalRender } from '../../../hooks/useIncrementalRender';
import { renderStrikeRuns, renderStruck } from '../../../components/RichText/StrikeText';

const { Text } = Typography;

interface PositionCardListProps {
  clientPositions: ClientPosition[];
  selectedTender: Tender | null;
  loading: boolean;
  positionCounts: Record<string, { works: number; materials: number; total: number }>;
  leafPositionIndices: Set<string>;
  /** Только для resetKey инкрементального рендера. ДЕФЕРРЕННЫЙ запрос — не значение Input:
   *  само поле живёт в ClientPositions, иначе недеферренное значение пробивало бы memo на
   *  каждый символ. Ключ должен меняться в том же проходе, что и отфильтрованный список. */
  searchKey: string;
  onRowClick: (record: ClientPosition, index: number) => void;
}

/**
 * Карточный (read-only) вид позиций заказчика для телефона.
 * Иерархия кодируется цветом левого бордера (лист — зелёный, раздел — красный)
 * и отступом для ДОП-строк вместо fixed-колонок таблицы.
 * Действия строки (копирование/удаление/фильтр) на телефоне скрыты — только просмотр.
 *
 * memo обязателен: любой рендер ClientPositions иначе перестраивает все отрендеренные
 * карточки — а их по мере скролла набирается 40/80/120 (useIncrementalRender только растит
 * count и никогда не размонтирует уехавшее), и тап начинает ощутимо тормозить.
 *
 * ВСЕ пропы обязаны быть стабильными, иначе memo бесполезен. Два места, где это легко
 * сломать (и где уже ломалось):
 *   - `onRowClick`: в ClientPositions он на useCallback БЕЗ `navigate` в deps — react-router
 *     пересоздаёт navigate на каждую навигацию, поэтому он держится в ref. Иначе список
 *     перерисовывался на каждое переключение/открытие вкладки.
 *   - `searchKey`: только ДЕФЕРРЕННЫЙ запрос. Поле поиска живёт в ClientPositions; когда
 *     Input был здесь, недеферренное значение пробивало memo на каждый символ.
 * На собственный state (порции useIncrementalRender) memo не влияет — подгрузка работает.
 */
const PositionCardListInner: React.FC<PositionCardListProps> = ({
  clientPositions,
  selectedTender,
  loading,
  positionCounts,
  leafPositionIndices,
  searchKey,
  onRowClick,
}) => {
  // Инкрементальный рендер: на крупном тендере не строим все карточки позиций разом.
  // resetKey — тендер+поиск, а не идентичность массива: realtime-рефетч отдаёт новый
  // массив с той же выборкой, и на идентичности прокрутку сбрасывало бы к первой порции.
  const { visible, sentinelRef, hasMore } = useIncrementalRender(
    clientPositions,
    40,
    `${selectedTender?.id ?? ''}|${searchKey}`
  );

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : clientPositions.length === 0 ? (
        <Empty description="Нет позиций заказчика" style={{ padding: 40 }} />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {visible.map((record, index) => {
            const isLeaf = leafPositionIndices.has(record.id);
            const sectionColor = isLeaf ? '#52c41a' : '#ff7875';
            const counts = positionCounts[record.id] || { works: 0, materials: 0, total: 0 };
            const indent = record.is_additional ? 16 : 0;

            return (
              <Card
                key={record.id}
                size="small"
                hoverable={isLeaf}
                onClick={() => onRowClick(record, index)}
                styles={{ body: { padding: 12 } }}
                style={{
                  cursor: isLeaf && selectedTender ? 'pointer' : 'default',
                  borderLeft: `4px solid ${sectionColor}`,
                  marginLeft: indent,
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  {record.is_additional ? (
                    <Tag color="orange" style={{ marginRight: 6 }}>ДОП</Tag>
                  ) : (
                    record.item_no && (
                      <Text strong style={{ color: sectionColor, marginRight: 6 }}>{renderStrikeRuns(record.rich_runs?.item_no, record.item_no)}</Text>
                    )
                  )}
                  <Text
                    style={{
                      textDecoration: isLeaf ? 'underline' : 'none',
                      fontWeight: isLeaf ? undefined : 700,
                      fontFamily: isLeaf ? undefined : 'Georgia, "Times New Roman", serif',
                      wordBreak: 'break-word',
                    }}
                  >
                    {renderStrikeRuns(record.rich_runs?.work_name, record.work_name)}
                  </Text>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
                  <div>
                    <Text type="secondary">Кол-во (заказчик): </Text>
                    <Text strong>{record.volume != null ? renderStruck(record.rich_runs?.volume_struck, record.volume.toFixed(2)) : '—'}</Text>
                    {record.unit_code ? ` ${record.unit_code}` : ''}
                  </div>
                  {isLeaf && (
                    <div>
                      <Text type="secondary">Кол-во (ГП): </Text>
                      <Text>{record.manual_volume != null ? record.manual_volume.toFixed(2) : '—'}</Text>
                      {record.unit_code ? ` ${record.unit_code}` : ''}
                    </div>
                  )}
                </div>

                {record.client_note && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <Text type="secondary">Прим. заказчика: </Text>
                    <Text italic>{renderStrikeRuns(record.rich_runs?.client_note, record.client_note)}</Text>
                  </div>
                )}
                {record.manual_note && (
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    <Text type="secondary">Прим. ГП: </Text>
                    <Text>{record.manual_note}</Text>
                  </div>
                )}

                {(counts.works > 0 || counts.materials > 0) && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13 }}>
                      Р: <span style={{ color: '#ff9800', fontWeight: 600 }}>{counts.works}</span>
                      {'  '}
                      М: <span style={{ color: '#1890ff', fontWeight: 600 }}>{counts.materials}</span>
                    </span>
                    {counts.total > 0 && (
                      <Text strong style={{ fontSize: 15, color: '#389e0d' }}>
                        {formatRu(Math.round(counts.total))}
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
        </Space>
      )}
    </div>
  );
};

export const PositionCardList = React.memo(PositionCardListInner);
