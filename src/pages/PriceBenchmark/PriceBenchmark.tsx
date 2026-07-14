import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Drawer, Empty, Input, Row, Select, Space, Spin,
  Statistic, Table, Tag, Typography,
} from 'antd';
import { ReloadOutlined, RightOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import {
  BenchmarkHistoryDetail, BenchmarkItem, BenchmarkReport,
  fetchBenchmarkHistory, fetchPriceBenchmarks,
} from '../../lib/api/priceBenchmark';
import {
  benchmarkStatusDisplay, buildBenchmarkItemLink, buildScaleGeometry,
  calculationNotReadyMessage, coverageDisplay, formatMoney, formatPercent,
} from '../../lib/quality/benchmarkPolicy';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Мини-шкала min—P25—median—P75—max с маркером текущей цены (CSS, без
 *  chart-библиотек). Вне диапазона — явная пометка. */
function RangeScale({ item }: { item: BenchmarkItem }) {
  const g = buildScaleGeometry(item);
  if (!g.valid) return <Text type="secondary">—</Text>;
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ position: 'relative', height: 10, background: 'rgba(128,128,128,0.15)', borderRadius: 4 }}>
        <div style={{
          position: 'absolute', left: `${g.p25}%`, width: `${Math.max(2, g.p75 - g.p25)}%`,
          top: 0, bottom: 0, background: 'rgba(16,185,129,0.35)', borderRadius: 4,
        }} />
        <div style={{ position: 'absolute', left: `${g.median}%`, top: -1, bottom: -1, width: 2, background: '#10b981' }} />
        <div
          title={`Текущая: ${formatMoney(item.current_unit_cost)}`}
          style={{
            position: 'absolute', left: `calc(${g.current}% - 4px)`, top: -3,
            width: 8, height: 16, borderRadius: 2,
            background: g.outOfRange ? '#fa8c16' : '#1677ff',
          }}
        />
      </div>
      {g.outOfRange && (
        <Text type="warning" style={{ fontSize: 11 }}>
          {g.outOfRange === 'above' ? 'выше исторического максимума' : 'ниже исторического минимума'}
        </Text>
      )}
    </div>
  );
}

