import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, Row, Select, Space, Spin,
  Statistic, Table, Tag, Typography,
} from 'antd';
import { ReloadOutlined, RightOutlined, LineChartOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import { ActionPlanReport, PlanAction, fetchActionPlan } from '../../lib/api/actionPlan';
import {
  EMPTY_PLAN_TEXT, PLAN_AUTO_HINT, buildPrimaryNavigation, buildSourceNavigation,
  componentStatusDisplay, formatImpact, nextAction, priorityDisplay,
  sourceLabel, summaryAmount,
} from '../../lib/quality/actionPlanPolicy';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Этап 1.4: «План действий» — единая приоритетная очередь по трём аналитикам
 *  (качество, ценовые отклонения, источники цен). Read-only: список
 *  формируется автоматически и обновляется после исправления данных;
 *  статусы выполнения не сохраняются. */
export default function ActionPlan() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [report, setReport] = useState<ActionPlanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [priority, setPriority] = useState('all');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('recommended');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string, p = page) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchActionPlan(id, {
        priority, source, category: category ?? undefined,
        position_id: positionId ?? undefined, search: search || undefined,
        sort: sortMode, page: p, page_size: 50,
      }));
    } catch (e) {
      const err = e as { status?: number };
      setError(err?.status === 404 ? 'Тендер не найден.' : getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [priority, source, category, positionId, search, sortMode, page]);

  useEffect(() => {
    if (tenderId) {
      load(tenderId, page);
      setSearchParams({ tenderId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, priority, source, category, positionId, search, sortMode, page]);

  const go = (a: PlanAction) => {
    if (!tenderId) return;
    navigate(buildPrimaryNavigation(a, tenderId).url);
  };
  const goAnalytics = (a: PlanAction) => {
    if (!tenderId) return;
    navigate(buildSourceNavigation(a, tenderId).url);
  };

  const priorityTag = (p: string) => {
    const d = priorityDisplay(p);
    return <Tag color={d.color}>{d.icon} {d.label}</Tag>;
  };

  const next = report ? nextAction(report.actions) : null;
  const amountsOn = report?.summary.amount_metrics_status === 'available';

  const columns = [
    { title: '№', dataIndex: 'rank', width: 60 },
    { title: 'Приоритет', dataIndex: 'priority', width: 140, render: priorityTag },
    {
      title: 'Действие', key: 'title',
      render: (_: unknown, a: PlanAction) => (
        <Space direction="vertical" size={0}>
          <Text strong>{a.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{a.reason}</Text>
          <Text style={{ fontSize: 12 }}>{a.recommended_action}</Text>
        </Space>
      ),
    },
    {
      title: 'Источник', key: 'src', width: 160,
      render: (_: unknown, a: PlanAction) => (
        <Space direction="vertical" size={0}>
          {a.sources.map((s) => <Tag key={s}>{sourceLabel(s)}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'Строк', dataIndex: 'affected_items_count', width: 80, align: 'right' as const,
    },
    {
      title: 'Сумма, ₽', key: 'impact', width: 130, align: 'right' as const,
      render: (_: unknown, a: PlanAction) => formatImpact(a),
    },
    {
      title: '', key: 'actions', width: 220,
      render: (_: unknown, a: PlanAction) => (
        <Space>
          <Button size="small" type="primary" ghost icon={<RightOutlined />} onClick={() => go(a)}>
            {buildPrimaryNavigation(a, tenderId ?? '').label}
          </Button>
          <Button size="small" icon={<LineChartOutlined />} onClick={() => goAnalytics(a)}>
            Аналитика
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>План действий</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Единая приоритетная очередь по качеству расчёта, ценовым отклонениям и источникам цен.
        {' '}{PLAN_AUTO_HINT}
      </Text>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          showSearch optionFilterProp="label" placeholder="Выберите тендер"
          style={{ minWidth: 340 }} value={tenderId}
          onChange={(v) => { setPage(1); setTenderId(v); }}
          options={tenders.map((t) => ({
            value: t.id, label: `${t.title} (${t.tender_number ?? '—'}${t.version ? `, v${t.version}` : ''})`,
          }))}
        />
        <Button icon={<ReloadOutlined />} disabled={!tenderId} onClick={() => tenderId && load(tenderId)}>
          Обновить
        </Button>
      </Space>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {report && !loading && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={5}>
              <Card size="small">
                <Statistic title="Блокирующие" value={report.summary.blocking_actions}
                  valueStyle={{ color: report.summary.blocking_actions > 0 ? '#cf1322' : '#10b981' }} />
              </Card>
            </Col>
            <Col xs={12} md={5}>
              <Card size="small">
                <Statistic title="Высокий приоритет" value={report.summary.high_actions} />
              </Card>
            </Col>
            <Col xs={12} md={5}>
              <Card size="small">
                <Statistic title="Остальные" value={report.summary.normal_actions + report.summary.low_actions} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Затронуто строк" value={report.summary.affected_boq_items} />
              </Card>
            </Col>
            <Col xs={24} md={5}>
              <Card size="small">
                <Statistic title="Сумма к проверке, ₽" value={summaryAmount(report)} />
              </Card>
            </Col>
          </Row>

          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap split="·">
              {(['quality', 'price_benchmark', 'price_source'] as const).map((k) => {
                const c = report.components[k];
                const d = componentStatusDisplay(c);
                return (
                  <Space key={k} size={6}>
                    <Text type="secondary">{sourceLabel(k)}:</Text>
                    <Tag color={d.color}>{d.label}</Tag>
                    {c.note && <Text type="secondary" style={{ fontSize: 12 }}>{c.note}</Text>}
                  </Space>
                );
              })}
            </Space>
          </Card>

          {!amountsOn && (
            <Alert
              type="info" showIcon style={{ marginBottom: 16 }}
              message="Суммы воздействия недоступны: финансовый расчёт не актуален. Действия по качеству и источникам цен доступны и сейчас."
            />
          )}

          {next && (
            <Card
              size="small" style={{ marginBottom: 16, borderColor: '#10b981' }}
              title={<Text strong>Следующее рекомендуемое действие</Text>}
            >
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space>
                  {priorityTag(next.priority)}
                  <Text strong>{next.title}</Text>
                </Space>
                <Text>{next.reason}</Text>
                <Text type="secondary">{next.recommended_action}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{next.priority_reason}</Text>
                <Space>
                  <Button type="primary" icon={<RightOutlined />} onClick={() => go(next)}>
                    {buildPrimaryNavigation(next, tenderId ?? '').label}
                  </Button>
                  <Button onClick={() => goAnalytics(next)}>Открыть аналитику</Button>
                </Space>
              </Space>
            </Card>
          )}

          <Space wrap style={{ marginBottom: 12 }}>
            <Select value={priority} style={{ width: 170 }} onChange={(v) => { setPage(1); setPriority(v); }}
              options={[
                { value: 'all', label: 'Все приоритеты' },
                { value: 'blocking', label: 'Блокирующие' },
                { value: 'high', label: 'Высокий' },
                { value: 'normal', label: 'Средний' },
                { value: 'low', label: 'Низкий' },
              ]} />
            <Select value={source} style={{ width: 190 }} onChange={(v) => { setPage(1); setSource(v); }}
              options={[
                { value: 'all', label: 'Все источники' },
                { value: 'quality', label: 'Качество расчёта' },
                { value: 'price_benchmark', label: 'Ценовые отклонения' },
                { value: 'price_source', label: 'Источники цен' },
              ]} />
            <Select value={category} allowClear placeholder="Категория" style={{ width: 190 }}
              onChange={(v) => { setPage(1); setCategory(v ?? null); }}
              options={[...new Set(report.actions.map((a) => a.category))].map((c) => ({ value: c, label: c }))} />
            <Input.Search allowClear placeholder="Поиск по действиям" style={{ width: 240 }}
              onSearch={(v) => { setPage(1); setSearch(v); }} />
            <Select value={sortMode} style={{ width: 200 }} onChange={(v) => { setPage(1); setSortMode(v); }}
              options={[
                { value: 'recommended', label: 'Рекомендуемый порядок' },
                { value: 'amount_desc', label: 'По сумме (убыв.)' },
                { value: 'position', label: 'По позициям' },
              ]} />
            {positionId && (
              <Button size="small" onClick={() => { setPage(1); setPositionId(null); }}>
                Сбросить позицию ✕
              </Button>
            )}
          </Space>

          {report.actions.length === 0 ? (
            <Empty description={EMPTY_PLAN_TEXT} style={{ margin: '40px 0' }} />
          ) : (
            <Table<PlanAction>
              rowKey="id" size="small" columns={columns} dataSource={report.actions}
              scroll={{ x: 1000 }}
              pagination={{
                current: report.pagination.page, pageSize: report.pagination.page_size,
                total: report.pagination.total, showSizeChanger: false,
                onChange: (p) => setPage(p),
              }}
            />
          )}

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            Снимок {report.generated_at} · ревизия входов {report.financial_input_revision} ·
            история цен {report.benchmark_period_months} мес. · возраст источника до {report.source_max_age_days} дн.
            {' '}{PLAN_AUTO_HINT}
          </Text>
        </>
      )}
    </div>
  );
}
