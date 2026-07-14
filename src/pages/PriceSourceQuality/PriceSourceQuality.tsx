import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Row, Select,
  Space, Spin, Statistic, Table, Tag, Typography, message,
} from 'antd';
import { LinkOutlined, ReloadOutlined, RightOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import {
  SourceReport, SourceRow, fetchPriceSourceQuality, updateBoqQuoteSource,
} from '../../lib/api/priceSource';
import {
  amountMetricsAvailable, buildSourceItemLink, formatAge, formatAmount,
  formatCoverage, safeSourceUrl, sourceStatusDisplay, validateSourceDates,
} from '../../lib/quality/sourcePolicy';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Этап 1.3: «Источники цен» — покрытие BOQ источниками и актуальность
 *  КП/прайсов. Read-only аналитика + metadata-only правка дат источника
 *  (не двигает финансовый расчёт/ревизию/согласование). */
export default function PriceSourceQuality() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [report, setReport] = useState<SourceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [maxAge, setMaxAge] = useState(90);
  const [status, setStatus] = useState('all');
  const [positionId, setPositionId] = useState<string | null>(null);
  const [boqType, setBoqType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('status');
  const [page, setPage] = useState(1);

  const [editRow, setEditRow] = useState<SourceRow | null>(null);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string, p = page) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchPriceSourceQuality(id, {
        max_age_days: maxAge, status, position_id: positionId ?? undefined,
        boq_item_type: boqType ?? undefined, search: search || undefined,
        sort: sortMode, page: p, page_size: 50,
      }));
    } catch (e) {
      const err = e as { status?: number };
      setError(err?.status === 404 ? 'Тендер не найден.' : getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [maxAge, status, positionId, boqType, search, sortMode, page]);

  useEffect(() => {
    if (tenderId) {
      load(tenderId, page);
      setSearchParams({ tenderId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, maxAge, status, positionId, boqType, search, sortMode, page]);

  const openEdit = (row: SourceRow) => {
    setEditRow(row);
    editForm.setFieldsValue({
      quote_link: row.source_url ?? '',
      price_date: row.price_date ? dayjs(row.price_date) : null,
      valid_until: row.valid_until ? dayjs(row.valid_until) : null,
    });
  };

  const saveEdit = async () => {
    if (!editRow || !tenderId) return;
    const v = editForm.getFieldsValue();
    const priceDate = v.price_date ? v.price_date.format('YYYY-MM-DD') : '';
    const validUntil = v.valid_until ? v.valid_until.format('YYYY-MM-DD') : '';
    const inlineErr = validateSourceDates(priceDate || null, validUntil || null, dayjs().format('YYYY-MM-DD'));
    if (inlineErr) {
      message.warning(inlineErr);
      return;
    }
    setSaving(true);
    try {
      // Metadata-only PATCH: ставка/ревизия/согласование не меняются.
      await updateBoqQuoteSource(editRow.boq_item_id, {
        quote_link: (v.quote_link ?? '').trim(),
        quote_price_date: priceDate,
        quote_valid_until: validUntil,
      });
      message.success('Данные источника обновлены');
      setEditRow(null);
      load(tenderId);
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const statusTag = (s: string) => {
    const d = sourceStatusDisplay(s);
    return <Tag color={d.color}>{d.icon} {d.label}</Tag>;
  };

  const amountsOn = report ? amountMetricsAvailable(report) : false;

  const columns = [
    { title: 'Статус', dataIndex: 'status', width: 280, render: statusTag },
    {
      title: 'Строка', key: 'name',
      render: (_: unknown, r: SourceRow) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.boq_item_type} · {r.unit_code || '—'} · позиция {r.client_position_id.slice(0, 8)}…
          </Text>
        </Space>
      ),
    },
    {
      title: 'Ставка', dataIndex: 'unit_rate', align: 'right' as const,
      render: (v: number | null) => formatAmount(v),
    },
    {
      title: 'Сумма', dataIndex: 'total_amount', align: 'right' as const,
      render: (v: number | null) => (amountsOn ? formatAmount(v) : '—'),
    },
    {
      title: 'Источник', key: 'src', width: 220,
      render: (_: unknown, r: SourceRow) => {
        const url = safeSourceUrl(r.source_url);
        return (
          <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
            <Text ellipsis style={{ maxWidth: 200 }}>{r.source_label || '—'}</Text>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <LinkOutlined /> Открыть источник
              </a>
            )}
          </Space>
        );
      },
    },
    { title: 'Дата цены', dataIndex: 'price_date', width: 110, render: (v: string | null) => v ?? '—' },
    { title: 'Действ. до', dataIndex: 'valid_until', width: 110, render: (v: string | null) => v ?? '—' },
    { title: 'Возраст', dataIndex: 'age_days', width: 90, render: (v: number | null) => formatAge(v) },
    {
      title: '', key: 'actions', width: 210,
      render: (_: unknown, r: SourceRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Источник</Button>
          <Button size="small" icon={<RightOutlined />}
            onClick={() => tenderId && navigate(buildSourceItemLink(r, tenderId))}>
            К строке
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>Источники цен</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Покрытие строк подтверждёнными источниками и актуальность КП/прайсов.
        Статус источника — повод для проверки, а не доказательство неправильной цены.
      </Text>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select showSearch style={{ minWidth: 320 }} placeholder="Выберите тендер"
          value={tenderId ?? undefined} optionFilterProp="label"
          onChange={(v) => { setTenderId(v); setPage(1); }}
          options={tenders.map((t) => ({
            value: t.id, label: `${t.title} (v${t.version ?? 1}) — ${t.tender_number}`,
          }))} />
        <Select value={maxAge} style={{ width: 210 }}
          onChange={(v) => { setMaxAge(v); setPage(1); }}
          options={[30, 60, 90, 180, 365].map((d) => ({ value: d, label: `Допустимый возраст: ${d} дн.` }))} />
        {tenderId && (
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => load(tenderId)}>Обновить</Button>
        )}
      </Space>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {loading && <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />}

      {!loading && report && (
        <>
          {!amountsOn && (
            <Alert type="info" showIcon style={{ marginBottom: 16 }}
              message={report.amount_metrics_note || 'Стоимостные показатели будут доступны после завершения расчёта.'}
              description="Статусы источников доступны и сейчас — их можно исправлять, не дожидаясь пересчёта." />
          )}

          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={5}><Card size="small"><Statistic title="Покрытие источниками"
              value={formatCoverage(report.summary.source_coverage_percent)} /></Card></Col>
            <Col xs={12} md={5}><Card size="small"><Statistic title="Актуальное покрытие"
              value={formatCoverage(report.summary.current_source_coverage_percent)} /></Card></Col>
            <Col xs={12} md={5}><Card size="small"><Statistic title="Сумма к проверке"
              value={amountsOn ? formatAmount(report.summary.amount_requiring_review) : '—'} /></Card></Col>
            <Col xs={12} md={9}>
              <Card size="small">
                <Space wrap size={[12, 4]} style={{ fontSize: 12 }}>
                  <Text>Без источника: <b>{report.summary.missing_source_items}</b></Text>
                  <Text>Без даты: <b>{report.summary.missing_price_date_items}</b></Text>
                  <Text>Устарели: <b>{report.summary.stale_items}</b></Text>
                  <Text>Недействительны: <b>{report.summary.expired_items}</b></Text>
                  <Text>Скоро истекут: <b>{report.summary.expiring_soon_items}</b></Text>
                  <Text>Некорректные даты: <b>{report.summary.invalid_date_items}</b></Text>
                  <Text>Источников: <b>{report.summary.distinct_sources_count}</b></Text>
                </Space>
              </Card>
            </Col>
          </Row>

          <Space wrap style={{ marginBottom: 12 }}>
            <Select value={status} style={{ width: 240 }}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: 'all', label: 'Все статусы' },
                { value: 'invalid', label: '⚠️ Некорректные даты' },
                { value: 'expired', label: '⌛ Недействительны' },
                { value: 'stale', label: '📅 Устарели' },
                { value: 'missing_source', label: '❔ Без источника' },
                { value: 'missing_date', label: '🗓️ Без даты' },
                { value: 'expiring', label: '⏳ Скоро истекут' },
                { value: 'fresh', label: '✅ Актуальные' },
              ]} />
            <Select allowClear placeholder="Тип BOQ" style={{ width: 140 }}
              value={boqType ?? undefined} onChange={(v) => { setBoqType(v ?? null); setPage(1); }}
              options={['мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.'].map((t) => ({ value: t, label: t }))} />
            <Input.Search allowClear placeholder="Поиск (наименование/источник)" style={{ width: 260 }}
              onSearch={(v) => { setSearch(v); setPage(1); }}
              onChange={(e) => !e.target.value && setSearch('')} />
            <Select value={sortMode} style={{ width: 180 }}
              onChange={(v) => { setSortMode(v); setPage(1); }}
              options={[
                { value: 'status', label: 'По статусу' },
                { value: 'age_desc', label: 'Возраст ↓' },
                { value: 'amount_desc', label: 'Сумма ↓' },
                { value: 'position', label: 'По позициям' },
              ]} />
            <Select allowClear showSearch placeholder="Позиция" style={{ width: 200 }}
              value={positionId ?? undefined} onChange={(v) => { setPositionId(v ?? null); setPage(1); }}
              options={Array.from(new Set(report.items.map((i) => i.client_position_id)))
                .map((id) => ({ value: id, label: `Позиция ${id.slice(0, 8)}…` }))} />
          </Space>

          {report.items.length === 0 ? (
            <Empty description={
              report.summary.price_bearing_items_total === 0
                ? 'В тендере нет строк с ценой'
                : 'Нет строк по выбранным фильтрам'
            } />
          ) : (
            <Table<SourceRow>
              size="small" rowKey="boq_item_id" columns={columns} dataSource={report.items}
              pagination={{
                current: report.pagination.page, pageSize: report.pagination.page_size,
                total: report.pagination.total, onChange: (p) => setPage(p), showSizeChanger: false,
              }}
              scroll={{ x: true }} />
          )}

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            Снимок {report.generated_at}, серверная дата {report.as_of_date}, допустимый возраст {report.max_age_days} дн.,
            окно «скоро истечёт» {report.expiring_soon_days} дн.
          </Text>
        </>
      )}

      {!loading && !report && !error && (
        <Empty description="Выберите тендер для анализа источников цен" />
      )}

      <Modal
        title="Данные источника цены"
        open={editRow != null}
        onCancel={() => setEditRow(null)}
        onOk={saveEdit}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="Справочная информация"
          description="Ссылка и даты источника не меняют ставку и не запускают пересчёт. Дата цены — дата, на которую источник подтверждает цену (не дата загрузки файла)." />
        <Form form={editForm} layout="vertical">
          <Form.Item name="quote_link" label="Ссылка на КП / прайс">
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item name="price_date" label="Дата цены"
            extra="На какую дату источник подтверждает цену. Не подставляется автоматически.">
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD"
              disabledDate={(d) => d && d.isAfter(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="valid_until" label="Действительно до"
            extra="Последний день действия предложения. Может быть в прошлом (исторические данные).">
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
