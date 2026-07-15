import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Modal, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { InfoCircleOutlined, RobotOutlined } from '@ant-design/icons';
import {
  SmartAnalysis, SmartImportOptions, SmartSuggestResult, SmartSuggestionRow,
  suggestNomenclature,
} from '../../../lib/api/boqSmartImport';
import { listMaterialNames, listWorkNames } from '../../../lib/api/nomenclatures';
import {
  ABSTAIN_TEXT, AI_DISCLOSURE_TEXT, DATA_MINIMIZATION_TEXT, SelectionsMap,
  bulkConfirmDialogText, bulkConfirmableRows, candidateById, isAcceptable,
  providerStatusDisplay, selectionSummary, suggestionConfidenceDisplay,
  suggestionStatusText, suggestionsStale, unresolvedNomenclatureRefs,
} from '../../../lib/quality/aiNomenclaturePolicy';
import { REMEMBER_BULK_LABEL, REMEMBER_LABEL } from '../../../lib/quality/smartImportMemoryPolicy';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface ManualOption { value: string; label: string; unit: string }

interface Props {
  tenderId: string;
  file: File;
  analysis: SmartAnalysis;
  opts: SmartImportOptions;
  selections: SelectionsMap;
  onSelectionsChange: (next: SelectionsMap) => void;
  onApply: () => Promise<void>; // повторный анализ с подтверждениями
}

/** Этап 2.2 (§15-16): подбор номенклатуры для unresolved-строк. Ничего не
 *  выбирается автоматически — каждое применение требует действия инженера. */
