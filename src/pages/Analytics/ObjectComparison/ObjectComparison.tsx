import React, { useState, useMemo, useCallback } from 'react';
import { Card, Typography, Table, Space, Row, Col, Button, Spin, Segmented, Alert } from 'antd';
import { formatFXUnavailable } from '../../../utils/boq/currencyGuard';
import { BarChartOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useComparisonData } from './hooks/useComparisonData';
import type { ComparisonRow, CostType, ViewMode } from './types';
import { exportComparisonToExcel } from './utils/exportComparisonToExcel';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTheme } from '../../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../../components/responsive/LandscapeTableOverlay';
import { DiffCell, DiffPerUnitCell, NoteCell } from './components/comparisonCells';
import { ComparisonHeader } from './components/ComparisonHeader';
import { formatNum, formatPerUnit, tenderLabel, getDiff, sumLeafWidths } from './utils/comparisonFormat';
import { useTableScrollY } from './hooks/useTableScrollY';

const { Text } = Typography;

// Невидимый подписчик: один на сравниваемый тендер. Триггерит тихую
// перезагрузку сравнения при изменении BOQ/наценок этого тендера (как ФП).
const TenderRealtimeRefresh: React.FC<{ tenderId: string; onChange: () => void }> = ({ tenderId, onChange }) => {
  useRealtimeTopic(`tender:${tenderId}`, onChange);
  return null;
};

