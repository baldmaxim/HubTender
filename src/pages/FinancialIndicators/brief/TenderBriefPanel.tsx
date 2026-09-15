// Вкладка «Выжимка»: цифры по крупнейшим (или выбранным) категориям считаются из
// расчёта, проверяющий дописывает текст для руководства. Всё это уходит в Excel
// под таблицу показателей.
import { FC, useMemo } from 'react';
import { Alert, Button, Card, Input, Select, Space, Spin, Table, Typography, message } from 'antd';
import { CopyOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCostBenchmarks } from '../../DataQuality/hooks/useCostBenchmarks';
import {
  MAX_BRIEF_LENGTH,
  briefCategoryRows,
  briefTotalPerSp,
  formatBriefFact,
  normalizeSelection,
  pickBriefFacts,
  type BriefFact,
} from '../../../lib/quality/briefPolicy';
import { getErrorMessage } from '../../../utils/errors';
import { useTenderBrief } from './useTenderBrief';

const { Text } = Typography;

interface ITenderBriefPanelProps {
  tenderId: string;
  readOnly: boolean;
  isPhone: boolean;
}

const money = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('ru-RU'));

const COLUMNS = [
  { title: 'Категория', dataIndex: 'name', key: 'name' },
  {
    title: '₽ / ед.',
    key: 'unit',
    align: 'right' as const,
    render: (_: unknown, f: BriefFact) =>
      f.per_volume_unit === null ? '—' : `${money(f.per_volume_unit)} / ${f.unit || 'ед.'}`,
  },
  { title: '₽ / м² СП', key: 'sp', align: 'right' as const, render: (_: unknown, f: BriefFact) => money(f.per_area_sp) },
  {
    title: 'Доля',
    key: 'share',
    align: 'right' as const,
    render: (_: unknown, f: BriefFact) => (f.share === null ? '—' : `${Math.round(f.share * 100)}%`),
  },
];

export const TenderBriefPanel: FC<ITenderBriefPanelProps> = ({ tenderId, readOnly, isPhone }) => {
  const { report, loading: reportLoading, error: reportError } = useCostBenchmarks(tenderId);
  const b = useTenderBrief(tenderId);

  const facts = useMemo(() => pickBriefFacts(report, b.selected.length ? b.selected : null), [report, b.selected]);
  const totalPerSp = briefTotalPerSp(report);
  const options = useMemo(
    () => briefCategoryRows(report).map((r) => ({ value: r.category_id, label: r.name })),
    [report],
  );

  const handleSave = async () => {
    try {
      await b.save(normalizeSelection(b.selected, report));
      message.success('Выжимка сохранена — попадёт в Excel под таблицу');
    } catch (e) {
      message.error('Не удалось сохранить выжимку: ' + getErrorMessage(e));
    }
  };

  const handleCopy = async () => {
    const lines = [
      ...(totalPerSp !== null ? [`Итого по тендеру — ${money(totalPerSp)} ₽/м² СП`] : []),
      ...facts.map(formatBriefFact),
      ...(b.text.trim() ? ['', b.text.trim()] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success('Скопировано');
    } catch {
      message.error('Буфер обмена недоступен');
    }
  };

  const savedAt = b.brief?.updated_at
    ? `Сохранено ${dayjs(b.brief.updated_at).format('DD.MM.YYYY HH:mm')}` +
      (b.brief.updated_by_name ? ` · ${b.brief.updated_by_name}` : '')
    : 'Ещё не сохранялась';

  return (
    <Spin spinning={reportLoading || b.loading}>
      <Space direction="vertical" size="middle" className="tender-brief-panel">
        {b.error && <Alert type="error" showIcon message={b.error} />}
        {reportError && <Alert type="warning" showIcon message={reportError} />}
        {report && !report.calculation_ready && (
          <Alert type="warning" showIcon message="Расчёт не актуален — цифры выжимки могут измениться после пересчёта" />
        )}

        <Card size="small" title="Цифры из расчёта">
          {totalPerSp !== null && (
            <Text strong className="tender-brief-total">
              Итого по тендеру — {money(totalPerSp)} ₽/м² СП
            </Text>
          )}
          {!readOnly && (
            <Select
              mode="multiple"
              allowClear
              className="tender-brief-select"
              placeholder="Автоматически: крупнейшие категории по сумме"
              value={b.selected}
              onChange={b.setSelected}
              options={options}
              optionFilterProp="label"
            />
          )}
          {isPhone ? (
            <Space direction="vertical" size={4}>
              {facts.map((f) => (
                <Text key={f.category_id}>{formatBriefFact(f)}</Text>
              ))}
            </Space>
          ) : (
            <Table rowKey="category_id" size="small" pagination={false} columns={COLUMNS} dataSource={facts} />
          )}
        </Card>

        <Card size="small" title="Текст для руководства">
          <Input.TextArea
            value={b.text}
            onChange={(e) => b.setText(e.target.value)}
            readOnly={readOnly}
            maxLength={MAX_BRIEF_LENGTH}
            autoSize={{ minRows: 5, maxRows: 16 }}
            placeholder="Фасады, профиль витражей, наличие РД, чем объект отличается от аналогов…"
          />
          <div className="tender-brief-actions">
            <Text type="secondary">{savedAt}</Text>
            <Space wrap>
              <Button icon={<CopyOutlined />} onClick={handleCopy}>
                Скопировать
              </Button>
              {!readOnly && (
                <Button type="primary" icon={<SaveOutlined />} loading={b.saving} disabled={!b.dirty} onClick={handleSave}>
                  Сохранить
                </Button>
              )}
            </Space>
          </div>
        </Card>
      </Space>
    </Spin>
  );
};
