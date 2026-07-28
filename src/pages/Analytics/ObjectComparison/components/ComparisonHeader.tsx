/**
 * Шапка «Сравнения объектов»: выбор тендеров + общая статистика.
 * Десктоп (lg) и ландшафт телефона — карточки в один ряд, выровнены по высоте.
 * Портрет телефона — единый компактный блок: селекты по 2 в ряд, сводка
 * строкой под разделителем внутри той же карточки.
 */

import React from 'react';
import { Button, Card, Select, Space, Statistic, Typography, theme as antdTheme } from 'antd';
import { CloseOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Tender } from '../../../../lib/types';
import { useIsMobile } from '../../../../hooks/useIsMobile';
import { tenderLabel } from '../utils/comparisonFormat';

const { Text } = Typography;

interface ComparisonHeaderProps {
  tenders: Tender[];
  selectedTenders: (string | null)[];
  setSelectedTender: (index: number, value: string | null) => void;
  addTender: () => void;
  removeTender: (index: number) => void;
  loadComparisonData: () => void;
  loading: boolean;
  validCount: number;
  loadedInfos: (Tender | null)[];
  tenderTotals: number[];
  diffValue: number;
  costLabel: string;
  hasData: boolean;
  isMultiTender: boolean;
}

export const ComparisonHeader: React.FC<ComparisonHeaderProps> = ({
  tenders,
  selectedTenders,
  setSelectedTender,
  addTender,
  removeTender,
  loadComparisonData,
  loading,
  validCount,
  loadedInfos,
  tenderTotals,
  diffValue,
  costLabel,
  hasData,
  isMultiTender,
}) => {
  const { isPhone, isLandscapePhone, isPhoneDevice, screens } = useIsMobile();
  const { token } = antdTheme.useToken();

  const loadedCount = loadedInfos.length;
  const canRemove = selectedTenders.length > 2;
  const tenderOptions = tenders.map(t => ({ value: t.id, label: `${t.title} (v${t.version || 1})` }));
  const cardBodyPadding = isPhoneDevice ? '8px 10px' : undefined;
  const controlSize = isPhoneDevice ? ('small' as const) : ('middle' as const);

  // В ландшафте на плитку остаётся ~100px: шрифт сумм на 30% меньше и без знака ₽,
  // иначе миллиардные суммы обрезаются (валюта на странице всё равно одна).
  const titleFontSize = isPhone ? 10 : isLandscapePhone ? 9 : 12;
  const valueFontSize = isPhone ? 13 : isLandscapePhone ? 10.5 : 18;
  const valueSuffix = isLandscapePhone ? undefined : '₽';
  // На телефоне плитки делят ширину поровну и обрезают длинное имя тендера —
  // так сводка остаётся одной строкой без горизонтальной прокрутки.
  const tileStyle: React.CSSProperties = isPhoneDevice
    ? { flex: '1 1 0', minWidth: 0, textAlign: 'center' }
    : { padding: '0 12px', textAlign: 'center', flexShrink: 0 };
  const titleStyle: React.CSSProperties = {
    fontSize: titleFontSize,
    display: 'block',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const statTiles = (
    <>
      {loadedInfos.map((info, i: number) => (
        <div key={i} style={tileStyle}>
          <Statistic
            title={<span style={titleStyle}>{`Итого: ${tenderLabel(info, `Тендер ${i + 1}`)}`}</span>}
            value={tenderTotals[i] || 0}
            precision={0}
            groupSeparator=" "
            suffix={valueSuffix}
            valueStyle={{ fontSize: valueFontSize, whiteSpace: 'nowrap' }}
          />
        </div>
      ))}
      {loadedCount === 2 && (
        <div style={tileStyle}>
          <Statistic
            title={<span style={titleStyle}>Разница</span>}
            value={diffValue}
            precision={0}
            groupSeparator=" "
            suffix={valueSuffix}
            prefix={diffValue >= 0 ? '+' : ''}
            valueStyle={{ fontSize: valueFontSize, whiteSpace: 'nowrap', color: diffValue >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}
          />
        </div>
      )}
    </>
  );

  // Портрет: сводка — строка внутри карточки фильтров, без переноса (при
  // нехватке ширины прокручивается по горизонтали).
  const inlineStats = hasData ? (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'space-between',
        gap: 6,
        marginTop: 8,
        paddingTop: 8,
        borderTop: `1px solid ${token.colorSplit}`,
      }}
    >
      {statTiles}
    </div>
  ) : null;

  const selectionCard = (
    <Card styles={{ body: { padding: cardBodyPadding } }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isPhoneDevice ? 8 : 16 }}>
        {selectedTenders.map((val, idx) => {
          const info = val ? tenders.find(t => t.id === val) || null : null;
          return (
            <div
              key={idx}
              style={{
                flex: isPhone ? '1 1 calc(50% - 4px)' : isPhoneDevice ? '0 0 160px' : '0 0 210px',
                minWidth: isPhone ? 0 : isPhoneDevice ? 140 : 168,
              }}
            >
              <Space direction="vertical" size={isPhoneDevice ? 2 : 8} style={{ width: '100%' }}>
                {/* В портрете подпись не рендерим — её роль берёт placeholder селекта. */}
                {!isPhone && (
                  <Space align="center">
                    <Text strong>Тендер {idx + 1}</Text>
                    {canRemove && (
                      <Button type="text" size="small" icon={<CloseOutlined />} danger onClick={() => removeTender(idx)} />
                    )}
                  </Space>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  <Select
                    style={{ flex: 1, minWidth: 0 }}
                    size={controlSize}
                    placeholder={`Тендер ${idx + 1}`}
                    value={val}
                    onChange={(v) => setSelectedTender(idx, v ?? null)}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    options={tenderOptions}
                  />
                  {isPhone && canRemove && (
                    <Button type="text" size="small" icon={<CloseOutlined />} danger onClick={() => removeTender(idx)} />
                  )}
                </div>
                {info && (
                  <Text type="secondary" style={{ fontSize: isPhoneDevice ? 11 : 12 }}>
                    Создан: {dayjs(info.created_at).format('DD.MM.YYYY')}
                  </Text>
                )}
              </Space>
            </div>
          );
        })}
        <div style={{ flex: isPhone ? '1 1 100%' : '0 0 auto', minWidth: isPhone ? 0 : isPhoneDevice ? 0 : 240 }}>
          <Space direction="vertical" size={isPhoneDevice ? 2 : 8} style={{ width: '100%' }}>
            {/* Спейсер выравнивает кнопки с селектами — только там, где есть подписи. */}
            {!isPhone && (
              <Space align="center" style={{ visibility: 'hidden' }}>
                <Text strong>Тендер</Text>
              </Space>
            )}
            {isPhone ? (
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <Button size="small" icon={<PlusOutlined />} onClick={addTender} title="Добавить объект" />
                <Button
                  type="primary"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadComparisonData}
                  loading={loading}
                  disabled={validCount < 2}
                  style={{ flex: 1 }}
                >
                  Загрузить сравнение
                </Button>
              </div>
            ) : (
              <Space wrap>
                {/* В ландшафте телефона «Добавить объект» — иконкой, чтобы ряд не переносился. */}
                <Button size={controlSize} icon={<PlusOutlined />} onClick={addTender} title={isPhoneDevice ? 'Добавить объект' : undefined}>
                  {isPhoneDevice ? undefined : 'Добавить объект'}
                </Button>
                <Button
                  type="primary"
                  size={controlSize}
                  icon={<ReloadOutlined />}
                  onClick={loadComparisonData}
                  loading={loading}
                  disabled={validCount < 2}
                >
                  {isPhoneDevice ? 'Загрузить' : 'Загрузить сравнение'}
                </Button>
              </Space>
            )}
          </Space>
        </div>
      </div>
      {isPhone && inlineStats}
    </Card>
  );

  const statsCard = hasData ? (
    <Card
      // В ландшафте телефона заголовок съедает ~40px, а тип затрат виден в шапке таблицы.
      title={isPhoneDevice ? undefined : `Общая статистика (${costLabel.toLowerCase()} затраты)`}
      style={{ height: '100%' }}
      styles={{
        body: {
          padding: isPhoneDevice ? '8px 10px' : '8px 16px',
          display: 'flex',
          alignItems: 'center',
          minHeight: isPhoneDevice ? undefined : 72,
        },
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-start', gap: isPhoneDevice ? 8 : 24, width: '100%' }}>
        {statTiles}
      </div>
    </Card>
  ) : null;

  // Ландшафт телефона по горизонтали не уже широкого десктопа — раскладываем так же.
  const showStatsBeside = (screens.lg || isLandscapePhone) && !isMultiTender && hasData;

  if (isPhone) return selectionCard;

  return showStatsBeside ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: isPhoneDevice ? 8 : 16, alignItems: 'stretch' }}>
      <div style={{ flex: '0 1 auto', minWidth: 0 }}>{selectionCard}</div>
      <div style={{ flex: isPhoneDevice ? '1 1 200px' : '1 1 320px', minWidth: isPhoneDevice ? 180 : 280 }}>{statsCard}</div>
    </div>
  ) : (
    <>
      {selectionCard}
      {statsCard}
    </>
  );
};

export default ComparisonHeader;
