import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Modal, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchTenders } from '../../lib/api/tenders';
import type { Tender } from '../../lib/types/types';
import { applyPricingDraft, cancelPricingDraft, getPricingDraft, getPricingQA, listPricingDrafts, PricingDraft, PricingDraftSummary, QAReport, validatePricingDraft } from '../../lib/api/pricing';

const { Title, Text } = Typography;
const statusColor: Record<string, string> = { draft: 'default', ready: 'blue', applied: 'green', cancelled: 'red', stale: 'orange' };

export default function PricingDrafts() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderId, setTenderId] = useState<string>();
  const [drafts, setDrafts] = useState<PricingDraftSummary[]>([]);
  const [selected, setSelected] = useState<PricingDraft>();
  const [qa, setQA] = useState<QAReport>();
  const [loading, setLoading] = useState(false);
  const selectedId = selected?.id;
  useEffect(() => { void fetchTenders({ isArchived: false }).then(setTenders).catch((e) => message.error(String(e))); }, []);
  const load = useCallback(async () => {
    if (!tenderId) return;
    setLoading(true);
    try { const [d, q] = await Promise.all([listPricingDrafts(tenderId), getPricingQA(tenderId)]); setDrafts(d.data); setQA(q); if (selectedId) setSelected(await getPricingDraft(selectedId)); }
    catch (e) { message.error(e instanceof Error ? e.message : 'Ошибка загрузки'); }
    finally { setLoading(false); }
  }, [tenderId, selectedId]);
  useEffect(() => { void load(); }, [load]);
  const selectedTender = useMemo(() => tenders.find((t) => t.id === tenderId), [tenders, tenderId]);
  const validate = async (id: string) => { try { const result = await validatePricingDraft(id); result.blocking_errors.length ? Modal.error({ title: 'Черновик не готов', content: result.blocking_errors.join('\n') }) : message.success('Черновик проверен'); await load(); setSelected(await getPricingDraft(id)); } catch (e) { message.error(String(e)); } };
  const apply = async (draft: PricingDraft) => { if (!draft.validation_hash) return; Modal.confirm({ title: 'Применить черновик?', content: `Будут атомарно записаны ${draft.operations.length} операций.`, okText: 'Применить', cancelText: 'Отмена', onOk: async () => { await applyPricingDraft(draft.id, draft.validation_hash!); message.success('Черновик применён'); await load(); } }); };
  const cancel = async (id: string) => { await cancelPricingDraft(id); message.success('Черновик отменён'); setSelected(undefined); await load(); };
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <div><Title level={2}><AuditOutlined /> Черновики расценки</Title><Text type="secondary">Контроль diff, источников, предупреждений и атомарного применения пакетов агента.</Text></div>
    <Card><Select showSearch optionFilterProp="label" style={{ width: '100%', maxWidth: 620 }} placeholder="Выберите импортированный тендер" value={tenderId} onChange={(v) => { setTenderId(v); setSelected(undefined); }} options={tenders.map((t) => ({ value: t.id, label: `${t.tender_number} · ${t.title} · v${t.version ?? 1}` }))} /></Card>
    {!tenderId ? <Empty description="Выберите тендер" /> : loading ? <Spin /> : <>
      {qa && <Card title={`QA · ${selectedTender?.title ?? ''}`}><Space wrap size="large"><Statistic title="Прямой итог" value={qa.direct_total} precision={2} suffix="₽" /><Statistic title="Без расценки" value={qa.unpriced_position_count} /><Statistic title="Без ставки" value={qa.missing_rate_count} /><Statistic title="Без provenance" value={qa.items_without_provenance} /><Tag icon={qa.ready_for_review ? <CheckCircleOutlined /> : <CloseCircleOutlined />} color={qa.ready_for_review ? 'success' : 'error'}>{qa.ready_for_review ? 'Готово к проверке' : 'Есть блокеры'}</Tag></Space>{qa.blocking_issues.length > 0 && <Alert style={{ marginTop: 16 }} type="error" showIcon message={qa.blocking_issues.join('; ')} />}</Card>}
      <Card title="Черновики" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>Обновить</Button>}><Table rowKey="id" dataSource={drafts} pagination={false} columns={[{ title: 'Создан', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('ru-RU') },{ title: 'Статус', dataIndex: 'status', render: (v) => <Tag color={statusColor[v]}>{v}</Tag> },{ title: 'Истекает', dataIndex: 'expires_at', render: (v) => new Date(v).toLocaleString('ru-RU') },{ title: '', render: (_, row) => <Button onClick={async () => setSelected(await getPricingDraft(row.id))}>Открыть</Button> }]} /></Card>
      {selected && <Card title={`Черновик ${selected.id}`} extra={<Space><Button onClick={() => void validate(selected.id)} disabled={!['draft','ready'].includes(selected.status)}>Проверить</Button><Button type="primary" onClick={() => void apply(selected)} disabled={selected.status !== 'ready' || !selected.validation_hash}>Применить</Button><Button danger onClick={() => void cancel(selected.id)} disabled={!['draft','ready'].includes(selected.status)}>Отменить</Button></Space>}>
        <Descriptions bordered size="small" column={2}><Descriptions.Item label="Статус">{selected.status}</Descriptions.Item><Descriptions.Item label="Validation hash"><Text code copyable>{selected.validation_hash ?? '—'}</Text></Descriptions.Item></Descriptions>
        <Collapse style={{ marginTop: 16 }} items={selected.operations.map((op, i) => ({ key: op.id, label: `${i+1}. ${op.action} · ${op.source_kind} · ${Math.round(op.confidence*100)}%`, children: <Space direction="vertical" style={{ width: '100%' }}><Text>{op.rationale}</Text>{op.warnings.map((w) => <Alert key={w} type="warning" message={w} showIcon />)}<pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ source: op.source_ref, proposed: op.proposed_payload }, null, 2)}</pre></Space> }))} />
      </Card>}
    </>}
  </Space>;
}
