import React, { useState, useMemo, useCallback } from 'react';
import { Card, Typography, Select, Table, Space, Statistic, Row, Col, Button, Spin, Segmented } from 'antd';
import { BarChartOutlined, ReloadOutlined, DownloadOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useComparisonData } from './hooks/useComparisonData';
import type { ComparisonRow, CostType, ViewMode } from './types';
import { exportComparisonToExcel } from './utils/exportComparisonToExcel';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTheme } from '../../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../../components/responsive/LandscapeTableOverlay';
import { DiffCell, DiffPerUnitCell, NoteCell } from './components/comparisonCells';
import { formatNum, formatPerUnit, tenderLabel, getDiff } from './utils/comparisonFormat';

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
  const isDetailed = !isMultiTender && effectiveViewMode === 'detailed';
  // В ландшафте телефона мульти-тендер (без редактируемых примечаний) показываем оверлеем.
  const useOverlay = isLandscapePhone && isMultiTender;
  const costLabel = costType === 'commercial' ? 'Коммерческие' : 'Прямые';
  const validCount = selectedTenders.filter(Boolean).length;

  const handleNoteBlur = useCallback((record: ComparisonRow, value: string) => {
    const categoryName = record.is_main_category ? record.category : (record.mainCategoryName || '');
    const detailKey = record.is_main_category ? null : record.key;
    saveNote(categoryName, detailKey, value);
  }, [saveNote]);

  const columns: ColumnsType<ComparisonRow> = useMemo(() => {
    if (loadedCount === 0) {
      return [{ title: 'Категория затрат', dataIndex: 'category', key: 'category', width: 280 }];
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
      width: 280,
      render: (text: string, record: ComparisonRow) => (
        <Text
          strong={record.is_main_category || record.is_location}
          italic={record.is_location}
          type={record.is_location ? 'secondary' : undefined}
        >
          {text}
        </Text>
      ),
    };

    const tenderGroups = labels.map((label: string, i: number) => {
      const children: ColumnsType<ComparisonRow> = [];

      if (isDetail) {
        children.push(
          { title: <div style={{ textAlign: 'center' }}>Материалы</div>, key: `t${i}_mat`, align: 'right' as const, width: 130, render: (_: unknown, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(r.tenders[i]?.materials ?? 0)}</Text> },
          { title: <div style={{ textAlign: 'center' }}>Работы</div>, key: `t${i}_work`, align: 'right' as const, width: 130, render: (_: unknown, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(r.tenders[i]?.works ?? 0)}</Text> },
        );
      }
      children.push({ title: <div style={{ textAlign: 'center' }}>Итого</div>, key: `t${i}_total`, align: 'right' as const, width: 140, render: (_: unknown, r: ComparisonRow) => <Text strong>{formatNum(r.tenders[i]?.total ?? 0)}</Text> });
      if (isDetail) {
        children.push(
          { title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>, key: `t${i}_mpu`, align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.mat_per_unit ?? 0)}</Text> },
          { title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>, key: `t${i}_wpu`, align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.work_per_unit ?? 0)}</Text> },
        );
      }
      children.push({ title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>, key: `t${i}_tpu`, align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <Text strong style={{ color: '#0891b2' }}>{formatPerUnit(r.tenders[i]?.total_per_unit ?? 0)}</Text> });

      return { title: <div style={{ textAlign: 'center' }}>{label}</div>, children };
    });

    const result: ColumnsType<ComparisonRow> = [categoryCol, ...tenderGroups];

    // Diff group — only for exactly 2 loaded tenders
    if (!isMulti) {
      const diffChildren: ColumnsType<ComparisonRow> = [];
      if (isDetail) {
        diffChildren.push(
          { title: <div style={{ textAlign: 'center' }}>Материалы</div>, key: 'diff_mat', align: 'right' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'materials'); return <DiffCell value={d.value} percent={d.percent} />; } },
          { title: <div style={{ textAlign: 'center' }}>Работы</div>, key: 'diff_work', align: 'right' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'works'); return <DiffCell value={d.value} percent={d.percent} />; } },
        );
      }
      diffChildren.push({ title: <div style={{ textAlign: 'center' }}>Итого</div>, key: 'diff_total', align: 'right' as const, width: 140, render: (_: unknown, r: ComparisonRow) => { const d = getDiff(r, 'total'); return <DiffCell value={d.value} percent={d.percent} bold />; } });
      if (isDetail) {
        diffChildren.push(
          { title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>, key: 'diff_mpu', align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'mat_per_unit').value} /> },
          { title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>, key: 'diff_wpu', align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'work_per_unit').value} /> },
        );
      }
      diffChildren.push({ title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>, key: 'diff_tpu', align: 'right' as const, width: 110, render: (_: unknown, r: ComparisonRow) => <DiffPerUnitCell value={getDiff(r, 'total_per_unit').value} /> });

      result.push({ title: <div style={{ textAlign: 'center' }}>Разница</div>, children: diffChildren });

      result.push({
        title: <div style={{ textAlign: 'center' }}>Примечание</div>,
        key: 'note',
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
  }, [tenderInfos, effectiveViewMode, handleNoteBlur, loadedCount, readOnly, useOverlay]);

  const scrollX = isMultiTender
    ? 280 + loadedCount * 250
    : isDetailed ? 2930 : 1230;

  // Stats for 2-tender diff
  const diffValue = loadedCount === 2 ? (tenderTotals[1] || 0) - (tenderTotals[0] || 0) : 0;
  const diffPercent = (tenderTotals[0] || 0) > 0
    ? ((diffValue / tenderTotals[0]) * 100).toFixed(2)
    : '0';

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
    <div style={{ padding: isPhoneDevice ? 12 : 24 }}>
      {loadedTenderIds.map((id) => (
        <TenderRealtimeRefresh key={id} tenderId={id} onChange={refreshComparison} />
      ))}
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Выбор тендеров */}
        <Card title="Выбор объектов для сравнения">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
            {selectedTenders.map((val, idx) => {
              const info = val ? tenders.find(t => t.id === val) || null : null;
              return (
                <div key={idx} style={{ flex: isPhone ? '1 1 100%' : '0 0 300px', minWidth: isPhone ? 0 : 240 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space align="center">
                      <Text strong>Тендер {idx + 1}</Text>
                      {selectedTenders.length > 2 && (
                        <Button
                          type="text"
                          size="small"
                          icon={<CloseOutlined />}
                          danger
                          onClick={() => removeTender(idx)}
                        />
                      )}
                    </Space>
                    <Select
                      style={{ width: '100%' }}
                      placeholder={`Выберите тендер ${idx + 1}`}
                      value={val}
                      onChange={(v) => setSelectedTender(idx, v ?? null)}
                      showSearch
                      optionFilterProp="label"
                      allowClear
                      options={tenders.map(t => ({ value: t.id, label: `${t.title} (v${t.version || 1})` }))}
                    />
                    {info && (
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        Создан: {dayjs(info.created_at).format('DD.MM.YYYY')}
                      </Text>
                    )}
                  </Space>
                </div>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              <Button icon={<PlusOutlined />} onClick={addTender}>
                Добавить объект
              </Button>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={loadComparisonData}
              loading={loading}
              disabled={validCount < 2}
            >
              Загрузить сравнение
            </Button>
          </div>
        </Card>

        {/* Общая статистика */}
        {comparisonData.length > 0 && (
          <Card title={`Общая статистика (${costLabel.toLowerCase()} затраты)`}>
            <Row gutter={[16, 16]}>
              {loadedInfos.map((info, i: number) => (
                <Col key={i} xs={24} md={loadedCount <= 3 ? Math.floor(24 / (loadedCount + (loadedCount === 2 ? 1 : 0))) : 6}>
                  <Statistic
                    title={`Итого: ${tenderLabel(info, `Тендер ${i + 1}`)}`}
                    value={tenderTotals[i] || 0}
                    precision={0}
                    suffix="₽"
                  />
                </Col>
              ))}
              {loadedCount === 2 && (
                <Col xs={24} md={8}>
                  <Statistic
                    title="Разница"
                    value={diffValue}
                    precision={0}
                    suffix="₽"
                    valueStyle={{ color: diffValue >= 0 ? '#52c41a' : '#ff4d4f' }}
                    prefix={diffValue >= 0 ? '+' : ''}
                  />
                  <Text type="secondary">
                    ({diffPercent}% {diffValue >= 0 ? 'больше' : 'меньше'})
                  </Text>
                </Col>
              )}
            </Row>
          </Card>
        )}

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
          <Card title={comparisonCardTitle}>
            {useOverlay ? (
              <LandscapeTableOverlay theme={currentTheme} width={scrollX}>
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
              <Table
                columns={columns}
                dataSource={comparisonData}
                rowKey="key"
                pagination={false}
                scroll={{ x: scrollX }}
                sticky
                bordered
                size="small"
                expandable={{ defaultExpandAllRows: false }}
                rowClassName={(record) => record.is_main_category ? 'comparison-category-row' : ''}
              />
            )}
          </Card>
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
