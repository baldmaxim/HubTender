import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Empty, Row, Select, Space, Spin,
  Statistic, Tag, Typography, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTenders } from '../../lib/api/tenders';
import {
  ReviewReport, downloadReviewReportXlsx, fetchReviewReport,
} from '../../lib/api/reviewPack';
import {
  NOT_READY_TEXT, approvalDisplay, crossLinkActionPlan, crossLinkChangeImpact,
  formatReviewAmount, isDownloadReady, sectionDisplay, shortFingerprint,
} from '../../lib/quality/reviewPackPolicy';
import type { Tender } from '../../lib/types';
import { getErrorMessage } from '../../utils/errors';

const { Title, Text } = Typography;

/** Этап 1.6: «Отчёт для проверки» — серверный XLSX-пакет всех аналитик в одном
 *  согласованном снапшоте. Frontend не строит Excel и не пересчитывает summary. */
export default function ReviewPack() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string | null>(searchParams.get('tenderId'));
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);

  const [period, setPeriod] = useState(24);
  const [maxAge, setMaxAge] = useState(90);
  const [baselineId, setBaselineId] = useState<string | null>(null);

  useEffect(() => {
    fetchTenders().then(setTenders).catch((e) => setError(getErrorMessage(e)));
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setNotReady(false);
    try {
      setReport(await fetchReviewReport(id, {
        benchmark_period_months: period,
        source_max_age_days: maxAge,
        baseline_tender_id: baselineId ?? undefined,
      }));
    } catch (e) {
      const err = e as { status?: number };
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
  }, [period, maxAge, baselineId]);

  useEffect(() => {
    if (tenderId) {
      load(tenderId);
      setSearchParams({ tenderId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, period, maxAge, baselineId]);

  const download = async () => {
    if (!tenderId || !report || !isDownloadReady(report)) return;
    setDownloading(true);
    try {
      await downloadReviewReportXlsx(tenderId, {
        benchmark_period_months: period,
        source_max_age_days: maxAge,
        baseline_tender_id: baselineId ?? undefined,
      });
      message.success('Отчёт сформирован и скачан');
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  const e = report?.executive_summary;
  const md = report?.metadata;

  const sectionTag = (key: keyof ReviewReport['components'], label: string) => {
    if (!report) return null;
    const d = sectionDisplay(report.components[key]);
    return (
      <Space key={key} size={6}>
        <Text type="secondary">{label}:</Text>
        <Tag color={d.color}>{d.label}</Tag>
        {report.components[key].note && (
          <Text type="secondary" style={{ fontSize: 12 }}>{report.components[key].note}</Text>
        )}
      </Space>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <Title level={3}>Отчёт для проверки</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Один Excel-файл со всеми аналитиками тендера в согласованном снимке: финансовый статус,
        качество расчёта, план действий, ценовые отклонения, источники цен и изменения между версиями.
        Все суммы — серверные; Excel ничего не пересчитывает.
      </Text>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          showSearch optionFilterProp="label" placeholder="Выберите тендер"
          style={{ minWidth: 320 }} value={tenderId}
          onChange={(v) => { setBaselineId(null); setTenderId(v); }}
          options={tenders.map((t) => ({
            value: t.id, label: `${t.title} (${t.tender_number ?? '—'}${t.version ? `, v${t.version}` : ''})`,
          }))}
        />
        <Select value={period} style={{ width: 200 }} onChange={setPeriod}
          options={[6, 12, 24, 36].map((v) => ({ value: v, label: `История цен: ${v} мес.` }))} />
        <Select value={maxAge} style={{ width: 230 }} onChange={setMaxAge}
          options={[30, 60, 90, 180, 365].map((v) => ({ value: v, label: `Возраст источника: до ${v} дн.` }))} />
        <Button icon={<ReloadOutlined />} disabled={!tenderId} onClick={() => tenderId && load(tenderId)}>
          Обновить
        </Button>
      </Space>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {notReady && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }} message={NOT_READY_TEXT}
          action={tenderId && (
            <Button size="small" onClick={() => navigate(crossLinkActionPlan(tenderId))}>
              Открыть план действий
            </Button>
          )}
        />
      )}
      {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {report && !loading && md && e && (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap split="·">
              {sectionTag('quality', 'Качество')}
              {sectionTag('action_plan', 'План действий')}
              {sectionTag('price_benchmark', 'Ценовые отклонения')}
              {sectionTag('price_source', 'Источники цен')}
              {sectionTag('change_impact', 'Изменения версий')}
            </Space>
          </Card>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Блокирующие" value={e.action_plan.blocking_actions}
                  valueStyle={{ color: e.action_plan.blocking_actions > 0 ? '#cf1322' : '#10b981' }} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Высокий приоритет" value={e.action_plan.high_actions} /></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Сумма к проверке, ₽"
                  value={formatReviewAmount(e.action_plan.amount_requiring_review)} valueStyle={{ fontSize: 16 }} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Ценовые отклонения" value={e.price_benchmark.high_outliers + e.price_benchmark.low_outliers} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Источники к проверке"
                  value={e.price_source.stale_items + e.price_source.expired_items + e.price_source.missing_source_items} />
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small">
                <Statistic title="Δ итога к пред. версии"
                  value={formatReviewAmount(e.change_impact.grand_total_delta)} valueStyle={{ fontSize: 16 }} />
              </Card>
            </Col>
          </Row>

          <Card size="small" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={{ xs: 1, md: 2 }} title={`Итог проверки: ${e.headline}`}>
              <Descriptions.Item label="Тендер">{md.tender_label} ({md.tender_number} · v{md.tender_version})</Descriptions.Item>
              <Descriptions.Item label="Финансовый итог, ₽">{formatReviewAmount(md.cached_grand_total)}</Descriptions.Item>
              <Descriptions.Item label="Ревизия входов / расчёта">{md.financial_input_revision} / {md.financial_calculation_revision} ({md.financial_calculation_status})</Descriptions.Item>
              <Descriptions.Item label="Согласование">{approvalDisplay(md)}</Descriptions.Item>
              <Descriptions.Item label="Сформирован">{md.generated_at}</Descriptions.Item>
              <Descriptions.Item label="Fingerprint">{shortFingerprint(md.report_fingerprint)}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Space wrap style={{ marginBottom: 16 }}>
            <Button
              type="primary" icon={<DownloadOutlined />} size="large"
              loading={downloading} disabled={!isDownloadReady(report)}
              onClick={download}
            >
              Скачать Excel
            </Button>
            {tenderId && (
              <>
                <Button onClick={() => navigate(crossLinkActionPlan(tenderId))}>План действий →</Button>
                <Button onClick={() => navigate(crossLinkChangeImpact(tenderId))}>Изменения расчёта →</Button>
              </>
            )}
          </Space>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Отчёт формируется для финансовой ревизии {md.financial_input_revision}. Статистические
            отклонения и актуальность источника требуют проверки и не являются автоматическим
            доказательством ошибки цены.
          </Text>
        </>
      )}

      {!loading && !report && !error && !notReady && (
        <Empty description="Выберите тендер для формирования отчёта" />
      )}
    </div>
  );
}