export default function NomenclatureSuggestPanel({
  tenderId, file, analysis, opts, selections, onSelectionsChange, onApply,
}: Props) {
  const [suggest, setSuggest] = useState<SmartSuggestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [manualRef, setManualRef] = useState<string | null>(null);
  const [manualOptions, setManualOptions] = useState<{ work: ManualOption[]; material: ManualOption[] } | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  const unresolvedRefs = useMemo(
    () => unresolvedNomenclatureRefs(analysis.issues, analysis.selected_sheet),
    [analysis],
  );

  // §15: смена файла/fingerprint обнуляет предложения.
  useEffect(() => {
    if (suggestionsStale(suggest?.workbook_fingerprint, analysis.workbook_fingerprint)) {
      setSuggest(null);
    }
  }, [suggest, analysis.workbook_fingerprint]);

  const runSuggest = async () => {
    setLoading(true);
    try {
      const res = await suggestNomenclature(
        tenderId, file, analysis.workbook_fingerprint, opts,
      );
      setSuggest(res);
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const confirmRow = (row: SmartSuggestionRow, catalogId: string, source: 'ai_confirmed' | 'manual', label: string) => {
    onSelectionsChange({ ...selections, [row.row_reference]: { catalogId, label, source } });
  };

  const clearRow = (ref: string) => {
    const next = { ...selections };
    delete next[ref];
    onSelectionsChange(next);
  };

  const openManual = async (ref: string) => {
    setManualRef(ref);
    if (manualOptions || manualLoading) return;
    setManualLoading(true);
    try {
      const [works, materials] = await Promise.all([listWorkNames(), listMaterialNames()]);
      setManualOptions({
        work: works.map((w) => ({ value: w.id, label: w.name, unit: w.unit ?? '' })),
        material: materials.map((m) => ({ value: m.id, label: m.name, unit: m.unit ?? '' })),
      });
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setManualLoading(false);
    }
  };

  const bulkEligible = suggest ? bulkConfirmableRows(suggest.rows, selections) : [];

  const doBulkConfirm = () => {
    // §7/§19.15: bulk-подтверждение НЕ подразумевает запоминание —
    // отдельный checkbox, по умолчанию ВЫКЛЮЧЕН.
    let rememberAll = false;
    Modal.confirm({
      title: 'Подтвердить предложения с высокой уверенностью?',
      content: (
        <Space direction="vertical" size={8}>
          <span>{bulkConfirmDialogText(bulkEligible.length)}</span>
          <Checkbox defaultChecked={false} onChange={(e) => { rememberAll = e.target.checked; }}>
            {REMEMBER_BULK_LABEL}
          </Checkbox>
        </Space>
      ),
      okText: 'Подтвердить',
      cancelText: 'Отмена',
      onOk: () => {
        const next = { ...selections };
        for (const row of bulkEligible) {
          const cand = candidateById(row, row.selected_candidate_id);
          if (cand) {
            next[row.row_reference] = {
              catalogId: cand.id, label: cand.label, source: 'ai_confirmed',
              remember: rememberAll === true,
            };
          }
        }
        onSelectionsChange(next);
      },
    });
  };

  const applyConfirmed = async () => {
    setApplying(true);
    try {
      await onApply();
    } finally {
      setApplying(false);
    }
  };

  const providerAlert = suggest ? providerStatusDisplay(suggest.provider.status) : null;
  const summary = selectionSummary(selections);

  const isWorkRow = (row: SmartSuggestionRow) =>
    row.source_type.startsWith('раб') || row.source_type.startsWith('суб-раб');

  const columns = [
    {
      title: 'Строка', dataIndex: 'excel_row', width: 70,
    },
    {
      title: 'Описание из файла', key: 'src',
      render: (_: unknown, row: SmartSuggestionRow) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{row.source_description}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {row.source_type}{row.source_unit ? ` · ${row.source_unit}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Предложение', key: 'sugg', width: 340,
      render: (_: unknown, row: SmartSuggestionRow) => {
        const sel = selections[row.row_reference];
        if (sel) {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="green">подтверждено ({sel.source === 'manual' ? 'вручную' : 'AI + инженер'})</Tag>
              <Text style={{ fontSize: 12 }}>{sel.label}</Text>
              <Checkbox
                checked={sel.remember === true}
                onChange={(e) => onSelectionsChange({
                  ...selections,
                  [row.row_reference]: { ...sel, remember: e.target.checked },
                })}
              >
                <Text style={{ fontSize: 11 }}>{REMEMBER_LABEL}</Text>
              </Checkbox>
            </Space>
          );
        }
        const cand = candidateById(row, row.selected_candidate_id);
        const conf = suggestionConfidenceDisplay(row.confidence);
        if (row.status === 'abstain') {
          return <Text type="secondary" style={{ fontSize: 12 }}>{ABSTAIN_TEXT}</Text>;
        }
        if (!cand) {
          return <Text type="secondary" style={{ fontSize: 12 }}>{suggestionStatusText(row)}</Text>;
        }
        return (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <Tag color={conf.color}>{conf.label}</Tag>
              <Text style={{ fontSize: 12 }}>{cand.label}</Text>
            </Space>
            {row.explanation && <Text type="secondary" style={{ fontSize: 11 }}>{row.explanation}</Text>}
            {cand.unit_compatibility === 'conflict' && (
              <Text type="warning" style={{ fontSize: 11 }}>Единица измерения отличается — проверьте выбор</Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Действия', key: 'act', width: 300,
      render: (_: unknown, row: SmartSuggestionRow) => {
        const sel = selections[row.row_reference];
        if (sel) {
          return <Button size="small" onClick={() => clearRow(row.row_reference)}>Очистить</Button>;
        }
        const cand = candidateById(row, row.selected_candidate_id);
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space size={4} wrap>
              <Button
                size="small" type="primary" disabled={!isAcceptable(row)}
                onClick={() => cand && confirmRow(row, cand.id, 'ai_confirmed', cand.label)}
              >
                Принять
              </Button>
              <Button size="small" onClick={() => openManual(row.row_reference)} loading={manualLoading && manualRef === row.row_reference}>
                Найти вручную
              </Button>
            </Space>
            {row.candidates.length > 0 && (
              <Select
                size="small" style={{ width: '100%' }} placeholder="Выбрать из кандидатов"
                value={undefined}
                options={row.candidates.map((c) => ({
                  value: c.id,
                  label: `${c.label} (${c.unit || '—'}, ${Math.round(c.deterministic_score * 100)}%)`,
                }))}
                onChange={(id) => {
                  const chosen = row.candidates.find((c) => c.id === id);
                  if (chosen) confirmRow(row, chosen.id, 'manual', chosen.label);
                }}
              />
            )}
            {manualRef === row.row_reference && manualOptions && (
              <Select
                size="small" showSearch style={{ width: '100%' }}
                placeholder="Поиск по всему справочнику"
                options={(isWorkRow(row) ? manualOptions.work : manualOptions.material).map((o) => ({
                  value: o.value, label: `${o.label}${o.unit ? ` (${o.unit})` : ''}`,
                }))}
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                onChange={(id) => {
                  const src = isWorkRow(row) ? manualOptions.work : manualOptions.material;
                  const chosen = src.find((o) => o.value === id);
                  if (chosen) confirmRow(row, chosen.value, 'manual', chosen.label);
                  setManualRef(null);
                }}
              />
            )}
          </Space>
        );
      },
    },
  ];

  if (unresolvedRefs.length === 0 && summary.total === 0) return null;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Alert
        type="info" showIcon icon={<RobotOutlined />}
        message={(
          <Space size={6}>
            <span>Подбор номенклатуры: {unresolvedRefs.length} строк без точного совпадения</span>
            <Tooltip title={DATA_MINIMIZATION_TEXT}>
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        )}
        description={AI_DISCLOSURE_TEXT}
        action={(
          <Button size="small" type="primary" loading={loading} onClick={runSuggest}
            disabled={unresolvedRefs.length === 0}>
            Подобрать номенклатуру
          </Button>
        )}
      />
      {providerAlert && <Alert type={providerAlert.tone} showIcon message={providerAlert.text} />}
      {suggest && suggest.rows.length > 0 && (
        <>
          <Space wrap>
            <Tag color="blue">Подтверждено: {summary.total} (AI: {summary.ai}, вручную: {summary.manual})</Tag>
            <Button size="small" disabled={bulkEligible.length === 0} onClick={doBulkConfirm}>
              Подтвердить все с высокой уверенностью ({bulkEligible.length})
            </Button>
            <Button size="small" type="primary" loading={applying}
              disabled={summary.total === 0} onClick={applyConfirmed}>
              Применить подтверждения и пересчитать
            </Button>
          </Space>
          <Table<SmartSuggestionRow>
            rowKey="row_reference" size="small"
            columns={columns} dataSource={suggest.rows}
            pagination={{ pageSize: 6, showSizeChanger: false }}
          />
        </>
      )}
      {suggest && suggest.rows.length === 0 && (
        <Alert type="success" showIcon message="Все строки уже разрешены — подбор не требуется." />
      )}
      {!suggest && summary.total > 0 && (
        <Space wrap>
          <Tag color="blue">Подтверждено: {summary.total}</Tag>
          <Button size="small" type="primary" loading={applying} onClick={applyConfirmed}>
            Применить подтверждения и пересчитать
          </Button>
        </Space>
      )}
    </Space>
  );
}
