import React, { useState, useMemo } from 'react';
import { Card, Typography, Select, Table, Space, Statistic, Row, Col, Button, Spin, Segmented } from 'antd';
import { BarChartOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useComparisonData } from './hooks/useComparisonData';
import type { ComparisonRow, CostType, ViewMode } from './types';
import { exportComparisonToExcel } from './utils/exportComparisonToExcel';

const { Text } = Typography;
const { Option } = Select;

const formatNum = (value: number) =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatPerUnit = (value: number) =>
  value > 0
    ? value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const DiffCell: React.FC<{ value: number; percent: number; bold?: boolean }> = ({ value, percent, bold }) => (
  <Space direction="vertical" size={0}>
    <Text strong={bold} style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
      {formatNum(value)}
    </Text>
    <Text type="secondary" style={{ fontSize: '12px' }}>
      ({percent >= 0 ? '+' : ''}{percent.toFixed(1)}%)
    </Text>
  </Space>
);

const DiffPerUnitCell: React.FC<{ value: number }> = ({ value }) => {
  if (value === 0) return <Text>—</Text>;
  return (
    <Text style={{ color: value >= 0 ? '#52c41a' : '#ff4d4f' }}>
      {value >= 0 ? '+' : ''}{formatNum(value)}
    </Text>
  );
};

const tenderLabel = (info: { title: string; version?: number } | null, fallback: string) => {
  if (!info) return fallback;
  return `${info.title} (v${info.version || 1})`;
};

