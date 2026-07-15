import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Drawer, Empty, Input, Row, Select, Space, Spin,
  Statistic, Table, Tag, Typography,
} from 'antd';
import { ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import {
  ChangeImpactReport, DiffItem, fetchChangeImpact,
} from '../../lib/api/changeImpact';
import {
  AMBIGUOUS_GROUP_NOTE, CALC_NOT_READY_TEXT, IDENTICAL_VERSIONS_TEXT,
  NO_BASELINE_TEXT, baselineOptionLabel, buildBridgeGeometry,
  buildConfigNavigation, buildDiffItemNavigation, changeStatusDisplay,
  configChangeText, directionDisplay, formatDelta, formatMoneyValue,
  reconciliationDisplay,
} from '../../lib/quality/changeImpactPolicy';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Этап 1.5: «Изменения расчёта» — сравнение текущей рассчитанной версии с
 *  предыдущей согласованной. Read-only: exact-сопоставление строк, точная
 *  сверка итога, изменения конфигурации как контекст (не «причина»). */
export default function ChangeImpact() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [report, setReport] = useState<ChangeImpactReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);

  const [status, setStatus] = useState('all');
  const [positionId, setPositionId] = useState<string | null>(null);
  const [boqType, setBoqType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('impact_desc');
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<DiffItem | null>(null);

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string, p = page) => {
    setLoading(true);
    setError(null);
    setNotReady(false);
    try {
      setReport(await fetchChangeImpact(id, {
        baseline_tender_id: baselineId ?? undefined,
        status, position_id: positionId ?? undefined,
        boq_item_type: boqType ?? undefined, search: search || undefined,
        sort: sortMode, page: p, page_size: 50,
      }));
    } catch (e) {
      const err = e as { status?: number; body?: { code?: string } };
      if (err?.status === 409) {
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
  }, [baselineId, status, positionId, boqType, search, sortMode, page]);

  useEffect(() => {
    if (tenderId) {
      load(tenderId, page);
      setSearchParams({ tenderId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, baselineId, status, positionId, boqType, search, sortMode, page]);

  const statusTag = (s: string) => {
    const d = changeStatusDisplay(s);
    return <Tag color={d.color}>{d.icon} {d.label}</Tag>;
  };

  const noBaseline = report?.status === 'BASELINE_NOT_AVAILABLE';
  const identical = report && !noBaseline && report.summary.items_added === 0 &&
    report.summary.items_removed === 0 && report.summary.items_modified === 0 &&
    report.summary.ambiguous_groups === 0 && report.summary.grand_total_delta === 0;
  const recon = report && !noBaseline ? reconciliationDisplay(report.summary) : null;

  const columns = [
    { title: 'Статус', dataIndex: 'status', width: 150, render: statusTag },
    {
      title: 'Строка', key: 'label',
      render: (_: unknown, it: DiffItem) => (
        <Space direction="vertical" size={0}>
          <Text strong>{it.label}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {it.boq_item_type} · {it.position_label}
          </Text>
          {it.changed_fields && it.changed_fields.length > 0 && (
            <Text style={{ fontSize: 12 }}>
              Изменено: {it.changed_fields.map((f) => f.label).join(', ')}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Кол-во', key: 'qty', align: 'right' as const, width: 130,
      render: (_: unknown, it: DiffItem) =>
        it.quantity ? `${it.quantity.baseline} → ${it.quantity.current}` : '—',
    },
    {
      title: 'Ставка', key: 'rate', align: 'right' as const, width: 150,
      render: (_: unknown, it: DiffItem) =>
        it.unit_rate ? `${formatMoneyValue(it.unit_rate.baseline)} → ${formatMoneyValue(it.unit_rate.current)}` : '—',
    },
    {
      title: 'Прямая Δ', key: 'direct', align: 'right' as const, width: 130,
      render: (_: unknown, it: DiffItem) => formatDelta(it.direct.delta),
    },
    {
      title: 'Коммерч. Δ', key: 'comm', align: 'right' as const, width: 140,
      render: (_: unknown, it: DiffItem) => {
        const d = directionDisplay(it.direction);
        return <Tag color={d.color}>{formatDelta(it.commercial.delta)}</Tag>;
      },
    },
    {
      title: '', key: 'actions', width: 200,
      render: (_: unknown, it: DiffItem) => {
        const nav = tenderId ? buildDiffItemNavigation(it, tenderId) : null;
        return (
          <Space>
            <Button size="small" onClick={() => setDetail(it)}>Детали</Button>
            {nav && (
              <Button size="small" icon={<RightOutlined />} onClick={() => navigate(nav.url)}>
                {nav.label}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>Изменения расчёта</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Сравнение текущей рассчитанной версии с предыдущей согласованной: что изменилось и какие
        изменения сильнее всего повлияли на итог. Изменения конфигурации показываются как контекст,
        а не как доказанная денежная причина.
      </Text>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          showSearch optionFilterProp="label" placeholder="Выберите тендер"
          style={{ minWidth: 320 }} value={tenderId}
          onChange={(v) => { setPage(1); setBaselineId(null); setTenderId(v); }}
          options={tenders.map((t) => ({
            value: t.id, label: `${t.title} (${t.tender_number ?? '—'}${t.version ? `, v${t.version}` : ''})`,
          }))}
        />
        {report && report.baseline_candidates.length > 0 && (
          <Select
            style={{ minWidth: 320 }} placeholder="Сравнить с версией"
            value={baselineId ?? report.baseline?.tender_id ?? null}
            onChange={(v) => { setPage(1); setBaselineId(v); }}
            options={report.baseline_candidates.map((c) => ({
              value: c.tender_id, label: baselineOptionLabel(c),
            }))}
          />
        )}
        <Button icon={<ReloadOutlined />} disabled={!tenderId} onClick={() => tenderId && load(tenderId)}>
          Обновить
        </Button>
      </Space>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      {notReady && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={CALC_NOT_READY_TEXT} />}
      {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {report && !loading && noBaseline && (
        <Empty description={NO_BASELINE_TEXT} style={{ margin: '40px 0' }} />
      )}

      {report && !loading && !noBaseline && report.baseline && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic
                  title={`Итог: v${report.baseline.version} → v${report.current.version}`}
                  value={`${formatMoneyValue(report.summary.baseline_grand_total)} → ${formatMoneyValue(report.summary.current_grand_total)}`}
                  valueStyle={{ fontSize: 16 }}
                />
                <Text strong>{formatDelta(report.summary.grand_total_delta)} ₽</Text>
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Прямая Δ" value={formatDelta(report.summary.direct_total_delta)} valueStyle={{ fontSize: 16 }} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Комм. материалы Δ" value={formatDelta(report.summary.commercial_material_delta)} valueStyle={{ fontSize: 16 }} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Комм. работы Δ" value={formatDelta(report.summary.commercial_work_delta)} valueStyle={{ fontSize: 16 }} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Страхование Δ" value={formatDelta(report.summary.insurance_delta)} valueStyle={{ fontSize: 16 }} />
              </Card>
            </Col>
          </Row>

          <Space wrap style={{ marginBottom: 12 }}>
            <Tag>Добавлено: {report.summary.items_added}</Tag>
            <Tag>Удалено: {report.summary.items_removed}</Tag>
            <Tag>Изменено: {report.summary.items_modified}</Tag>
            <Tag>Группы: {report.summary.ambiguous_groups}</Tag>
            <Tag>Позиции с изменениями: {report.summary.positions_changed}</Tag>
          </Space>

          {recon && (
            <Alert
              type={recon.ok ? 'success' : 'warning'} showIcon
              style={{ marginBottom: 16 }} message={recon.text}
            />
          )}

          <Card size="small" title="Мост изменения итога" style={{ marginBottom: 16 }}>
            {buildBridgeGeometry(report.bridge).map((b) => (
              <div key={b.code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ width: 190, fontSize: 12 }}>{b.label}</Text>
                <div style={{ flex: 1, position: 'relative', height: 14, background: 'rgba(128,128,128,0.12)', borderRadius: 3 }}>
                  <div style={{
                    position: 'absolute', left: `${b.offsetPercent}%`, width: `${b.widthPercent}%`,
                    top: 0, bottom: 0, borderRadius: 3,
                    background: b.positive ? 'rgba(207,19,34,0.55)' : 'rgba(16,185,129,0.55)',
                  }} />
                </div>
                <Text style={{ width: 140, textAlign: 'right', fontSize: 12 }}>{formatDelta(b.amount)}</Text>
              </div>
            ))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatMoneyValue(report.summary.baseline_grand_total)} → {formatMoneyValue(report.summary.current_grand_total)} ·
              Δ {formatDelta(report.summary.grand_total_delta)} ₽
            </Text>
          </Card>

          {report.configuration_changes.length > 0 && (
            <Card size="small" title="Изменения настроек тендера (контекст)" style={{ marginBottom: 16 }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {report.configuration_changes.map((c) => {
                  const nav = tenderId ? buildConfigNavigation(c, tenderId) : null;
                  return (
                    <Space key={c.code} wrap>
                      <Text>{configChangeText(c)}</Text>
                      {nav && (
                        <Button size="small" type="link" onClick={() => navigate(nav.url)}>{nav.label}</Button>
                      )}
                    </Space>
                  );
                })}
              </Space>
            </Card>
          )}

          {report.top_contributors.length > 0 && (
            <Card size="small" title="Крупнейшие изменения" style={{ marginBottom: 16 }}>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {report.top_contributors.slice(0, 8).map((c) => (
                  <Space key={c.id} wrap>
                    <Tag color={directionDisplay(c.direction).color}>{formatDelta(c.delta)}</Tag>
                    <Text>{c.label}</Text>
                    {c.position_label && <Text type="secondary" style={{ fontSize: 12 }}>{c.position_label}</Text>}
                  </Space>
                ))}
              </Space>
            </Card>
          )}

          <Space wrap style={{ marginBottom: 12 }}>
            <Select value={status} style={{ width: 180 }} onChange={(v) => { setPage(1); setStatus(v); }}
              options={[
                { value: 'all', label: 'Все строки' },
                { value: 'modified', label: 'Изменённые' },
                { value: 'added', label: 'Добавленные' },
                { value: 'removed', label: 'Удалённые' },
                { value: 'unchanged', label: 'Без изменений' },
                { value: 'ambiguous', label: 'Группы' },
              ]} />
            <Select value={boqType} allowClear placeholder="Тип строки" style={{ width: 150 }}
              onChange={(v) => { setPage(1); setBoqType(v ?? null); }}
              options={['мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.'].map((v) => ({ value: v, label: v }))} />
            <Input.Search allowClear placeholder="Поиск по строкам" style={{ width: 240 }}
              onSearch={(v) => { setPage(1); setSearch(v); }} />
            <Select value={sortMode} style={{ width: 210 }} onChange={(v) => { setPage(1); setSortMode(v); }}
              options={[
                { value: 'impact_desc', label: 'По влиянию (убыв.)' },
                { value: 'impact_asc', label: 'По влиянию (возр.)' },
                { value: 'direct_delta_desc', label: 'По прямой Δ' },
                { value: 'position', label: 'По позициям' },
              ]} />
            {positionId && (
              <Button size="small" onClick={() => { setPage(1); setPositionId(null); }}>Сбросить позицию ✕</Button>
            )}
          </Space>

          {identical ? (
            <Empty description={IDENTICAL_VERSIONS_TEXT} style={{ margin: '32px 0' }} />
          ) : (
            <Table<DiffItem>
              rowKey="id" size="small" columns={columns} dataSource={report.items}
              scroll={{ x: 1100 }}
              pagination={{
                current: report.pagination.page, pageSize: report.pagination.page_size,
                total: report.pagination.total, showSizeChanger: false,
                onChange: (p) => setPage(p),
              }}
            />
          )}

          <Space style={{ marginTop: 12 }}>
            <Button size="small" onClick={() => navigate(`/analytics/review-pack?tenderId=${tenderId}`)}>
              Добавить сравнение версий в отчёт →
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            Снимок {report.generated_at} · базовая версия v{report.baseline.version}
            {report.baseline.approved_at ? ` (согласована ${report.baseline.approved_at.slice(0, 10)})` : ''}.
          </Text>
        </>
      )}

      {!loading && !report && !error && !notReady && (
        <Empty description="Выберите тендер для сравнения версий" />
      )}

      <Drawer
        open={!!detail} onClose={() => setDetail(null)} width={560}
        title={detail ? `${changeStatusDisplay(detail.status).label}: ${detail.label}` : ''}
      >
        {detail && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {detail.status === 'AMBIGUOUS_GROUP' && (
              <Alert type="info" showIcon message={AMBIGUOUS_GROUP_NOTE}
                description={`Строк в текущей версии: ${detail.current_count ?? 0}; в базовой: ${detail.baseline_count ?? 0}.`} />
            )}
            <Text type="secondary">{detail.position_label}</Text>
            <Text>Прямая: {formatMoneyValue(detail.direct.baseline)} → {formatMoneyValue(detail.direct.current)} ({formatDelta(detail.direct.delta)})</Text>
            <Text>Коммерческая: {formatMoneyValue(detail.commercial.baseline)} → {formatMoneyValue(detail.commercial.current)} ({formatDelta(detail.commercial.delta)})</Text>
            {detail.changed_fields && detail.changed_fields.length > 0 && (
              <Card size="small" title="Изменённые поля">
                <Space direction="vertical" size={2}>
                  {detail.changed_fields.map((f) => (
                    <Text key={f.field} style={{ fontSize: 13 }}>
                      {f.label}: {f.old_value} → {f.new_value}
                      {f.evidence_only ? ' (доказательная информация)' : ''}
                    </Text>
                  ))}
                </Space>
              </Card>
            )}
            {detail.baseline_item_id && <Text type="secondary" style={{ fontSize: 12 }}>Базовая строка: {detail.baseline_item_id}</Text>}
            {detail.current_item_id && <Text type="secondary" style={{ fontSize: 12 }}>Текущая строка: {detail.current_item_id}</Text>}
            {detail.current_item_ids && detail.current_item_ids.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>Текущие строки группы: {detail.current_item_ids.join(', ')}</Text>
            )}
            {detail.baseline_item_ids && detail.baseline_item_ids.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>Базовые строки группы: {detail.baseline_item_ids.join(', ')}</Text>
            )}
            {tenderId && detail.status !== 'REMOVED' && detail.status !== 'AMBIGUOUS_GROUP' && detail.current_item_id && (
              <Button type="primary" icon={<RightOutlined />} onClick={() => {
                const nav = buildDiffItemNavigation(detail, tenderId);
                if (nav) navigate(nav.url);
              }}>
                К текущей строке
              </Button>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
