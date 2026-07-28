import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, Row, Select, Space, Spin, Statistic, Table, Tag, Typography,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined,
  ReloadOutlined, RightOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import { fetchTenderQuality, QualityIssue, QualityReport } from '../../lib/api/qualityAnalytics';
import {
  buildNavigationTarget, categoryLabel, filterIssues, formatCompleteness,
  resolveReadyState, severityDisplay,
} from '../../lib/quality/dashboardPolicy';
import { resolveFinancialCalculationState } from '../../lib/financial/calculationState';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Этап 1.1: панель «Качество расчёта» — read-only аналитика одного
 *  серверного snapshot: blockers/warnings, полнота, конкретные строки,
 *  причина, действие и переход к месту исправления. */
export default function TenderQuality() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [severity, setSeverity] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenderQuality(id);
      setReport(data);
    } catch (e) {
      const err = e as { status?: number };
      if (err?.status === 404) {
        setError('Тендер не найден.');
      } else if (err?.status === 403) {
        setError('Нет доступа к тендеру.');
      } else {
        setError(getErrorMessage(e));
      }
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenderId) {
      load(tenderId);
      setSearchParams({ tenderId }, { replace: true });
    }
  }, [tenderId, load, setSearchParams]);

  const issues = useMemo(
    () => (report
      ? filterIssues(report.issues, { severity, category, clientPositionId: positionId, search })
      : []),
    [report, severity, category, positionId, search],
  );

  const ready = report ? resolveReadyState(report) : null;
  const calcState = report
    ? resolveFinancialCalculationState({
        financial_input_revision: report.financial_input_revision,
        financial_calculation_revision: report.financial_calculation_revision,
        financial_calculation_status: report.financial_calculation_status,
      })
    : null;

  const positionOptions = useMemo(() => {
    if (!report) return [];
    const seen = new Map<string, true>();
    for (const is of report.issues) {
      if (is.client_position_id) seen.set(is.client_position_id, true);
    }
    return Array.from(seen.keys()).map((id) => ({ value: id, label: `Позиция ${id.slice(0, 8)}…` }));
  }, [report]);

  const categoryOptions = useMemo(
    () => (report ? report.categories.map((c) => ({ value: c.code, label: categoryLabel(c.code) })) : []),
    [report],
  );

  const goTo = (issue: QualityIssue) => {
    if (!tenderId) return;
    const target = buildNavigationTarget(issue, tenderId);
    if (target) navigate(target.url);
  };

  const severityTag = (s: string) => {
    const d = severityDisplay(s);
    const color = s === 'blocker' ? 'red' : s === 'warning' ? 'orange' : 'blue';
    return <Tag color={color}>{d.icon} {d.label}</Tag>;
  };

  const columns = [
    {
      title: 'Уровень', dataIndex: 'severity', width: 150,
      render: (s: string) => severityTag(s),
    },
    {
      title: 'Категория', dataIndex: 'category', width: 170,
      render: (c: string) => categoryLabel(c),
    },
    {
      title: 'Проблема', key: 'problem',
      render: (_: unknown, is: QualityIssue) => (
        <Space direction="vertical" size={0}>
          <Text strong>{is.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{is.message}</Text>
          <Text style={{ fontSize: 12 }}>💡 {is.fix_hint}</Text>
        </Space>
      ),
    },
    {
      title: 'Где', key: 'where', width: 190,
      render: (_: unknown, is: QualityIssue) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          {is.client_position_id && <Text type="secondary">Позиция: {is.client_position_id.slice(0, 8)}…</Text>}
          {is.entity_type === 'boq_item' && <Text type="secondary">Строка: {is.entity_id.slice(0, 8)}…</Text>}
          {is.field && <Text type="secondary">Поле: {is.field}</Text>}
          {typeof is.affected_count === 'number' && is.affected_count > 1 && (
            <Text type="secondary">Затронуто строк: {is.affected_count}</Text>
          )}
        </Space>
      ),
    },
    {
      title: '', key: 'go', width: 110,
      render: (_: unknown, is: QualityIssue) => {
        const target = tenderId ? buildNavigationTarget(is, tenderId) : null;
        return target ? (
          <Button size="small" icon={<RightOutlined />} onClick={() => goTo(is)}>
            Перейти
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>Качество расчёта</Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          showSearch
          style={{ minWidth: 320 }}
          placeholder="Выберите тендер"
          value={tenderId ?? undefined}
          optionFilterProp="label"
          onChange={(v) => setTenderId(v)}
          options={tenders.map((t) => ({
            value: t.id,
            label: `${t.title} (v${t.version ?? 1}) — ${t.tender_number}`,
          }))}
        />
        {tenderId && (
          <Button icon={<ReloadOutlined />} onClick={() => load(tenderId)} loading={loading}>
            Обновить
          </Button>
        )}
      </Space>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {loading && <Spin style={{ display: 'block', margin: '48px auto' }} size="large" />}

      {!loading && report && (
        <>
          {ready === 'blocked' && (
            <Alert type="error" showIcon icon={<CloseCircleOutlined />}
              message={`Блокирующих проблем: ${report.summary.blockers}`}
              description="Финальный расчёт нельзя считать готовым — согласование и финальный экспорт заблокированы."
              style={{ marginBottom: 16 }} />
          )}
          {ready === 'warnings' && (
            <Alert type="warning" showIcon icon={<WarningOutlined />}
              message={`Предупреждений: ${report.summary.warnings}`}
              description="Расчёт возможен, но строки требуют проверки расчётчиком."
              style={{ marginBottom: 16 }} />
          )}
          {ready === 'ready' && (
            <Alert type="success" showIcon icon={<CheckCircleOutlined />}
              message="Блокирующих проблем и предупреждений не обнаружено"
              style={{ marginBottom: 16 }} />
          )}

          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Блокирующие" value={report.summary.blockers}
                valueStyle={{ color: report.summary.blockers > 0 ? '#cf1322' : undefined }} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Предупреждения" value={report.summary.warnings}
                valueStyle={{ color: report.summary.warnings > 0 ? '#d46b08' : undefined }} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Полнота расчёта"
                value={formatCompleteness(report.summary.calculation_completeness_percent)} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Полнота для проверки"
                value={formatCompleteness(report.summary.review_completeness_percent)} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Статус расчёта"
                value={calcState?.kind === 'calculated' ? 'Рассчитан' : calcState?.kind ?? '—'} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Строк с проблемами"
                value={report.summary.boq_items_with_issues}
                suffix={`/ ${report.summary.boq_items_total}`} /></Card>
            </Col>
          </Row>

          {calcState?.alertMessage && (
            <Alert type={calcState.alertType ?? 'warning'} showIcon
              message={calcState.alertMessage} style={{ marginBottom: 16 }} />
          )}

          <Space wrap style={{ marginBottom: 12 }}>
            <Select allowClear placeholder="Уровень" style={{ width: 180 }}
              value={severity ?? undefined} onChange={(v) => setSeverity(v ?? null)}
              options={[
                { value: 'blocker', label: '⛔ Блокирует' },
                { value: 'warning', label: '⚠️ Предупреждение' },
                { value: 'information', label: 'ℹ️ Инфо' },
              ]} />
            <Select allowClear placeholder="Категория" style={{ width: 220 }}
              value={category ?? undefined} onChange={(v) => setCategory(v ?? null)}
              options={categoryOptions} />
            <Select allowClear showSearch placeholder="Позиция" style={{ width: 220 }}
              value={positionId ?? undefined} onChange={(v) => setPositionId(v ?? null)}
              options={positionOptions} />
            <Input.Search allowClear placeholder="Поиск по проблемам" style={{ width: 260 }}
              onSearch={setSearch} onChange={(e) => !e.target.value && setSearch('')} />
          </Space>

          {issues.length === 0 ? (
            <Empty
              image={<InfoCircleOutlined style={{ fontSize: 40, color: '#10b981' }} />}
              description={
                report.issues.length === 0
                  ? 'Блокирующих проблем и предупреждений не обнаружено'
                  : 'Нет проблем по выбранным фильтрам'
              }
            />
          ) : (
            <Table<QualityIssue>
              size="small"
              rowKey="id"
              columns={columns}
              dataSource={issues}
              pagination={issues.length > 50 ? { pageSize: 50, size: 'small' } : false}
              scroll={{ x: true }}
            />
          )}

          <Space style={{ marginTop: 12 }}>
            <Button onClick={() => navigate(`/analytics/price-benchmark?tenderId=${tenderId}`)}>
              Проверить ценовые отклонения →
            </Button>
            <Button onClick={() => navigate(`/analytics/price-sources?tenderId=${tenderId}`)}>
              Проверить актуальность источников цен →
            </Button>
            <Button onClick={() => navigate(`/analytics/action-plan?tenderId=${tenderId}`)}>
              Открыть общий план действий →
            </Button>
            <Button onClick={() => navigate(`/analytics/change-impact?tenderId=${tenderId}`)}>
              Изменения между версиями →
            </Button>
            <Button onClick={() => navigate(`/analytics/review-pack?tenderId=${tenderId}`)}>
              Открыть отчёт для проверки →
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            Снимок от {report.generated_at}, ревизия входов {report.financial_input_revision}.
            Анализ read-only: данные не изменяются.
          </Text>
        </>
      )}

      {!loading && !report && !error && (
        <Empty description="Выберите тендер для анализа качества расчёта" />
      )}
    </div>
  );
}