export default function PriceBenchmark() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);

  const [period, setPeriod] = useState(24);
  const [status, setStatus] = useState<string>('all');
  const [positionId, setPositionId] = useState<string | null>(null);
  const [boqType, setBoqType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('deviation_desc');
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<BenchmarkHistoryDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string, p = page) => {
    setLoading(true);
    setError(null);
    setNotReady(false);
    try {
      const data = await fetchPriceBenchmarks(id, {
        period_months: period,
        status,
        position_id: positionId ?? undefined,
        boq_item_type: boqType ?? undefined,
        search: search || undefined,
        sort: sortMode,
        page: p,
        page_size: 50,
      });
      setReport(data);
    } catch (e) {
      const err = e as { status?: number; body?: { code?: string } };
      if (err?.status === 409 && err?.body?.code === 'FINANCIAL_CALCULATION_NOT_READY') {
        setNotReady(true);
        setReport(null);
      } else if (err?.status === 404) {
        setError('Тендер не найден.');
      } else {
        setError(getErrorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, [period, status, positionId, boqType, search, sortMode, page]);

  useEffect(() => {
    if (tenderId) {
      load(tenderId, page);
      setSearchParams({ tenderId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, period, status, positionId, boqType, search, sortMode, page]);

  const openDetail = async (it: BenchmarkItem) => {
    if (!tenderId) return;
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await fetchBenchmarkHistory(tenderId, it.boq_item_id, period));
    } catch (e) {
      setError(getErrorMessage(e));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const statusTag = (s: string) => {
    const d = benchmarkStatusDisplay(s);
    return <Tag color={d.color}>{d.icon} {d.label}</Tag>;
  };

  const columns = [
    { title: 'Статус', dataIndex: 'status', width: 250, render: statusTag },
    {
      title: 'Наименование', key: 'name',
      render: (_: unknown, it: BenchmarkItem) => (
        <Space direction="vertical" size={0}>
          <Text strong>{it.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {it.boq_item_type} · {it.unit_code || '—'} · позиция {it.client_position_id.slice(0, 8)}…
          </Text>
        </Space>
      ),
    },
    {
      title: 'Текущая, ₽/ед.', dataIndex: 'current_unit_cost', align: 'right' as const,
      render: (v: number) => formatMoney(v),
    },
    {
      title: 'Медиана', dataIndex: 'median', align: 'right' as const,
      render: (v: number | null) => formatMoney(v),
    },
    {
      title: 'P25–P75', key: 'iqr', align: 'right' as const,
      render: (_: unknown, it: BenchmarkItem) =>
        it.p25 != null && it.p75 != null ? `${formatMoney(it.p25)} – ${formatMoney(it.p75)}` : '—',
    },
    { title: 'Диапазон', key: 'scale', width: 170, render: (_: unknown, it: BenchmarkItem) => <RangeScale item={it} /> },
    {
      title: 'Откл.', dataIndex: 'deviation_from_median_percent', align: 'right' as const,
      render: (v: number | null) => formatPercent(v),
    },
    { title: 'Тендеров', dataIndex: 'historical_tenders_count', align: 'right' as const, width: 90 },
    {
      title: '', key: 'actions', width: 200,
      render: (_: unknown, it: BenchmarkItem) => (
        <Space>
          <Button size="small" onClick={() => openDetail(it)}>Подробнее</Button>
          <Button size="small" icon={<RightOutlined />}
            onClick={() => tenderId && navigate(buildBenchmarkItemLink(it, tenderId))}>
            К строке
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>Ценовые отклонения</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Историческая прямая стоимость за единицу, включая действующие коэффициенты и доставку строки.
        Отклонение — аналитическое предупреждение, требующее проверки, а не установленная ошибка цены.
      </Text>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select showSearch style={{ minWidth: 320 }} placeholder="Выберите тендер"
          value={tenderId ?? undefined} optionFilterProp="label"
          onChange={(v) => { setTenderId(v); setPage(1); }}
          options={tenders.map((t) => ({
            value: t.id, label: `${t.title} (v${t.version ?? 1}) — ${t.tender_number}`,
          }))} />
        <Select value={period} style={{ width: 150 }}
          onChange={(v) => { setPeriod(v); setPage(1); }}
          options={[6, 12, 24, 36].map((m) => ({ value: m, label: `${m} мес.` }))} />
        {tenderId && (
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => load(tenderId)}>
            Обновить
          </Button>
        )}
      </Space>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {notReady && (
        <Alert type="warning" showIcon message={calculationNotReadyMessage()}
          description="Бенчмарк строится только по актуальному серверному расчёту." style={{ marginBottom: 16 }} />
      )}

      {loading && <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />}

      {!loading && report && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={4}><Card size="small"><Statistic title="С историей" value={report.summary.benchmarked_items} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="Выше диапазона" value={report.summary.high_outliers}
              valueStyle={{ color: report.summary.high_outliers > 0 ? '#d46b08' : undefined }} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="Ниже диапазона" value={report.summary.low_outliers}
              valueStyle={{ color: report.summary.low_outliers > 0 ? '#d4a106' : undefined }} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="В диапазоне" value={report.summary.within_range} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="Мало истории" value={report.summary.insufficient_history} /></Card></Col>
            <Col xs={12} md={4}><Card size="small"><Statistic title="Покрытие" value={coverageDisplay(report.summary.coverage_percent)} /></Card></Col>
          </Row>

          <Space wrap style={{ marginBottom: 12 }}>
            <Select value={status} style={{ width: 220 }}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: 'all', label: 'Все статусы' },
                { value: 'high', label: '📈 Выше диапазона' },
                { value: 'low', label: '📉 Ниже диапазона' },
                { value: 'within_range', label: '✅ В диапазоне' },
                { value: 'insufficient', label: '⏳ Мало истории' },
                { value: 'not_eligible', label: '🚫 Без привязки' },
              ]} />
            <Select allowClear placeholder="Тип BOQ" style={{ width: 140 }}
              value={boqType ?? undefined} onChange={(v) => { setBoqType(v ?? null); setPage(1); }}
              options={['мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.'].map((t) => ({ value: t, label: t }))} />
            <Input.Search allowClear placeholder="Поиск по наименованию" style={{ width: 240 }}
              onSearch={(v) => { setSearch(v); setPage(1); }}
              onChange={(e) => !e.target.value && setSearch('')} />
            <Select value={sortMode} style={{ width: 220 }}
              onChange={(v) => { setSortMode(v); setPage(1); }}
              options={[
                { value: 'deviation_desc', label: 'Отклонение ↓' },
                { value: 'deviation_asc', label: 'Отклонение ↑' },
                { value: 'current_cost_desc', label: 'Текущая цена ↓' },
                { value: 'current_cost_asc', label: 'Текущая цена ↑' },
                { value: 'position', label: 'По позициям' },
              ]} />
            <Select allowClear showSearch placeholder="Позиция" style={{ width: 200 }}
              value={positionId ?? undefined} onChange={(v) => { setPositionId(v ?? null); setPage(1); }}
              options={Array.from(new Set(report.items.map((i) => i.client_position_id)))
                .map((id) => ({ value: id, label: `Позиция ${id.slice(0, 8)}…` }))} />
          </Space>

          {report.items.length === 0 ? (
            <Empty description="Нет строк по выбранным фильтрам" />
          ) : (
            <Table<BenchmarkItem>
              size="small" rowKey="boq_item_id" columns={columns}
              dataSource={report.items}
              pagination={{
                current: report.pagination.page,
                pageSize: report.pagination.page_size,
                total: report.pagination.total,
                onChange: (p) => setPage(p),
                showSizeChanger: false,
              }}
              scroll={{ x: true }}
            />
          )}

          <Space style={{ marginTop: 12 }}>
            <Button size="small" onClick={() => navigate(`/analytics/price-sources?tenderId=${tenderId}`)}>
              Проверить источник текущей цены →
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            Снимок {report.generated_at}, ревизия входов {report.financial_input_revision}, период {report.period_months} мес.
          </Text>
        </>
      )}

      {!loading && !report && !error && !notReady && (
        <Empty description="Выберите тендер для анализа ценовых отклонений" />
      )}

      <Drawer title="История цен по строке" width={560} open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}>
        {detailLoading && <Spin style={{ display: 'block', margin: '48px auto' }} />}
        {!detailLoading && detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Card size="small" title={detail.item.name || 'Строка BOQ'}>
              <Space direction="vertical" size={2}>
                <Text>Текущая: <b>{formatMoney(detail.item.current_unit_cost)}</b> ₽/ед.</Text>
                <Text>Медиана: {formatMoney(detail.item.median)} · P25–P75: {formatMoney(detail.item.p25)} – {formatMoney(detail.item.p75)}</Text>
                <Text>Границы (Tukey): {formatMoney(detail.item.lower_fence)} – {formatMoney(detail.item.upper_fence)}</Text>
                <Text>Отклонение от медианы: {formatPercent(detail.item.deviation_from_median_percent)}</Text>
                <Text>Тендеров в выборке: {detail.item.historical_tenders_count} · строк: {detail.item.historical_rows_count}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {detail.item.earliest_observation_at} — {detail.item.latest_observation_at}
                </Text>
              </Space>
            </Card>
            <Table size="small" rowKey={(o) => `${o.tender_label}-${o.version}`}
              dataSource={detail.observations}
              pagination={detail.observations.length > 10 ? { pageSize: 10, size: 'small' } : false}
              columns={[
                { title: 'Тендер', dataIndex: 'tender_label' },
                { title: 'Версия', dataIndex: 'version', width: 70 },
                { title: 'Согласован', dataIndex: 'approved_at', render: (v: string) => v.slice(0, 10) },
                { title: '₽/ед.', dataIndex: 'representative_unit_cost', align: 'right' as const, render: formatMoney },
                { title: 'Строк', dataIndex: 'matched_rows_count', align: 'right' as const, width: 70 },
              ]} />
            <Alert type="info" showIcon icon={<InfoCircleOutlined />} message="Методика" description={detail.methodology} />
          </Space>
        )}
      </Drawer>
    </div>
  );
}