const ObjectComparison: React.FC = () => {
  const {
    tenders,
    selectedTender1, setSelectedTender1,
    selectedTender2, setSelectedTender2,
    tender1Info, tender2Info,
    loading,
    comparisonData,
    costType, setCostType,
    loadComparisonData,
    totalStats, diffPercent,
  } = useComparisonData();

  const [viewMode, setViewMode] = useState<ViewMode>('detailed');

  const costLabel = costType === 'commercial' ? 'Коммерческие' : 'Прямые';
  const t1Label = tenderLabel(tender1Info, 'Тендер 1');
  const t2Label = tenderLabel(tender2Info, 'Тендер 2');
  const isDetailed = viewMode === 'detailed';

  const columns: ColumnsType<ComparisonRow> = useMemo(() => {
    const categoryCol = {
      title: <div style={{ textAlign: 'center' }}>Категория затрат</div>,
      dataIndex: 'category',
      key: 'category',
      fixed: 'left' as const,
      width: 280,
      render: (text: string, record: ComparisonRow) => (
        <Text strong={record.is_main_category}>{text}</Text>
      ),
    };

    const t1Children: any[] = [];
    const t2Children: any[] = [];
    const diffChildren: any[] = [];

    if (isDetailed) {
      t1Children.push(
        {
          title: <div style={{ textAlign: 'center' }}>Материалы</div>,
          dataIndex: 'tender1_materials', key: 'tender1_materials',
          align: 'right' as const, width: 130,
          render: (v: number, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(v)}</Text>,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Работы</div>,
          dataIndex: 'tender1_works', key: 'tender1_works',
          align: 'right' as const, width: 130,
          render: (v: number, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(v)}</Text>,
        },
      );
      t2Children.push(
        {
          title: <div style={{ textAlign: 'center' }}>Материалы</div>,
          dataIndex: 'tender2_materials', key: 'tender2_materials',
          align: 'right' as const, width: 130,
          render: (v: number, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(v)}</Text>,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Работы</div>,
          dataIndex: 'tender2_works', key: 'tender2_works',
          align: 'right' as const, width: 130,
          render: (v: number, r: ComparisonRow) => <Text strong={r.is_main_category}>{formatNum(v)}</Text>,
        },
      );
      diffChildren.push(
        {
          title: <div style={{ textAlign: 'center' }}>Материалы</div>,
          dataIndex: 'diff_materials', key: 'diff_materials',
          align: 'right' as const, width: 140,
          render: (_: number, r: ComparisonRow) => <DiffCell value={r.diff_materials} percent={r.diff_materials_percent} />,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Работы</div>,
          dataIndex: 'diff_works', key: 'diff_works',
          align: 'right' as const, width: 140,
          render: (_: number, r: ComparisonRow) => <DiffCell value={r.diff_works} percent={r.diff_works_percent} />,
        },
      );
    }

    // Итого — всегда
    t1Children.push({
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'tender1_total', key: 'tender1_total',
      align: 'right' as const, width: 140,
      render: (v: number) => <Text strong>{formatNum(v)}</Text>,
    });
    t2Children.push({
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'tender2_total', key: 'tender2_total',
      align: 'right' as const, width: 140,
      render: (v: number) => <Text strong>{formatNum(v)}</Text>,
    });
    diffChildren.push({
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'diff_total', key: 'diff_total',
      align: 'right' as const, width: 140,
      render: (_: number, r: ComparisonRow) => <DiffCell value={r.diff_total} percent={r.diff_total_percent} bold />,
    });

    // Per-unit columns
    if (isDetailed) {
      t1Children.push(
        {
          title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>,
          dataIndex: 'tender1_mat_per_unit', key: 'tender1_mat_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>,
          dataIndex: 'tender1_work_per_unit', key: 'tender1_work_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
        },
      );
      t2Children.push(
        {
          title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>,
          dataIndex: 'tender2_mat_per_unit', key: 'tender2_mat_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>,
          dataIndex: 'tender2_work_per_unit', key: 'tender2_work_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <Text style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
        },
      );
      diffChildren.push(
        {
          title: <div style={{ textAlign: 'center' }}>Мат/ед.</div>,
          dataIndex: 'diff_mat_per_unit', key: 'diff_mat_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <DiffPerUnitCell value={v} />,
        },
        {
          title: <div style={{ textAlign: 'center' }}>Раб/ед.</div>,
          dataIndex: 'diff_work_per_unit', key: 'diff_work_per_unit',
          align: 'right' as const, width: 110,
          render: (v: number) => <DiffPerUnitCell value={v} />,
        },
      );
    }

    // Итого/ед. — всегда
    t1Children.push({
      title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>,
      dataIndex: 'tender1_total_per_unit', key: 'tender1_total_per_unit',
      align: 'right' as const, width: 110,
      render: (v: number) => <Text strong style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
    });
    t2Children.push({
      title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>,
      dataIndex: 'tender2_total_per_unit', key: 'tender2_total_per_unit',
      align: 'right' as const, width: 110,
      render: (v: number) => <Text strong style={{ color: '#0891b2' }}>{formatPerUnit(v)}</Text>,
    });
    diffChildren.push({
      title: <div style={{ textAlign: 'center' }}>Итого/ед.</div>,
      dataIndex: 'diff_total_per_unit', key: 'diff_total_per_unit',
      align: 'right' as const, width: 110,
      render: (v: number) => <DiffPerUnitCell value={v} />,
    });

    return [
      categoryCol,
      { title: <div style={{ textAlign: 'center' }}>{t1Label}</div>, children: t1Children },
      { title: <div style={{ textAlign: 'center' }}>{t2Label}</div>, children: t2Children },
      { title: <div style={{ textAlign: 'center' }}>Разница</div>, children: diffChildren },
    ];
  }, [isDetailed, t1Label, t2Label]);

  const scrollX = isDetailed ? 2700 : 1200;

  const comparisonCardTitle = (
    <Row justify="space-between" align="middle">
      <Col>
        {`Сравнение по категориям (${costLabel.toLowerCase()} затраты)`}
      </Col>
      <Col>
        <Space>
          <Segmented
            options={[
              { label: 'Упрощённое', value: 'simplified' },
              { label: 'Детальное', value: 'detailed' },
            ]}
            value={viewMode}
            onChange={(value) => setViewMode(value as ViewMode)}
          />
          <Segmented
            options={[
              { label: 'Прямые затраты', value: 'base' },
              { label: 'Коммерческие затраты', value: 'commercial' },
            ]}
            value={costType}
            onChange={(value) => setCostType(value as CostType)}
          />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => exportComparisonToExcel({
              comparisonData,
              costType,
              tender1Label: t1Label,
              tender2Label: t2Label,
            })}
            disabled={comparisonData.length === 0}
          >
            Excel
          </Button>
        </Space>
      </Col>
    </Row>
  );

  return (
    <div style={{ padding: '24px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Выбор тендеров */}
        <Card title="Выбор тендеров для сравнения">
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Тендер 1:</Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="Выберите первый тендер"
                  value={selectedTender1}
                  onChange={setSelectedTender1}
                  showSearch
                  optionFilterProp="children"
                >
                  {tenders.map(tender => (
                    <Option key={tender.id} value={tender.id}>
                      {tender.title} (v{tender.version || 1})
                    </Option>
                  ))}
                </Select>
                {tender1Info && (
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Создан: {dayjs(tender1Info.created_at).format('DD.MM.YYYY')}
                  </Text>
                )}
              </Space>
            </Col>
            <Col xs={24} md={4} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChartOutlined style={{ fontSize: '24px', color: '#999' }} />
            </Col>
            <Col xs={24} md={10}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Тендер 2:</Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="Выберите второй тендер"
                  value={selectedTender2}
                  onChange={setSelectedTender2}
                  showSearch
                  optionFilterProp="children"
                >
                  {tenders.map(tender => (
                    <Option key={tender.id} value={tender.id}>
                      {tender.title} (v{tender.version || 1})
                    </Option>
                  ))}
                </Select>
                {tender2Info && (
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Создан: {dayjs(tender2Info.created_at).format('DD.MM.YYYY')}
                  </Text>
                )}
              </Space>
            </Col>
          </Row>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={loadComparisonData}
              loading={loading}
              disabled={!selectedTender1 || !selectedTender2}
            >
              Загрузить сравнение
            </Button>
          </div>
        </Card>

        {/* Общая статистика */}
        {comparisonData.length > 0 && (
          <Card title={`Общая статистика (${costLabel.toLowerCase()} затраты)`}>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Statistic
                  title={`Итого: ${t1Label}`}
                  value={totalStats.tender1_total}
                  precision={2}
                  suffix="₽"
                />
              </Col>
              <Col xs={24} md={8}>
                <Statistic
                  title={`Итого: ${t2Label}`}
                  value={totalStats.tender2_total}
                  precision={2}
                  suffix="₽"
                />
              </Col>
              <Col xs={24} md={8}>
                <Statistic
                  title="Разница"
                  value={totalStats.diff_total}
                  precision={2}
                  suffix="₽"
                  valueStyle={{ color: totalStats.diff_total >= 0 ? '#52c41a' : '#ff4d4f' }}
                  prefix={totalStats.diff_total >= 0 ? '+' : ''}
                />
                <Text type="secondary">
                  ({diffPercent}% {totalStats.diff_total >= 0 ? 'больше' : 'меньше'})
                </Text>
              </Col>
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
            <Table
              columns={columns}
              dataSource={comparisonData}
              rowKey="key"
              pagination={false}
              scroll={{ x: scrollX }}
              bordered
              size="small"
              expandable={{ defaultExpandAllRows: false }}
              rowClassName={(record) => record.is_main_category ? 'comparison-category-row' : ''}
            />
          </Card>
        ) : (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <BarChartOutlined style={{ fontSize: '64px', color: '#ccc' }} />
              <div style={{ marginTop: '16px' }}>
                <Text type="secondary">Выберите два тендера и нажмите &quot;Загрузить сравнение&quot;</Text>
              </div>
            </div>
          </Card>
        )}
      </Space>
    </div>
  );
};

export default ObjectComparison;
