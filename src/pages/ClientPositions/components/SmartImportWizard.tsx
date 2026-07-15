import { useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Modal, Select, Space, Steps, Table, Tag, Typography,
  Upload, message,
} from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import {
  SmartAnalysis, SmartImportOptions, SmartMapping, SmartPreviewRow,
  analyzeBoqImport, executeBoqImport,
} from '../../../lib/api/boqSmartImport';
import {
  BLOCKED_EXECUTE_TEXT, WIZARD_STEPS, candidateOptions, confidenceDisplay,
  filterPreviewRows, isExecuteReady, resultSummaryText, rowStatusDisplay,
  sheetNeedsConfirmation, unresolvedRequired,
} from '../../../lib/quality/smartImportPolicy';
import { SelectionsMap, selectionsForExecute } from '../../../lib/quality/aiNomenclaturePolicy';
import {
  MEMORY_SAVE_FAILED_TEXT, importSucceededDespiteMemoryFailure, memorySummaryText,
} from '../../../lib/quality/smartImportMemoryPolicy';
import NomenclatureSuggestPanel from './NomenclatureSuggestPanel';
import MappingProfileBanner, { ProfileSaveState } from './MappingProfileBanner';
import ImportMemoryDrawer from './ImportMemoryDrawer';
import AliasRowActions from './AliasRowActions';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface Props {
  open: boolean;
  tenderId: string;
  onClose: (imported: boolean) => void;
}

/** Этап 2.1: мастер «Умный импорт BOQ» — анализ и импорт выполняет сервер;
 *  preview не является импортом, деньги не считаются на фронте. */
