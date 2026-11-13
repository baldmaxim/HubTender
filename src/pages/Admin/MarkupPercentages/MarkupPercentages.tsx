import React, { useState, useEffect, useMemo } from 'react';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import {
  Card,
  Typography,
  Space,
  Form,
  Select,
  Button,
  message,
  Tabs,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { Tender, TenderMarkupPercentageInsert, MarkupParameter, MarkupTactic } from '../../../lib/types';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import {
  listMarkupTactics,
  listActiveMarkupParameters,
  getTenderMarkupTacticId,
  setTenderMarkupTacticId,
  listTenderMarkupPercentages,
  deleteTenderMarkupPercentages,
  insertTenderMarkupPercentages,
} from '../../../lib/api/markup';
import { useRealtimeRefetch } from '../../../lib/realtime/useRealtimeRefetch';
import { SubcontractGrowthTab } from './SubcontractGrowthTab';
import {
  filterParamsBySet,
  inferTacticPercentSet,
  type PercentSet,
} from '../../../services/markupTactic/percentSets';
import { PercentSetChoiceModal } from './PercentSetChoiceModal';
import { PercentagesTab } from './PercentagesTab';
import { TenderPicker } from './TenderPicker';

const { Text } = Typography;

const BASE_SCHEME_NAME = 'Базовая схема';

/** Тактика по умолчанию для списка: тактика тендера, если она в списке; иначе «Базовая схема» (старый) или первая (глобальные, затем по имени). */
const pickDefaultTacticId = (
  set: PercentSet,
  setTactics: MarkupTactic[],
  tenderTacticId: string | null,
): string | null => {
  if (tenderTacticId && setTactics.some((t) => t.id === tenderTacticId)) return tenderTacticId;
  if (set === 'old') {
    const base =
      setTactics.find((t) => t.is_global && t.name === BASE_SCHEME_NAME) ??
      setTactics.find((t) => t.name === BASE_SCHEME_NAME);
    if (base) return base.id;
  }
  const sorted = [...setTactics].sort(
    (a, b) =>
      Number(!!b.is_global) - Number(!!a.is_global) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'ru'),
  );
  return sorted[0]?.id ?? null;
};

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