const ObjectComparison: React.FC = () => {
  const {
    tenders,
    selectedTenders, setSelectedTender, addTender, removeTender,
    tenderInfos,
    loading,
    comparisonData,
    costType, setCostType,
    loadComparisonData,
    loadedTenderIds,
    refreshComparison,
    tenderTotals,
    saveNote,
    fxMissing,
  } = useComparisonData();

  const [viewMode, setViewMode] = useState<ViewMode>('detailed');
  const { isPhone, isLandscapePhone, isMobile, isPhoneDevice } = useIsMobile();
  const { theme: currentTheme } = useTheme();
  // На телефоне страница read-only (примечания правятся на десктопе) и в портрете
  // принудительно упрощённый вид (узкий экран).
  const readOnly = isMobile || isLandscapePhone;

  const loadedInfos = tenderInfos.filter(Boolean);
  const loadedCount = loadedInfos.length;
  const isMultiTender = loadedCount > 2;
  const effectiveViewMode: ViewMode = isPhone ? 'simplified' : viewMode;
  // В ландшафте телефона узкие варианты таблицы (мульти-тендер и упрощённый вид, ≤ ~1300px)
  // показываем полноэкранным оверлеем. Детальный вид (~2700px) там вписался бы масштабом ~0.3 —
  // нечитаемо, поэтому остаётся обычной таблицей с горизонтальным скроллом.
  const useOverlay = isLandscapePhone && (isMultiTender || viewMode === 'simplified');
  const costLabel = costType === 'commercial' ? 'Коммерческие' : 'Прямые';
  const validCount = selectedTenders.filter(Boolean).length;

  const handleNoteBlur = useCallback((record: ComparisonRow, value: string) => {
    const categoryName = record.is_main_category ? record.category : (record.mainCategoryName || '');
    const detailKey = record.is_main_category ? null : record.key;
    saveNote(categoryName, detailKey, value);
  }, [saveNote]);

  // В портрете телефона колонка категории = половина ширины экрана.
  const categoryWidth = isPhone ? Math.round(window.innerWidth / 2) : 280;

  const columns: ColumnsType<ComparisonRow> = useMemo(() => {
    if (loadedCount === 0) {
      return [{ title: 'Категория затрат', dataIndex: 'category', key: 'category', width: categoryWidth }];
    }

    const isMulti = loadedCount > 2;
    const isDetail = !isMulti && effectiveViewMode === 'detailed';
    const labels = loadedInfos.map((info, i: number) => tenderLabel(info, `Тендер ${i + 1}`));

    const categoryCol = {
      title: <div style={{ textAlign: 'center' }}>Категория затрат</div>,
      dataIndex: 'category',
      key: 'category',
      // fixed-колонка ломается под transform:scale в ландшафтном оверлее
      ...(useOverlay ? {} : { fixed: 'left' as const }),
      width: categoryWidth,
      render: (text: string, record: ComparisonRow) => (
        <Text
          strong={record.is_main_category || record.is_location}
          italic={record.is_location}
          type={record.is_location ? 'secondary' : undefined}
          style={{ whiteSpace: 'normal', wordBreak: 'break-word', ...(record.is_super_group ? { fontSize: 15 } : {}) }}
        >
          {text}
        </Text>
      ),
    };

    const tenderGroups = labels.map((label: string, i: number) => {
      const children: ColumnsType<ComparisonRow> = [];

      if (isDetail) {
        children.push(
          { title: <div style={{ textAlign: 'center' }}>Материалы</div>, key: `t${i}_mat`, align: 'center' as const, width: 130, render: (_: unknown, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(r.tenders[i]?.materials ?? 0)}</Text> },
          { title: <div style={{ textAlign: 'center' }}>Работы</div>, key: `t${i}_work`, align: 'center' as const, width: 130, render: (_: unknown, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(r.tenders[i]?.works ?? 0)}</Text> },
        );
      }
      children.push({ title: <div style={{ textAlign: 'center' }}>Итого</div>, key: `t${i}_total`, align: 'center' as const, width: 140, render: (_: unknown, r: ComparisonRow) => <Text strong>{formatNum(r.tenders[i]?.total ?? 0)}</Text> });
      if (isDetail) {
        children.push(
          { title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>, key: `t${i}_mpu`, align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.mat_per_unit ?? 0)}</Text> },
          { title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>, key: `t${i}_wpu`, align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.work_per_unit ?? 0)}</Text> },
        );
      }
      children.push({ title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>, key: `t${i}_tpu`, align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text strong style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.total_per_unit ?? 0)}</Text> });

      return { title: <div style={{ textAlign: 'center' }}>{label}</div>, children };
    });

    const result: ColumnsType<ComparisonRow> = [categoryCol, ...tenderGroups];

    // Diff group — only for exactly 2 loaded tenders
    if (!isMulti) {
      const diffChildren: ColumnsType<ComparisonRow> = [];
      if (isDetail) {
        diffChildren.push(
          { title: <div style={{ textAlign: 'center' }}>Материалы</div>, key: 'diff_mat', align: 'center' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'materials'); return <DiffCell value={d.value} percent={d.percent} />; } },
          { title: <div style={{ textAlign: 'center' }}>Работы</div>, key: 'diff_work', align: 'center' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'works'); return <DiffCell value={d.value} percent={d.percent} />; } },
        );
      }
      diffChildren.push({ title: <div style={{ textAlign: 'center' }}>Итого</div>, key: 'diff_total', align: 'center' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'total'); return <DiffCell value={d.value} percent={d.percent} bold />; } });
      if (isDetail) {
        diffChildren.push(
          { title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>, key: 'diff_mpu', align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'mat_per_unit').value} /> },
          { title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>, key: 'diff_wpu', align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'work_per_unit').value} /> },
        );
      }
      diffChildren.push({ title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>, key: 'diff_tpu', align: 'center' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'total_per_unit').value} /> });

      result.push({ title: <div style={{ textAlign: 'center' }}>Разница</div>, children: diffChildren });

      result.push({
        title: <div style={{ textAlign: 'center' }}>Примечание</div>,
        key: 'note',
        align: 'center' as const,
        width: 200,
        render: (_: unknown, record: ComparisonRow) =>
          readOnly ? (
            <Text>{record.note || '—'}</Text>
          ) : (
            <NoteCell key={record.key} record={record} onSave={handleNoteBlur} />
          ),
      });
    }

    return result;
    // loadedInfos is intentionally excluded; adding it would cause excessive recomputation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderInfos, effectiveViewMode, handleNoteBlur, loadedCount, readOnly, useOverlay, categoryWidth]);

  // Ширина таблицы = точная сумма ширин колонок (иначе шапка и тело расходятся по границам).
  const scrollX = useMemo(() => sumLeafWidths(columns), [columns]);

  // Десктоп/планшет: страница фиксирована по высоте экрана, скроллится только тело таблицы
  // (шапка закреплена внутри таблицы) — как на «Затратах на строительство».
  // Ландшафт телефона: страница скроллится, но карточка таблицы липкая — доскроллив,
  // пользователь получает таблицу на весь экран с закреплённой шапкой колонок.
  const pinTable = isLandscapePhone && !useOverlay;
  const { ref: tableWrapRef, scrollY: tableScrollY, availH: tableAvailH } = useTableScrollY(
    !isPhone && !useOverlay,
    `${loadedCount}-${selectedTenders.length}-${effectiveViewMode}-${comparisonData.length}-${fxMissing.length}`,
    pinTable ? { pinned: true, minBody: 96 } : undefined,
  );

  // Stats for 2-tender diff
  const diffValue = loadedCount === 2 ? (tenderTotals[1] || 0) - (tenderTotals[0] || 0) : 0;

  const tenderLabelsForExport = loadedInfos.map((info, i: number) => tenderLabel(info, `Тендер ${i + 1}`));

  const comparisonCardTitle = (
    <Row justify="space-between" align="middle" gutter={[8, 8]}>
      <Col>{`Сравнение по категориям (${costLabel.toLowerCase()} затраты)`}</Col>
      <Col>
        <Space wrap>
          {/* Переключатель вида скрыт на телефоне — там принудительно «упрощённое» */}
          {!isMultiTender && !isPhone && (
            <Segmented
              options={[
                { label: 'Упрощённое', value: 'simplified' },
                { label: 'Детальное', value: 'detailed' },
              ]}
              value={viewMode}
              onChange={(value) => setViewMode(value as ViewMode)}
            />
          )}
          <Segmented
            options={[
              { label: 'Прямые затраты', value: 'base' },
              { label: 'Коммерческие затраты', value: 'commercial' },
            ]}
            value={costType}
            onChange={(value) => setCostType(value as CostType)}
          />
          {!isPhoneDevice && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() => exportComparisonToExcel({ comparisonData, costType, tenderLabels: tenderLabelsForExport })}
              disabled={comparisonData.length === 0}
            >
              Excel
            </Button>
          )}
        </Space>
      </Col>
    </Row>
  );

  return (
    <div
      style={{
        paddingTop: 0,
        paddingBottom: isPhoneDevice ? 12 : 24,
        paddingLeft: isPhoneDevice ? 4 : 24,
        paddingRight: isPhoneDevice ? 4 : 24,
        // В ландшафте <Content> (MainLayout) даёт 16px по бокам — гасим отрицательным
        // margin, чтобы контент дошёл до края экрана. В портрете у Content боков нет.
        marginLeft: isLandscapePhone ? -16 : 0,
        marginRight: isLandscapePhone ? -16 : 0,
        // Десктоп/планшет: страница ровно по высоте экрана (64 шапка + 2×16 padding Content),
        // сама не скроллится — скроллится тело таблицы со своей полосой.
        height: isPhoneDevice ? 'auto' : 'calc(100vh - 96px)',
        overflow: isPhoneDevice ? undefined : 'hidden',
      }}
    >
      {loadedTenderIds.map((id) => (
        <TenderRealtimeRefresh key={id} tenderId={id} onChange={refreshComparison} />
      ))}
      {fxMissing.length > 0 && (
        <Alert type="error" showIcon message={formatFXUnavailable(fxMissing)} style={{ marginBottom: 12 }} />
      )}
      <Space direction="vertical" size={isPhoneDevice ? 'small' : 'large'} style={{ width: '100%' }}>
        <ComparisonHeader
          tenders={tenders}
          selectedTenders={selectedTenders}
          setSelectedTender={setSelectedTender}
          addTender={addTender}
          removeTender={removeTender}
          loadComparisonData={loadComparisonData}
          loading={loading}
          validCount={validCount}
          loadedInfos={loadedInfos}
          tenderTotals={tenderTotals}
          diffValue={diffValue}
          costLabel={costLabel}
          hasData={comparisonData.length > 0}
          isMultiTender={isMultiTender}
        />

        {/* Таблица сравнения */}
        {loading ? (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size="large" />
              <div style={{ marginTop: '16px' }}>
                <Text>Загрузка данных для сравнения...</Text>
              </div>
            </div>
          </Card>
        ) : comparisonData.length > 0 ? (
          <div style={pinTable ? { position: 'sticky', top: 0, height: tableAvailH, zIndex: 2 } : undefined}>
            <Card
              title={comparisonCardTitle}
              styles={{ body: { padding: 0 } }}
              style={pinTable ? { height: '100%' } : undefined}
            >
              {useOverlay ? (
                <LandscapeTableOverlay theme={currentTheme} fit="width" stickyHeader width={scrollX}>
                  <Table
                    columns={columns}
                    dataSource={comparisonData}
                    rowKey="key"
                    pagination={false}
                    bordered
                    size="small"
                    expandable={{ defaultExpandAllRows: false }}
                    rowClassName={(record) => record.is_main_category ? 'comparison-category-row' : ''}
                  />
                </LandscapeTableOverlay>
              ) : (
                <div ref={tableWrapRef}>
                  <Table
                    columns={columns}
                    dataSource={comparisonData}
                    rowKey="key"
                    pagination={false}
                    // Десктоп/планшет и ландшафт телефона: шапка закреплена внутри таблицы (scroll.y),
                    // как на «Затратах». Портрет: прежнее поведение — шапка липнет к верху окна.
                    scroll={isPhone ? { x: scrollX } : { x: scrollX, y: tableScrollY }}
                    sticky={isPhone}
                    bordered
                    size="small"
                    expandable={{ defaultExpandAllRows: false }}
                    rowClassName={(record) => record.is_main_category ? 'comparison-category-row' : ''}
                  />
                </div>
              )}
            </Card>
          </div>
        ) : (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <BarChartOutlined style={{ fontSize: '64px', color: '#ccc' }} />
              <div style={{ marginTop: '16px' }}>
                <Text type="secondary">Выберите объекты и нажмите &quot;Загрузить сравнение&quot;</Text>
              </div>
            </div>
          </Card>
        )}
      </Space>
    </div>
  );
};

export default ObjectComparison;