export default function SmartImportWizard({ open, tenderId, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SmartAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    inserted: number; mismatches: number; skipped: number;
    provenance?: { exact: number; ai: number; manual: number; unresolved: number };
    memorySummary?: string;
    memoryFailed?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheetName, setSheetName] = useState<string | undefined>();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [formulaConfirmed, setFormulaConfirmed] = useState(false);
  const [defaultType, setDefaultType] = useState<string | undefined>();
  const [defaultCurrency, setDefaultCurrency] = useState<string | undefined>();
  const [rowFilter, setRowFilter] = useState('all');
  // Этап 2.2 (§15-16): подтверждённые выборы номенклатуры. Auto-select запрещён.
  const [selections, setSelections] = useState<SelectionsMap>({});
  // Этап 2.3 (§11): профиль применяется ТОЛЬКО явным действием пользователя.
  const [profileId, setProfileId] = useState<string | undefined>();
  const [profileSave, setProfileSave] = useState<ProfileSaveState>({ saveAsNew: false, saveOrUpdate: false, name: '' });
  const [memoryOpen, setMemoryOpen] = useState(false);

  const opts = useMemo((): SmartImportOptions => ({
    sheet_name: sheetName,
    mapping: overrides,
    accept_formula_cached: formulaConfirmed,
    default_boq_type: defaultType,
    default_currency: defaultCurrency,
    nomenclature_selections: selectionsForExecute(selections),
    mapping_profile_id: profileId,
  }), [sheetName, overrides, formulaConfirmed, defaultType, defaultCurrency, selections, profileId]);

  const reset = () => {
    setStep(0); setFile(null); setAnalysis(null); setResult(null); setError(null);
    setSheetName(undefined); setOverrides({}); setFormulaConfirmed(false);
    setDefaultType(undefined); setDefaultCurrency(undefined); setRowFilter('all');
    setSelections({}); // §15: смена файла аннулирует подтверждения
    setProfileId(undefined); // §19.19: и профиль/alias-состояние (этап 2.3)
    setProfileSave({ saveAsNew: false, saveOrUpdate: false, name: '' });
  };

  const runAnalyze = async (f: File, extra?: Partial<SmartImportOptions>) => {
    setLoading(true);
    setError(null);
    try {
      const a = await analyzeBoqImport(tenderId, f, { ...opts, ...extra });
      setAnalysis(a);
      return a;
    } catch (e) {
      setError(getErrorMessage(e));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // §19.18: замена файла сбрасывает анализ.
  const onFile = async (f: File) => {
    reset();
    setFile(f);
    const a = await runAnalyze(f, { sheet_name: undefined, mapping: {} });
    if (a) setStep(1);
  };

  const reanalyze = async (extra?: Partial<SmartImportOptions>) => {
    if (!file) return;
    await runAnalyze(file, extra);
  };

  const ready = isExecuteReady(analysis, formulaConfirmed || (analysis?.summary.formula_confirmations_required ?? 0) === 0, !!file);

  const doExecute = async () => {
    if (!file || !analysis || !ready) return;
    setImporting(true);
    setError(null);
    try {
      const res = await executeBoqImport(tenderId, file, analysis.workbook_fingerprint, opts, {
        profile_id: profileId,
        save_as_new: profileSave.saveAsNew,
        save_or_update: profileSave.saveOrUpdate,
        name: profileSave.name,
      });
      const prov = res.nomenclature_provenance;
      setResult({
        inserted: res.import.inserted_items_count,
        mismatches: res.import.total_mismatch_count,
        skipped: res.skipped_rows,
        provenance: prov ? {
          exact: prov.exact_nomenclature_matches,
          ai: prov.ai_suggestions_confirmed,
          manual: prov.manually_selected_nomenclature,
          unresolved: prov.unresolved_nomenclature_rows,
        } : undefined,
        memorySummary: memorySummaryText(res.memory),
        memoryFailed: importSucceededDespiteMemoryFailure(res.memory),
      });
      setStep(5);
      message.success('Импорт выполнен сервером');
    } catch (e) {
      setError(getErrorMessage(e)); // §19.21: без ответа сервера ничего не «импортировано»
    } finally {
      setImporting(false);
    }
  };

  const mappingColumns = [
    {
      title: 'Поле', key: 'label',
      render: (_: unknown, m: SmartMapping) => (
        <Space size={4}>
          <Text strong={m.required}>{m.label}</Text>
          {m.required && <Tag color="red">обяз.</Tag>}
          {m.diagnostic_only && <Tag>диагностика</Tag>}
        </Space>
      ),
    },
    {
      title: 'Колонка', key: 'col', width: 260,
      render: (_: unknown, m: SmartMapping) => (
        <Select
          allowClear style={{ width: 240 }} size="small"
          value={overrides[m.target_field] ?? m.source_column ?? undefined}
          placeholder="Не выбрано"
          options={candidateOptions(m)}
          onChange={(v) => {
            setOverrides((prev) => ({ ...prev, [m.target_field]: v ?? '' }));
          }}
        />
      ),
    },
    {
      title: 'Уверенность', key: 'conf', width: 200,
      render: (_: unknown, m: SmartMapping) => {
        const d = confidenceDisplay(m.confidence);
        return (
          <Space direction="vertical" size={0}>
            <Tag color={d.color}>{d.label}{m.confidence_percent ? ` · ${m.confidence_percent}%` : ''}</Tag>
            {(m.reasons ?? []).map((r0, i) => (
              <Text key={i} type="secondary" style={{ fontSize: 11 }}>{r0}</Text>
            ))}
          </Space>
        );
      },
    },
  ];

  const previewColumns = [
    {
      title: 'Строка', dataIndex: 'excel_row', width: 70,
    },
    {
      title: 'Статус', key: 'st', width: 140,
      render: (_: unknown, r0: SmartPreviewRow) => {
        const d = rowStatusDisplay(r0.status);
        return (
          <Space size={2} direction="vertical">
            <Tag color={d.color}>{d.label}{r0.skip_code ? ` (${r0.skip_code})` : ''}</Tag>
            {r0.alias_provenance && <Tag color="cyan">Подтверждено вами ранее</Tag>}
          </Space>
        );
      },
    },
    { title: 'Позиция', dataIndex: 'position_ref', width: 140 },
    { title: 'Тип', dataIndex: 'boq_item_type', width: 80 },
    { title: 'Описание', dataIndex: 'description' },
    { title: 'Ед.', dataIndex: 'unit_code', width: 70 },
    { title: 'Кол-во', dataIndex: 'quantity', width: 90 },
    { title: 'Цена', dataIndex: 'unit_rate', width: 100 },
    { title: 'Валюта', dataIndex: 'currency_type', width: 80 },
  ];

  const summary = analysis?.summary;

  return (
    <Modal
      open={open} width={1080} footer={null}
      title="Умный импорт BOQ"
      onCancel={() => { reset(); onClose(step === 5); }}
      destroyOnClose
    >
      <Steps
        size="small" current={step} style={{ marginBottom: 16 }}
        items={WIZARD_STEPS.map((s) => ({ title: s }))}
      />
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}

      {step === 0 && (
        <Upload.Dragger
          accept=".xlsx" maxCount={1} showUploadList={false}
          beforeUpload={(f) => { onFile(f as unknown as File); return false; }}
          fileList={[] as UploadFile[]}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Перетащите .xlsx или нажмите для выбора</p>
          <p className="ant-upload-hint">Файл анализируется на сервере; поддерживается только .xlsx</p>
        </Upload.Dragger>
      )}

      {analysis && step === 1 && (
        <Space direction="vertical" style={{ width: '100%' }}>
          {sheetNeedsConfirmation(analysis) && (
            <Alert type="warning" showIcon message="Несколько листов похожи на смету — подтвердите выбор листа." />
          )}
          <Space wrap>
            <Select
              style={{ minWidth: 280 }}
              value={sheetName ?? analysis.selected_sheet}
              options={analysis.sheets.map((s) => ({
                value: s.name,
                label: `${s.name} (${s.rows_detected} строк${s.suggested ? ', предложен' : ''})`,
              }))}
              onChange={async (v) => { setSheetName(v); await reanalyze({ sheet_name: v }); }}
            />
            <Text type="secondary">Строка заголовков: {analysis.detected_header_row}</Text>
            <Text type="secondary">Десятичный разделитель: {analysis.detected_formats.decimal_separator}</Text>
          </Space>
          <Space>
            <Button onClick={() => setStep(0)}>Назад</Button>
            <Button type="primary" onClick={() => setStep(2)} loading={loading}>Далее</Button>
          </Space>
        </Space>
      )}

      {analysis && step === 2 && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <MappingProfileBanner
            memory={analysis.memory} appliedProfileId={profileId} overrides={overrides}
            saveState={profileSave} onSaveStateChange={setProfileSave}
            onApply={async (id) => { setProfileId(id); await reanalyze({ mapping_profile_id: id }); }}
            onReject={async () => { setProfileId(undefined); await reanalyze({ mapping_profile_id: undefined }); }}
          />
          <Table<SmartMapping>
            rowKey="target_field" size="small" pagination={false}
            columns={mappingColumns} dataSource={analysis.mapping}
            scroll={{ y: 360 }}
          />
          <Space wrap>
            <Select allowClear placeholder="Тип для всего диапазона" style={{ width: 220 }}
              value={defaultType}
              options={['раб', 'суб-раб', 'раб-комп.', 'мат', 'суб-мат', 'мат-комп.'].map((v) => ({ value: v, label: v }))}
              onChange={setDefaultType} />
            <Select allowClear placeholder="Валюта по умолчанию" style={{ width: 200 }}
              value={defaultCurrency}
              options={['RUB', 'USD', 'EUR', 'CNY'].map((v) => ({ value: v, label: v }))}
              onChange={setDefaultCurrency} />
            <Button onClick={() => reanalyze()} loading={loading}>Применить и пересчитать</Button>
          </Space>
          {unresolvedRequired(analysis.mapping).length > 0 && (
            <Alert type="error" showIcon
              message={`Не сопоставлены обязательные поля: ${unresolvedRequired(analysis.mapping).map((m) => m.label).join(', ')}`} />
          )}
          <Space>
            <Button onClick={() => setStep(1)}>Назад</Button>
            <Button type="primary" onClick={() => setStep(3)}>Далее</Button>
          </Space>
        </Space>
      )}

      {analysis && summary && step === 3 && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Tag color="green">Готово: {summary.rows_ready}</Tag>
            <Button size="small" onClick={() => setMemoryOpen(true)}>Сохранённые настройки</Button>
            <Tag color="orange">Предупреждений: {summary.rows_with_warnings}</Tag>
            <Tag color="red">Заблокировано: {summary.rows_blocked}</Tag>
            <Tag>Пропущено: {summary.rows_skipped}</Tag>
            <Select size="small" value={rowFilter} style={{ width: 180 }}
              options={[
                { value: 'all', label: 'Все строки' },
                { value: 'blocked', label: 'Заблокированные' },
                { value: 'warning', label: 'Предупреждения' },
                { value: 'ready', label: 'Готовые' },
                { value: 'skipped', label: 'Пропущенные' },
              ]}
              onChange={setRowFilter} />
          </Space>
          {summary.formula_confirmations_required > 0 && (
            <Alert
              type="warning" showIcon
              message="Файл содержит формулы с сохранёнными результатами"
              description={(
                <Checkbox checked={formulaConfirmed} onChange={async (e) => {
                  setFormulaConfirmed(e.target.checked);
                  await reanalyze({ accept_formula_cached: e.target.checked });
                }}>
                  Использовать сохранённые значения формул (FORMULA_CACHED_VALUE)
                </Checkbox>
              )}
            />
          )}
          {file && (
            <NomenclatureSuggestPanel
              tenderId={tenderId} file={file} analysis={analysis} opts={opts}
              selections={selections} onSelectionsChange={setSelections}
              onApply={() => reanalyze()}
            />
          )}
          <Table<SmartPreviewRow>
            rowKey="excel_row" size="small"
            columns={previewColumns}
            dataSource={filterPreviewRows(analysis.preview_rows, rowFilter)}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            expandable={{
              rowExpandable: (r0) => (r0.issue_ids?.length ?? 0) > 0 || (r0.transformations?.length ?? 0) > 0
                || !!r0.alias_provenance,
              expandedRowRender: (r0) => (
                <Space direction="vertical" size={2}>
                  {r0.alias_provenance && (
                    <AliasRowActions
                      row={r0}
                      rowReference={`${analysis.selected_sheet}|${r0.excel_row}`}
                      onManualPick={async (ref, catalogId, label) => {
                        setSelections((prev) => ({ ...prev, [ref]: { catalogId, label, source: 'manual' } }));
                        await reanalyze();
                      }}
                      onForgotten={() => reanalyze()}
                    />
                  )}
                  {analysis.issues.filter((i) => r0.issue_ids?.includes(i.id)).map((i) => (
                    <Text key={i.id} style={{ fontSize: 12 }}>
                      <Tag color={i.severity === 'blocker' ? 'red' : i.severity === 'warning' ? 'orange' : 'blue'}>
                        {i.severity}
                      </Tag>
                      {i.message}{i.fix_hint ? ` — ${i.fix_hint}` : ''}
                    </Text>
                  ))}
                  {(r0.transformations ?? []).map((t, idx) => (
                    <Text key={idx} type="secondary" style={{ fontSize: 12 }}>
                      {t.field}: «{t.raw}» → «{t.normalized}» ({t.code})
                    </Text>
                  ))}
                </Space>
              ),
            }}
          />
          <Space>
            <Button onClick={() => setStep(2)}>Назад</Button>
            <Button type="primary" onClick={() => setStep(4)}>Далее</Button>
          </Space>
        </Space>
      )}

      {analysis && summary && step === 4 && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type={ready ? 'info' : 'error'} showIcon
            message={ready
              ? `К импорту готово ${summary.rows_ready + summary.rows_with_warnings} строк; сервер повторно проверит файл и рассчитает суммы.`
              : BLOCKED_EXECUTE_TEXT}
          />
          <Space>
            <Button onClick={() => setStep(3)}>Назад</Button>
            <Button type="primary" disabled={!ready} loading={importing} onClick={doExecute}>
              Импортировать
            </Button>
          </Space>
        </Space>
      )}

      <ImportMemoryDrawer
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        onChanged={() => { void reanalyze(); }}
      />

      {result && step === 5 && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="success" showIcon
            message="Импорт выполнен"
            description={resultSummaryText(result.inserted, result.mismatches, result.skipped)} />
          {result.provenance && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Номенклатура: точных {result.provenance.exact}, подтверждено AI {result.provenance.ai},
              вручную {result.provenance.manual}, не разрешено {result.provenance.unresolved}
            </Text>
          )}
          {result.memorySummary && (
            <Text type="secondary" style={{ fontSize: 12 }}>Память импорта: {result.memorySummary}</Text>
          )}
          {result.memoryFailed && (
            <Alert type="warning" showIcon message={MEMORY_SAVE_FAILED_TEXT} />
          )}
          <Button type="primary" onClick={() => { reset(); onClose(true); }}>Готово</Button>
        </Space>
      )}
    </Modal>
  );
}