const MarkupPercentages: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [saving, setSaving] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tactics, setTactics] = useState<MarkupTactic[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedTacticId, setSelectedTacticId] = useState<string | null>(null);
  const [currentMarkupId, setCurrentMarkupId] = useState<string | null>(null);
  const [markupParameters, setMarkupParameters] = useState<MarkupParameter[]>([]);
  const [loadingParameters, setLoadingParameters] = useState(false);
  // Список базовых процентов: при каждом открытии страницы спрашиваем заново (не запоминаем).
  const [percentSet, setPercentSet] = useState<PercentSet>('old');
  const [choiceOpen, setChoiceOpen] = useState(true);
  // Тактика тендера, сохранённая в БД (для предупреждения о смене списка).
  const [savedTacticId, setSavedTacticId] = useState<string | null>(null);
  // Значения, сохранённые у тендера (ключ → %): чтобы не стирать строки другого списка.
  const [savedValues, setSavedValues] = useState<Record<string, number>>({});

  const setParams = useMemo(
    () => filterParamsBySet(markupParameters, percentSet),
    [markupParameters, percentSet],
  );
  const tacticsOfSet = useMemo(
    () => tactics.filter((t) => inferTacticPercentSet(t.sequences, markupParameters) === percentSet),
    [tactics, markupParameters, percentSet],
  );
  const savedSet = useMemo<PercentSet | null>(() => {
    const saved = tactics.find((t) => t.id === savedTacticId);
    return saved ? inferTacticPercentSet(saved.sequences, markupParameters) : null;
  }, [tactics, savedTacticId, markupParameters]);
  const selectedTacticName = tactics.find((t) => t.id === selectedTacticId)?.name ?? null;

  const choiceModal = (
    <PercentSetChoiceModal
      open={choiceOpen}
      oldCount={filterParamsBySet(markupParameters, 'old').length}
      newLabels={filterParamsBySet(markupParameters, 'new').map((p) => p.label)}
      onChoose={(set) => {
        setPercentSet(set);
        setChoiceOpen(false);
      }}
    />
  );

  const loadSavedTacticId = async (tenderId: string) => {
    setSavedTacticId(null);
    try {
      setSavedTacticId(await getTenderMarkupTacticId(tenderId));
    } catch (error) {
      console.error('Ошибка загрузки тактики тендера:', error);
    }
  };

  // Порядок расчёта по умолчанию — при выборе тендера, смене списка и после загрузки данных.
  useEffect(() => {
    if (tactics.length === 0 || markupParameters.length === 0) return;
    setSelectedTacticId(pickDefaultTacticId(percentSet, tacticsOfSet, savedTacticId));
  }, [percentSet, tacticsOfSet, savedTacticId, selectedTenderId, tactics.length, markupParameters.length]);

  const fetchMarkupParameters = async () => {
    setLoadingParameters(true);
    try {
      const data = await listActiveMarkupParameters();
      setMarkupParameters(data);
    } catch (error) {
      console.error('Ошибка загрузки параметров наценок:', error);
      message.error('Не удалось загрузить параметры наценок');
    } finally {
      setLoadingParameters(false);
    }
  };

  const fetchTenders = async () => {
    try {
      const data = await apiFetchTenders();
      setTenders(data);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const fetchTactics = async () => {
    try {
      const data = await listMarkupTactics();
      setTactics(data);
    } catch (error) {
      console.error('Ошибка загрузки тактик:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  // Получение уникальных наименований тендеров
  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    tenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
          clientName: tender.client_name,
        });
      }
    });

    return Array.from(uniqueTitles.values());
  };

  // Получение версий для выбранного наименования тендера
  const getVersionsForTitle = (title: string): { value: number; label: string }[] => {
    return tenders
      .filter(tender => tender.title === title)
      .map(tender => ({
        value: tender.version || 1,
        label: `Версия ${tender.version || 1}`,
      }))
      .sort((a, b) => b.value - a.value);
  };

  // Обработка выбора наименования тендера
  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    setSelectedTenderId(null);
    setSelectedVersion(null);
    form.resetFields();
  };

  // Обработка выбора версии тендера
  const handleVersionChange = async (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
      void loadSavedTacticId(tender.id);
      fetchMarkupData(tender.id);
    }
  };

  // onlySet — обновить поля только этого списка («Сбросить»); без него — все.
  const fetchMarkupData = async (tenderId: string, onlySet?: PercentSet) => {
    setLoading(true);
    try {
      const data = await listTenderMarkupPercentages(tenderId);

      const markupValues: Record<string, number> = {};
      const stored: Record<string, number> = {};
      const targetParams = onlySet ? filterParamsBySet(markupParameters, onlySet) : markupParameters;
      targetParams.forEach((param) => {
        markupValues[param.key] = param.default_value || 0;
      });

      if (data.length > 0) {
        data.forEach((record) => {
          if (record.markup_parameter) {
            const { key } = record.markup_parameter;
            stored[key] = record.value || 0;
            if (key in markupValues) markupValues[key] = record.value || 0;
          }
        });
        setCurrentMarkupId(tenderId);
      } else {
        setCurrentMarkupId(null);
      }
      setSavedValues(stored);

      form.setFieldsValue({
        tender_id: tenderId,
        ...markupValues,
      });
    } catch (error) {
      console.error('Ошибка загрузки данных наценок:', error);
      message.error('Не удалось загрузить данные наценок');
    } finally {
      setLoading(false);
    }
  };


  // Native WS hub — рефетч только при внешнем изменении наценок этого тендера.
  // Фильтр по таблице: tender:{id} получает ВСЕ события тендера (boq_items и
  // т.п.), а форму надо обновлять лишь на tender_markup_percentage. markLocalMutation
  // в handleSave подавляет эхо собственного сохранения.
  const { markLocalMutation } = useRealtimeRefetch(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) void fetchMarkupData(selectedTenderId);
    },
    {
      enabled: !!selectedTenderId,
      shouldRefetch: (ev) => ev.table === 'tender_markup_percentage',
    },
  );

  // Обработка выбора тактики
  const handleTacticChange = async (tacticId: string) => {
    setSelectedTacticId(tacticId);
  };

  // Сохранение данных
  const handleSave = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер');
      return;
    }

    try {
      await form.validateFields();
      // true — значения всех полей стора, а не только отрисованных (поля выбранного списка).
      const values = form.getFieldsValue(true);
      setSaving(true);
      markLocalMutation();

      if (currentMarkupId) {
        await deleteTenderMarkupPercentages(selectedTenderId);
      }

      // Выбранный список — из формы; другой список — только уже сохранённые у тендера строки
      // (PUT заменяет все строки), его дефолты не записываем.
      const otherSet: PercentSet = percentSet === 'old' ? 'new' : 'old';
      const markupRecords: TenderMarkupPercentageInsert[] = [
        ...setParams.map((param) => ({
          tender_id: selectedTenderId,
          markup_parameter_id: param.id,
          value: values[param.key] || 0,
        })),
        ...filterParamsBySet(markupParameters, otherSet)
          .filter((param) => param.key in savedValues)
          .map((param) => ({
            tender_id: selectedTenderId,
            markup_parameter_id: param.id,
            value: savedValues[param.key],
          })),
      ];

      await insertTenderMarkupPercentages(markupRecords);

      if (selectedTacticId) {
        await setTenderMarkupTacticId(selectedTenderId, selectedTacticId);
        setSavedTacticId(selectedTacticId);
      }

      setSavedValues(Object.fromEntries(markupRecords.map((r) => {
        const key = markupParameters.find((p) => p.id === r.markup_parameter_id)?.key ?? '';
        return [key, r.value];
      })));
      setCurrentMarkupId(selectedTenderId);
      message.success('Данные успешно обновлены');
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      message.error('Не удалось сохранить данные');
    } finally {
      setSaving(false);
    }
  };

  // Сброс формы
  const handleReset = () => {
    if (selectedTenderId) {
      fetchMarkupData(selectedTenderId, percentSet);
    } else {
      form.resetFields();
    }
  };

  useEffect(() => {
    fetchTenders();
    fetchTactics();
    fetchMarkupParameters();
  }, []);

  // Если тендер не выбран, показываем только выбор тендера
  if (!selectedTenderId) {
    return (
      <>
        {choiceModal}
        <TenderPicker
          tenders={tenders}
          selectedTenderTitle={selectedTenderTitle}
          selectedVersion={selectedVersion}
          titleOptions={getTenderTitles()}
          versionOptions={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
          onTitleChange={handleTenderTitleChange}
          onVersionChange={handleVersionChange}
          onPickTender={(tender) => {
            setSelectedTenderId(tender.id);
            setSelectedTenderTitle(tender.title);
            setSelectedVersion(tender.version || 1);
            void loadSavedTacticId(tender.id);
            fetchMarkupData(tender.id);
          }}
        />
      </>
    );
  }

  return (
    <>
      {choiceModal}
      <Card
        bordered={false}
        headStyle={{ borderBottom: 'none', paddingBottom: 0 }}
        title={
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <Space size="middle" wrap>
                <Space size="small">
                  <Text type="secondary" style={{ fontSize: 16 }}>Тендер:</Text>
                  <Select
                    className="tender-select"
                    placeholder="Выберите тендер"
                    value={selectedTenderTitle}
                    onChange={handleTenderTitleChange}
                    showSearch
                    optionFilterProp="children"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={getTenderTitles()}
                    style={{ width: 350, fontSize: 16 }}
                    allowClear
                  />
                </Space>
                <Space size="small">
                  <Text type="secondary" style={{ fontSize: 16 }}>Версия:</Text>
                  <Select
                    placeholder="Версия"
                    value={selectedVersion}
                    onChange={handleVersionChange}
                    disabled={!selectedTenderTitle}
                    options={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
                    style={{ width: 140 }}
                  />
                </Space>
              </Space>
              <div>
                <Space>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={handleReset}
                    disabled={!selectedTenderId}
                  >
                    Сбросить
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSave}
                    loading={saving}
                    disabled={!selectedTenderId || (percentSet === 'new' && tacticsOfSet.length === 0)}
                  >
                    Сохранить
                  </Button>
                </Space>
              </div>
            </div>
          </Space>
        }
      >
        <Tabs
          defaultActiveKey="percentages"
          items={[
            {
              key: 'percentages',
              label: 'Базовые проценты',
              children: (
                <PercentagesTab
                  form={form}
                  loading={loading || loadingParameters}
                  allParams={markupParameters}
                  setParams={setParams}
                  percentSet={percentSet}
                  onPercentSetChange={setPercentSet}
                  setTactics={tacticsOfSet}
                  selectedTacticId={selectedTacticId}
                  onTacticChange={handleTacticChange}
                  tenderId={selectedTenderId}
                  savedSet={savedSet}
                  selectedTacticName={selectedTacticName}
                />
              ),
            },
            {
              key: 'subcontract_growth',
              label: 'Рост субподряда',
              children: <SubcontractGrowthTab tenderId={selectedTenderId} />,
            },
          ]}
        />
      </Card>
    </>
  );
};

export default MarkupPercentages;
