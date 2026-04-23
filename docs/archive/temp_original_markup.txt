import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Space,
  Form,
  Select,
  InputNumber,
  Input,
  Button,
  message,
  Spin,
  Tabs,
  Row,
  Col,
  Tag,
  Divider,
  theme,
  Radio,
  Modal,
  List,
  App,
  Table
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, EditOutlined, CloseOutlined, ArrowLeftOutlined, CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { supabase, Tender, TenderMarkupPercentageInsert, MarkupParameter, MarkupTactic, PricingDistribution, PricingDistributionInsert, DistributionTarget } from '../../../lib/supabase';
import { formatNumberWithSpaces, parseNumberWithSpaces } from '../../../utils/numberFormat';
import dayjs from 'dayjs';
import './MarkupConstructor.css';

const { Title, Text } = Typography;

interface MarkupStep {
  name?: string; // Название пункта
  baseIndex: number; // -1 для базовой стоимости, или индекс пункта в массиве

  // Первая операция
  action1: 'multiply' | 'divide' | 'add' | 'subtract';
  operand1Type: 'markup' | 'step' | 'number'; // наценка, результат другого шага или число
  operand1Key?: string | number; // ключ наценки (если operand1Type = 'markup') или число
  operand1Index?: number; // индекс шага (если operand1Type = 'step')
  operand1MultiplyFormat?: 'addOne' | 'direct'; // формат умножения: 'addOne' = (1 + %), 'direct' = %

  // Вторая операция (опциональная)
  action2?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand2Type?: 'markup' | 'step' | 'number';
  operand2Key?: string | number;
  operand2Index?: number;
  operand2MultiplyFormat?: 'addOne' | 'direct';

  // Третья операция (опциональная)
  action3?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand3Type?: 'markup' | 'step' | 'number';
  operand3Key?: string | number;
  operand3Index?: number;
  operand3MultiplyFormat?: 'addOne' | 'direct';

  // Четвертая операция (опциональная)
  action4?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand4Type?: 'markup' | 'step' | 'number';
  operand4Key?: string | number;
  operand4Index?: number;
  operand4MultiplyFormat?: 'addOne' | 'direct';

  // Пятая операция (опциональная)
  action5?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand5Type?: 'markup' | 'step' | 'number';
  operand5Key?: string | number;
  operand5Index?: number;
  operand5MultiplyFormat?: 'addOne' | 'direct';
}

type TabKey = 'works' | 'materials' | 'subcontract_works' | 'subcontract_materials' | 'work_comp' | 'material_comp';

const ACTIONS = [
  { value: 'multiply', label: '× Умножить', symbol: '×' },
  { value: 'divide', label: '÷ Разделить', symbol: '÷' },
  { value: 'add', label: '+ Сложить', symbol: '+' },
  { value: 'subtract', label: '− Вычесть', symbol: '−' },
] as const;

const MarkupConstructor: React.FC = () => {
  const [form] = Form.useForm();
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tactics, setTactics] = useState<MarkupTactic[]>([]); // Список доступных тактик
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTacticId, setSelectedTacticId] = useState<string | null>(null); // Выбранная тактика в селекте
  const [currentMarkupId, setCurrentMarkupId] = useState<string | null>(null);
  const [currentTacticId, setCurrentTacticId] = useState<string | null>(null); // ID сохраненной тактики в БД
  const [currentTacticName, setCurrentTacticName] = useState<string>(''); // Название текущей тактики
  const [activeTab, setActiveTab] = useState<TabKey>('works');
  const [isDataLoaded, setIsDataLoaded] = useState(false); // Флаг для предотвращения автосохранения до загрузки
  const [isTacticSelected, setIsTacticSelected] = useState(false); // Флаг выбора схемы
  const [loadingTactics, setLoadingTactics] = useState(false); // Загрузка списка тактик
  const [isEditingName, setIsEditingName] = useState(false); // Флаг редактирования названия
  const [editingName, setEditingName] = useState(''); // Редактируемое название
  const [tacticSearchText, setTacticSearchText] = useState(''); // Поисковый запрос для схем

  // Состояния для параметров наценок (загружаются из БД)
  const [markupParameters, setMarkupParameters] = useState<MarkupParameter[]>([]);
  const [loadingParameters, setLoadingParameters] = useState(false);

  // Состояния для управления параметрами
  const [isAddParameterModalOpen, setIsAddParameterModalOpen] = useState(false);
  const [newParameterForm] = Form.useForm();

  // Состояния для inline редактирования параметров
  const [editingParameterId, setEditingParameterId] = useState<string | null>(null);
  const [editingParameterLabel, setEditingParameterLabel] = useState('');

  // Состояния для базовых процентов
  const [basePercentagesForm] = Form.useForm();
  const [savingBasePercentages, setSavingBasePercentages] = useState(false);

  // Состояния для ценообразования (распределение затрат между КП и работами)
  const [pricingDistribution, setPricingDistribution] = useState<PricingDistribution | null>(null);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);

  // Состояния для порядка наценок на каждой вкладке
  const [markupSequences, setMarkupSequences] = useState<Record<TabKey, MarkupStep[]>>({
    works: [],
    materials: [],
    subcontract_works: [],
    subcontract_materials: [],
    work_comp: [],
    material_comp: [],
  });

  // Базовая стоимость для каждой вкладки
  const [baseCosts, setBaseCosts] = useState<Record<TabKey, number>>({
    works: 0,
    materials: 0,
    subcontract_works: 0,
    subcontract_materials: 0,
    work_comp: 0,
    material_comp: 0,
  });

  // Состояния для формы добавления наценок для каждой вкладки
  const [insertPositions, setInsertPositions] = useState<Record<TabKey, number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  // Первая операция
  const [action1, setAction1] = useState<Record<TabKey, 'multiply' | 'divide' | 'add' | 'subtract'>>({
    works: 'multiply',
    materials: 'multiply',
    subcontract_works: 'multiply',
    subcontract_materials: 'multiply',
    work_comp: 'multiply',
    material_comp: 'multiply',
  });

  const [operand1Type, setOperand1Type] = useState<Record<TabKey, 'markup' | 'step' | 'number'>>({
    works: 'markup',
    materials: 'markup',
    subcontract_works: 'markup',
    subcontract_materials: 'markup',
    work_comp: 'markup',
    material_comp: 'markup',
  });

  const [operand1Value, setOperand1Value] = useState<Record<TabKey, string | number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  const [operand1InputMode, setOperand1InputMode] = useState<Record<TabKey, 'select' | 'manual'>>({
    works: 'select',
    materials: 'select',
    subcontract_works: 'select',
    subcontract_materials: 'select',
    work_comp: 'select',
    material_comp: 'select',
  });

  const [operand1MultiplyFormat, setOperand1MultiplyFormat] = useState<Record<TabKey, 'addOne' | 'direct'>>({
    works: 'addOne',
    materials: 'addOne',
    subcontract_works: 'addOne',
    subcontract_materials: 'addOne',
    work_comp: 'addOne',
    material_comp: 'addOne',
  });

  // Вторая операция
  const [action2, setAction2] = useState<Record<TabKey, 'multiply' | 'divide' | 'add' | 'subtract'>>({
    works: 'multiply',
    materials: 'multiply',
    subcontract_works: 'multiply',
    subcontract_materials: 'multiply',
    work_comp: 'multiply',
    material_comp: 'multiply',
  });

  const [operand2Type, setOperand2Type] = useState<Record<TabKey, 'markup' | 'step' | 'number'>>({
    works: 'markup',
    materials: 'markup',
    subcontract_works: 'markup',
    subcontract_materials: 'markup',
    work_comp: 'markup',
    material_comp: 'markup',
  });

  const [operand2Value, setOperand2Value] = useState<Record<TabKey, string | number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  const [operand2MultiplyFormat, setOperand2MultiplyFormat] = useState<Record<TabKey, 'addOne' | 'direct'>>({
    works: 'addOne',
    materials: 'addOne',
    subcontract_works: 'addOne',
    subcontract_materials: 'addOne',
    work_comp: 'addOne',
    material_comp: 'addOne',
  });

  // Третья операция
  const [action3, setAction3] = useState<Record<TabKey, 'multiply' | 'divide' | 'add' | 'subtract'>>({
    works: 'multiply',
    materials: 'multiply',
    subcontract_works: 'multiply',
    subcontract_materials: 'multiply',
    work_comp: 'multiply',
    material_comp: 'multiply',
  });

  const [operand3Type, setOperand3Type] = useState<Record<TabKey, 'markup' | 'step' | 'number'>>({
    works: 'markup',
    materials: 'markup',
    subcontract_works: 'markup',
    subcontract_materials: 'markup',
    work_comp: 'markup',
    material_comp: 'markup',
  });

  const [operand3Value, setOperand3Value] = useState<Record<TabKey, string | number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  const [operand3MultiplyFormat, setOperand3MultiplyFormat] = useState<Record<TabKey, 'addOne' | 'direct'>>({
    works: 'addOne',
    materials: 'addOne',
    subcontract_works: 'addOne',
    subcontract_materials: 'addOne',
    work_comp: 'addOne',
    material_comp: 'addOne',
  });

  // Четвертая операция
  const [action4, setAction4] = useState<Record<TabKey, 'multiply' | 'divide' | 'add' | 'subtract'>>({
    works: 'multiply',
    materials: 'multiply',
    subcontract_works: 'multiply',
    subcontract_materials: 'multiply',
    work_comp: 'multiply',
    material_comp: 'multiply',
  });

  const [operand4Type, setOperand4Type] = useState<Record<TabKey, 'markup' | 'step' | 'number'>>({
    works: 'markup',
    materials: 'markup',
    subcontract_works: 'markup',
    subcontract_materials: 'markup',
    work_comp: 'markup',
    material_comp: 'markup',
  });

  const [operand4Value, setOperand4Value] = useState<Record<TabKey, string | number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  const [operand4MultiplyFormat, setOperand4MultiplyFormat] = useState<Record<TabKey, 'addOne' | 'direct'>>({
    works: 'addOne',
    materials: 'addOne',
    subcontract_works: 'addOne',
    subcontract_materials: 'addOne',
    work_comp: 'addOne',
    material_comp: 'addOne',
  });

  // Пятая операция
  const [action5, setAction5] = useState<Record<TabKey, 'multiply' | 'divide' | 'add' | 'subtract'>>({
    works: 'multiply',
    materials: 'multiply',
    subcontract_works: 'multiply',
    subcontract_materials: 'multiply',
    work_comp: 'multiply',
    material_comp: 'multiply',
  });

  const [operand5Type, setOperand5Type] = useState<Record<TabKey, 'markup' | 'step' | 'number'>>({
    works: 'markup',
    materials: 'markup',
    subcontract_works: 'markup',
    subcontract_materials: 'markup',
    work_comp: 'markup',
    material_comp: 'markup',
  });

  const [operand5Value, setOperand5Value] = useState<Record<TabKey, string | number | undefined>>({
    works: undefined,
    materials: undefined,
    subcontract_works: undefined,
    subcontract_materials: undefined,
    work_comp: undefined,
    material_comp: undefined,
  });

  const [operand5MultiplyFormat, setOperand5MultiplyFormat] = useState<Record<TabKey, 'addOne' | 'direct'>>({
    works: 'addOne',
    materials: 'addOne',
    subcontract_works: 'addOne',
    subcontract_materials: 'addOne',
    work_comp: 'addOne',
    material_comp: 'addOne',
  });

  // Режим ввода операндов (выбор из списка или ручной ввод числа)
  const [operand2InputMode, setOperand2InputMode] = useState<Record<TabKey, 'select' | 'manual'>>({
    works: 'select',
    materials: 'select',
    subcontract_works: 'select',
    subcontract_materials: 'select',
    work_comp: 'select',
    material_comp: 'select',
  });

  const [operand3InputMode, setOperand3InputMode] = useState<Record<TabKey, 'select' | 'manual'>>({
    works: 'select',
    materials: 'select',
    subcontract_works: 'select',
    subcontract_materials: 'select',
    work_comp: 'select',
    material_comp: 'select',
  });

  const [operand4InputMode, setOperand4InputMode] = useState<Record<TabKey, 'select' | 'manual'>>({
    works: 'select',
    materials: 'select',
    subcontract_works: 'select',
    subcontract_materials: 'select',
    work_comp: 'select',
    material_comp: 'select',
  });

  const [operand5InputMode, setOperand5InputMode] = useState<Record<TabKey, 'select' | 'manual'>>({
    works: 'select',
    materials: 'select',
    subcontract_works: 'select',
    subcontract_materials: 'select',
    work_comp: 'select',
    material_comp: 'select',
  });

  // Видимость полей второго действия
  const [showSecondAction, setShowSecondAction] = useState<Record<TabKey, boolean>>({
    works: false,
    materials: false,
    subcontract_works: false,
    subcontract_materials: false,
    work_comp: false,
    material_comp: false,
  });

  // Видимость полей третьего действия
  const [showThirdAction, setShowThirdAction] = useState<Record<TabKey, boolean>>({
    works: false,
    materials: false,
    subcontract_works: false,
    subcontract_materials: false,
    work_comp: false,
    material_comp: false,
  });

  // Видимость полей четвертого действия
  const [showFourthAction, setShowFourthAction] = useState<Record<TabKey, boolean>>({
    works: false,
    materials: false,
    subcontract_works: false,
    subcontract_materials: false,
    work_comp: false,
    material_comp: false,
  });

  // Видимость полей пятого действия
  const [showFifthAction, setShowFifthAction] = useState<Record<TabKey, boolean>>({
    works: false,
    materials: false,
    subcontract_works: false,
    subcontract_materials: false,
    work_comp: false,
    material_comp: false,
  });

  // Названия пунктов
  const [stepName, setStepName] = useState<Record<TabKey, string>>({
    works: '',
    materials: '',
    subcontract_works: '',
    subcontract_materials: '',
    work_comp: '',
    material_comp: '',
  });

  // Загрузка существующей тактики из Supabase
  const fetchTacticFromSupabase = async (tenderId?: string) => {
    try {
      let tacticId: string | null = null;

      // Если указан тендер, пытаемся получить его тактику
      if (tenderId) {
        const { data: tenderData, error: tenderError } = await supabase
          .from('tenders')
          .select('markup_tactic_id')
          .eq('id', tenderId)
          .single();

        if (tenderError) {
          console.error('Ошибка загрузки тендера:', tenderError);
        } else if (tenderData?.markup_tactic_id) {
          tacticId = tenderData.markup_tactic_id;
        }
      }

      // Если не нашли тактику для тендера, загружаем глобальную "Текущая тактика"
      if (!tacticId) {
        const { data: globalTactic, error: globalError } = await supabase
          .from('markup_tactics')
          .select('id')
          .eq('name', 'Текущая тактика')
          .eq('is_global', true)
          .single();

        if (globalError) {
          console.error('Ошибка загрузки глобальной тактики:', globalError);
          return null;
        }

        tacticId = globalTactic?.id || null;
      }

      if (!tacticId) {
        console.warn('Не найдена тактика для загрузки');
        return null;
      }

      // Загружаем тактику по ID
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .eq('id', tacticId)
        .single();

      if (error) {
        console.error('Ошибка загрузки тактики из Supabase:', error);
        return null;
      }

      if (data) {
        console.log('Загружена тактика из Supabase:', data);
        setCurrentTacticId(data.id);
        setCurrentTacticName(data.name || 'Текущая тактика');

        // Преобразование из русского формата в английский
        const sequencesEn = {
          works: data.sequences['раб'] || [],
          materials: data.sequences['мат'] || [],
          subcontract_works: data.sequences['суб-раб'] || [],
          subcontract_materials: data.sequences['суб-мат'] || [],
          work_comp: data.sequences['раб-комп.'] || [],
          material_comp: data.sequences['мат-комп.'] || [],
        };

        const baseCostsEn = {
          works: data.base_costs['раб'] || 0,
          materials: data.base_costs['мат'] || 0,
          subcontract_works: data.base_costs['суб-раб'] || 0,
          subcontract_materials: data.base_costs['суб-мат'] || 0,
          work_comp: data.base_costs['раб-комп.'] || 0,
          material_comp: data.base_costs['мат-комп.'] || 0,
        };

        return { sequences: sequencesEn, baseCosts: baseCostsEn, tacticId: data.id };
      }

      return null;
    } catch (error) {
      console.error('Ошибка при загрузке тактики:', error);
      return null;
    }
  };

  // Загрузка параметров наценок из БД
  const fetchMarkupParameters = async () => {
    setLoadingParameters(true);
    try {
      const { data, error } = await supabase
        .from('markup_parameters')
        .select('*')
        .eq('is_active', true)
        .order('order_num', { ascending: true });

      if (error) throw error;

      if (data) {
        setMarkupParameters(data);

        // Инициализируем форму базовых процентов значениями из default_value
        const initialValues: Record<string, number> = {};
        data.forEach((param) => {
          initialValues[param.key] = param.default_value || 0;
        });
        basePercentagesForm.setFieldsValue(initialValues);

        // Также инициализируем основную форму базовыми значениями (для расчётов)
        form.setFieldsValue(initialValues);
      }
    } catch (error) {
      console.error('Ошибка загрузки параметров наценок:', error);
      message.error('Не удалось загрузить параметры наценок');
    } finally {
      setLoadingParameters(false);
    }
  };

  // Сохранение базовых процентов
  const handleSaveBasePercentages = async () => {
    try {
      await basePercentagesForm.validateFields();
      const values = basePercentagesForm.getFieldsValue();
      setSavingBasePercentages(true);

      // Обновляем default_value для каждого параметра
      const updatePromises = markupParameters.map(async (param) => {
        const { error } = await supabase
          .from('markup_parameters')
          .update({
            default_value: values[param.key] || 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', param.id);

        if (error) throw error;
      });

      await Promise.all(updatePromises);

      message.success('Базовые проценты успешно сохранены');

      // Перезагружаем параметры для обновления локального состояния
      await fetchMarkupParameters();
    } catch (error) {
      console.error('Ошибка сохранения базовых процентов:', error);
      message.error('Не удалось сохранить базовые проценты');
    } finally {
      setSavingBasePercentages(false);
    }
  };

  // Сброс формы базовых процентов
  const handleResetBasePercentages = () => {
    const initialValues: Record<string, number> = {};
    markupParameters.forEach((param) => {
      initialValues[param.key] = param.default_value || 0;
    });
    basePercentagesForm.setFieldsValue(initialValues);
  };

  // Загрузка списка тендеров и тактик
  useEffect(() => {
    fetchTenders();
    fetchTactics();
    fetchMarkupParameters(); // Загружаем параметры наценок
  }, []);

  // Загрузка и сохранение тактик наценок из localStorage и Supabase
  useEffect(() => {
    const loadData = async () => {
      // Сначала пытаемся загрузить из Supabase
      const tacticFromDb = await fetchTacticFromSupabase();

      if (tacticFromDb) {
        // Если есть данные в БД - используем их
        setMarkupSequences(tacticFromDb.sequences);
        setBaseCosts(tacticFromDb.baseCosts);
      } else {
        // Иначе загружаем из localStorage
        const savedSequences = localStorage.getItem('markupSequences');
        const savedBaseCosts = localStorage.getItem('markupBaseCosts');

        if (savedSequences) {
          try {
            const parsed = JSON.parse(savedSequences);
            console.log('Загружены тактики из localStorage:', parsed);
            setMarkupSequences(parsed);
          } catch (e) {
            console.error('Ошибка загрузки тактик наценок:', e);
            localStorage.removeItem('markupSequences');
          }
        }

        if (savedBaseCosts) {
          try {
            const parsed = JSON.parse(savedBaseCosts);
            console.log('Загружены базовые стоимости из localStorage:', parsed);
            setBaseCosts(parsed);
          } catch (e) {
            console.error('Ошибка загрузки базовых стоимостей:', e);
            localStorage.removeItem('markupBaseCosts');
          }
        }
      }

      // Устанавливаем флаг, что данные загружены
      setIsDataLoaded(true);
    };

    loadData();
  }, []);

  // Сохранение тактик наценок в localStorage при изменении
  useEffect(() => {
    if (!isDataLoaded) return; // Не сохраняем до первой загрузки данных
    console.log('Автосохранение тактик:', markupSequences);
    localStorage.setItem('markupSequences', JSON.stringify(markupSequences));
    localStorage.setItem('markupSequencesVersion', 'v2');
  }, [markupSequences, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return; // Не сохраняем до первой загрузки данных
    console.log('Автосохранение базовых стоимостей:', baseCosts);
    localStorage.setItem('markupBaseCosts', JSON.stringify(baseCosts));
  }, [baseCosts, isDataLoaded]);

  const fetchTenders = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenders(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const fetchTactics = async () => {
    setLoadingTactics(true);
    try {
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .order('created_at', { ascending: false});

      if (error) throw error;
      setTactics(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тактик:', error);
      message.error('Не удалось загрузить список тактик');
    } finally {
      setLoadingTactics(false);
    }
  };

  // Загрузка настроек распределения затрат для тендера
  const fetchPricingDistribution = async (tenderId: string) => {
    setLoadingPricing(true);
    try {
      const { data, error } = await supabase
        .from('tender_pricing_distribution')
        .select('*')
        .eq('tender_id', tenderId)
        .maybeSingle();

      if (error) throw error;
      setPricingDistribution(data);
    } catch (error) {
      console.error('Ошибка загрузки настроек ценообразования:', error);
      message.error('Не удалось загрузить настройки ценообразования');
    } finally {
      setLoadingPricing(false);
    }
  };

  // Обработка изменения настройки распределения
  const handleDistributionChange = (
    itemType: string,
    targetType: 'base' | 'markup',
    value: DistributionTarget
  ) => {
    setPricingDistribution((prev) => {
      const fieldName =
        `${itemType}_${targetType}_target` as keyof PricingDistribution;

      return {
        ...(prev || {
          id: '',
          tender_id: selectedTenderId!,
          created_at: '',
          updated_at: '',
        }),
        [fieldName]: value,
      };
    });
  };

  // Сохранение настроек ценообразования
  const handleSavePricingDistribution = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер');
      return;
    }

    setSavingPricing(true);
    try {
      const dataToSave: PricingDistributionInsert = {
        tender_id: selectedTenderId,
        markup_tactic_id: selectedTacticId,
        basic_material_base_target: pricingDistribution?.basic_material_base_target || 'material',
        basic_material_markup_target: pricingDistribution?.basic_material_markup_target || 'work',
        auxiliary_material_base_target: pricingDistribution?.auxiliary_material_base_target || 'work',
        auxiliary_material_markup_target: pricingDistribution?.auxiliary_material_markup_target || 'work',
        component_material_base_target: pricingDistribution?.component_material_base_target || 'work',
        component_material_markup_target: pricingDistribution?.component_material_markup_target || 'work',
        subcontract_basic_material_base_target: pricingDistribution?.subcontract_basic_material_base_target || 'work',
        subcontract_basic_material_markup_target: pricingDistribution?.subcontract_basic_material_markup_target || 'work',
        subcontract_auxiliary_material_base_target: pricingDistribution?.subcontract_auxiliary_material_base_target || 'work',
        subcontract_auxiliary_material_markup_target: pricingDistribution?.subcontract_auxiliary_material_markup_target || 'work',
        work_base_target: pricingDistribution?.work_base_target || 'work',
        work_markup_target: pricingDistribution?.work_markup_target || 'work',
        component_work_base_target: pricingDistribution?.component_work_base_target || 'work',
        component_work_markup_target: pricingDistribution?.component_work_markup_target || 'work',
      };

      const { data, error } = await supabase
        .from('tender_pricing_distribution')
        .upsert(dataToSave, {
          onConflict: 'tender_id,markup_tactic_id',
        })
        .select()
        .single();

      if (error) throw error;

      setPricingDistribution(data);
      message.success('Настройки ценообразования успешно сохранены');
    } catch (error) {
      console.error('Ошибка сохранения настроек ценообразования:', error);
      message.error('Не удалось сохранить настройки ценообразования');
    } finally {
      setSavingPricing(false);
    }
  };

  // Сброс к значениям по умолчанию
  const handleResetPricingToDefaults = () => {
    setPricingDistribution((prev) => ({
      ...(prev || {
        id: '',
        tender_id: selectedTenderId!,
        created_at: '',
        updated_at: '',
      }),
      basic_material_base_target: 'material',
      basic_material_markup_target: 'work',
      auxiliary_material_base_target: 'work',
      auxiliary_material_markup_target: 'work',
      component_material_base_target: 'work',
      component_material_markup_target: 'work',
      subcontract_basic_material_base_target: 'work',
      subcontract_basic_material_markup_target: 'work',
      subcontract_auxiliary_material_base_target: 'work',
      subcontract_auxiliary_material_markup_target: 'work',
      work_base_target: 'work',
      work_markup_target: 'work',
      component_work_base_target: 'work',
      component_work_markup_target: 'work',
    }));
    message.info('Настройки сброшены к значениям по умолчанию');
  };

  // Загрузка данных наценок для выбранного тендера
  const fetchMarkupData = async (tenderId: string) => {
    setLoading(true);
    try {
      // Загружаем все записи наценок для тендера с JOIN на markup_parameters
      const { data, error } = await supabase
        .from('tender_markup_percentage')
        .select('*, markup_parameter:markup_parameters(*)')
        .eq('tender_id', tenderId);

      if (error) throw error;

      // Инициализируем объект с базовыми значениями для всех параметров
      const markupValues: Record<string, number> = {};
      markupParameters.forEach((param) => {
        markupValues[param.key] = param.default_value || 0;
      });

      if (data && data.length > 0) {
        // Заполняем значения из загруженных записей
        data.forEach((record: any) => {
          if (record.markup_parameter) {
            markupValues[record.markup_parameter.key] = record.value || 0;
          }
        });
        setCurrentMarkupId(tenderId);
      } else {
        setCurrentMarkupId(null);
      }

      // Устанавливаем значения в форму
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

  // Обработка выбора тендера
  const handleTenderChange = async (tenderId: string) => {
    setSelectedTenderId(tenderId);

    // Загружаем тактику для выбранного тендера
    const tacticFromDb = await fetchTacticFromSupabase(tenderId);
    if (tacticFromDb) {
      setMarkupSequences(tacticFromDb.sequences);
      setBaseCosts(tacticFromDb.baseCosts);
      setSelectedTacticId(tacticFromDb.tacticId); // Устанавливаем сохраненную тактику тендера
    }

    // Загружаем данные наценок для тендера
    fetchMarkupData(tenderId);

    // Загружаем настройки ценообразования для тендера
    fetchPricingDistribution(tenderId);
  };

  // Обработка выбора тактики
  const handleTacticChange = async (tacticId: string) => {
    setSelectedTacticId(tacticId);

    // Загружаем выбранную тактику
    try {
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .eq('id', tacticId)
        .single();

      if (error) throw error;

      if (data) {
        setCurrentTacticId(data.id);
        setCurrentTacticName(data.name || 'Без названия');

        // Преобразование из русского формата в английский
        const sequencesEn = {
          works: data.sequences['раб'] || [],
          materials: data.sequences['мат'] || [],
          subcontract_works: data.sequences['суб-раб'] || [],
          subcontract_materials: data.sequences['суб-мат'] || [],
          work_comp: data.sequences['раб-комп.'] || [],
          material_comp: data.sequences['мат-комп.'] || [],
        };

        const baseCostsEn = {
          works: data.base_costs['раб'] || 0,
          materials: data.base_costs['мат'] || 0,
          subcontract_works: data.base_costs['суб-раб'] || 0,
          subcontract_materials: data.base_costs['суб-мат'] || 0,
          work_comp: data.base_costs['раб-комп.'] || 0,
          material_comp: data.base_costs['мат-комп.'] || 0,
        };

        setMarkupSequences(sequencesEn);
        setBaseCosts(baseCostsEn);
        setIsTacticSelected(true); // Показываем страницу
        setIsDataLoaded(true); // Разрешаем автосохранение
      }
    } catch (error) {
      console.error('Ошибка загрузки тактики:', error);
      message.error('Не удалось загрузить тактику');
    }
  };

  // Сохранение данных
  const handleSave = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер');
      return;
    }

    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      setSaving(true);

      // Если данные уже существуют - удаляем старые записи
      if (currentMarkupId) {
        const { error: deleteError } = await supabase
          .from('tender_markup_percentage')
          .delete()
          .eq('tender_id', selectedTenderId);

        if (deleteError) throw deleteError;
      }

      // Создаем массив записей для вставки (по одной для каждого параметра)
      const markupRecords: TenderMarkupPercentageInsert[] = markupParameters.map((param) => ({
        tender_id: selectedTenderId,
        markup_parameter_id: param.id,
        value: values[param.key] || 0,
      }));

      // Вставляем все записи одним запросом
      const { error: insertError } = await supabase
        .from('tender_markup_percentage')
        .insert(markupRecords);

      if (insertError) throw insertError;

      // Обновляем порядок расчета в тендере, если он был изменен
      if (selectedTacticId) {
        const { error: updateTenderError } = await supabase
          .from('tenders')
          .update({ markup_tactic_id: selectedTacticId })
          .eq('id', selectedTenderId);

        if (updateTenderError) throw updateTenderError;
      }

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
      fetchMarkupData(selectedTenderId);
    } else {
      form.resetFields();
    }
  };

  // Возврат к списку схем
  const handleBackToList = () => {
    setIsTacticSelected(false);
    setIsDataLoaded(false);
    setCurrentTacticId(null);
    setCurrentTacticName('');
    setSelectedTacticId(null);
    setIsEditingName(false);
  };

  // Функции для редактирования названия схемы
  const handleStartEditingName = () => {
    setEditingName(currentTacticName || 'Новая схема');
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!editingName.trim()) {
      message.warning('Название схемы не может быть пустым');
      return;
    }

    if (currentTacticId) {
      try {
        const { error } = await supabase
          .from('markup_tactics')
          .update({ name: editingName })
          .eq('id', currentTacticId);

        if (error) throw error;

        setCurrentTacticName(editingName);
        setIsEditingName(false);
        message.success('Название схемы обновлено');
        await fetchTactics(); // Обновляем список
      } catch (error) {
        console.error('Ошибка обновления названия:', error);
        message.error('Не удалось обновить название');
      }
    } else {
      // Для новой схемы просто обновляем локальное состояние
      setCurrentTacticName(editingName);
      setIsEditingName(false);
    }
  };

  const handleCancelEditingName = () => {
    setIsEditingName(false);
    setEditingName('');
  };

  // Добавление нового параметра наценки в БД
  const handleAddParameter = async () => {
    try {
      const values = await newParameterForm.validateFields();
      const { parameterKey, parameterLabel } = values;

      // Проверяем, не существует ли уже параметр с таким ключом
      const existing = markupParameters.find(p => p.key === parameterKey);
      if (existing) {
        message.error('Параметр с таким ключом уже существует');
        return;
      }

      // Определяем следующий order_num
      const maxOrderNum = markupParameters.length > 0
        ? Math.max(...markupParameters.map(p => p.order_num || 0))
        : 0;

      // Добавляем параметр в БД
      const { data, error } = await supabase
        .from('markup_parameters')
        .insert({
          key: parameterKey,
          label: parameterLabel,
          is_active: true,
          order_num: maxOrderNum + 1
        })
        .select()
        .single();

      if (error) throw error;

      message.success(`Параметр "${parameterLabel}" успешно добавлен!`);

      // Обновляем список параметров
      await fetchMarkupParameters();

      // Закрываем модальное окно
      handleCloseParameterModal();
    } catch (error) {
      console.error('Ошибка добавления параметра:', error);
      message.error('Не удалось добавить параметр');
    }
  };

  // Начало inline редактирования параметра
  const handleInlineEdit = (parameter: MarkupParameter) => {
    setEditingParameterId(parameter.id);
    setEditingParameterLabel(parameter.label);
  };

  // Сохранение inline редактирования
  const handleInlineSave = async (parameterId: string) => {
    if (!editingParameterLabel.trim()) {
      message.error('Название параметра не может быть пустым');
      return;
    }

    try {
      const { error } = await supabase
        .from('markup_parameters')
        .update({
          label: editingParameterLabel,
          updated_at: new Date().toISOString()
        })
        .eq('id', parameterId);

      if (error) throw error;

      message.success('Параметр успешно обновлен!');
      await fetchMarkupParameters();
      setEditingParameterId(null);
      setEditingParameterLabel('');
    } catch (error) {
      console.error('Ошибка обновления параметра:', error);
      message.error('Не удалось обновить параметр');
    }
  };

  // Отмена inline редактирования
  const handleInlineCancel = () => {
    setEditingParameterId(null);
    setEditingParameterLabel('');
  };

  // Удаление параметра наценки
  const handleDeleteParameter = async (parameter: MarkupParameter) => {
    modal.confirm({
      title: 'Удаление параметра',
      content: `Вы уверены, что хотите удалить параметр "${parameter.label}"? Это действие необратимо.`,
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          const { error } = await supabase
            .from('markup_parameters')
            .delete()
            .eq('id', parameter.id);

          if (error) throw error;

          message.success(`Параметр "${parameter.label}" удален`);

          // Обновляем список параметров
          await fetchMarkupParameters();
        } catch (error) {
          console.error('Ошибка удаления параметра:', error);
          message.error('Не удалось удалить параметр');
        }
      }
    });
  };


  // Изменение порядка параметра (вверх)
  const handleMoveParameterUp = async (parameter: MarkupParameter) => {
    const currentIndex = markupParameters.findIndex(p => p.id === parameter.id);
    if (currentIndex === 0) return; // Уже первый

    const prevParameter = markupParameters[currentIndex - 1];

    try {
      // Меняем местами order_num
      await supabase
        .from('markup_parameters')
        .update({ order_num: prevParameter.order_num })
        .eq('id', parameter.id);

      await supabase
        .from('markup_parameters')
        .update({ order_num: parameter.order_num })
        .eq('id', prevParameter.id);

      message.success('Порядок изменен');
      await fetchMarkupParameters();
    } catch (error) {
      console.error('Ошибка изменения порядка:', error);
      message.error('Не удалось изменить порядок');
    }
  };

  // Изменение порядка параметра (вниз)
  const handleMoveParameterDown = async (parameter: MarkupParameter) => {
    const currentIndex = markupParameters.findIndex(p => p.id === parameter.id);
    if (currentIndex === markupParameters.length - 1) return; // Уже последний

    const nextParameter = markupParameters[currentIndex + 1];

    try {
      // Меняем местами order_num
      await supabase
        .from('markup_parameters')
        .update({ order_num: nextParameter.order_num })
        .eq('id', parameter.id);

      await supabase
        .from('markup_parameters')
        .update({ order_num: parameter.order_num })
        .eq('id', nextParameter.id);

      message.success('Порядок изменен');
      await fetchMarkupParameters();
    } catch (error) {
      console.error('Ошибка изменения порядка:', error);
      message.error('Не удалось изменить порядок');
    }
  };

  // Закрытие модального окна добавления параметра
  const handleCloseParameterModal = () => {
    setIsAddParameterModalOpen(false);
    newParameterForm.resetFields();
  };

  // Открытие модального окна добавления параметра
  const handleOpenParameterModal = () => {
    setIsAddParameterModalOpen(true);
  };

  // Сохранение тактики наценок
  const handleSaveTactic = async () => {
    try {
      console.log('Сохранение тактики:', { markupSequences, baseCosts });

      // Сохранение в localStorage
      localStorage.setItem('markupSequences', JSON.stringify(markupSequences));
      localStorage.setItem('markupBaseCosts', JSON.stringify(baseCosts));
      localStorage.setItem('markupSequencesVersion', 'v2');

      // Преобразование из английского формата в русский для Supabase
      const sequencesRu = {
        'раб': markupSequences.works,
        'мат': markupSequences.materials,
        'суб-раб': markupSequences.subcontract_works,
        'суб-мат': markupSequences.subcontract_materials,
        'раб-комп.': markupSequences.work_comp,
        'мат-комп.': markupSequences.material_comp,
      };

      const baseCostsRu = {
        'раб': baseCosts.works,
        'мат': baseCosts.materials,
        'суб-раб': baseCosts.subcontract_works,
        'суб-мат': baseCosts.subcontract_materials,
        'раб-комп.': baseCosts.work_comp,
        'мат-комп.': baseCosts.material_comp,
      };

      // Сохранение в Supabase (RLS отключен до внедрения аутентификации)
      if (currentTacticId) {
        // Обновляем существующую запись
        const { data, error } = await supabase
          .from('markup_tactics')
          .update({
            name: currentTacticName || 'Без названия',
            sequences: sequencesRu,
            base_costs: baseCostsRu,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentTacticId)
          .select()
          .single();

        if (error) {
          console.error('Ошибка обновления в Supabase:', error);
          message.warning('Порядок расчета сохранен локально, но не удалось обновить в базе данных');
        } else {
          console.log('Порядок расчета обновлен в Supabase:', data);

          // Если выбран тендер, обновляем его markup_tactic_id
          if (selectedTenderId) {
            const { error: tenderError } = await supabase
              .from('tenders')
              .update({ markup_tactic_id: currentTacticId })
              .eq('id', selectedTenderId);

            if (tenderError) {
              console.error('Ошибка обновления тендера:', tenderError);
            }
          }

          // Обновляем список тактик
          await fetchTactics();
          message.success('Порядок расчета успешно обновлен');
        }
      } else {
        // Создаем новую запись
        const { data, error } = await supabase
          .from('markup_tactics')
          .insert({
            name: currentTacticName || 'Новый порядок расчета',
            sequences: sequencesRu,
            base_costs: baseCostsRu,
            is_global: false,
          })
          .select()
          .single();

        if (error) {
          console.error('Ошибка сохранения в Supabase:', error);
          message.warning('Порядок расчета сохранен локально, но не удалось сохранить в базу данных');
        } else {
          console.log('Порядок расчета сохранен в Supabase:', data);
          setCurrentTacticId(data.id); // Сохраняем ID для последующих обновлений
          setSelectedTacticId(data.id); // Устанавливаем в селекте

          // Если выбран тендер, обновляем его markup_tactic_id
          if (selectedTenderId) {
            const { error: tenderError } = await supabase
              .from('tenders')
              .update({ markup_tactic_id: data.id })
              .eq('id', selectedTenderId);

            if (tenderError) {
              console.error('Ошибка обновления тендера:', tenderError);
            }
          }

          // Обновляем список тактик
          await fetchTactics();
          message.success('Порядок расчета успешно создан');
        }
      }
    } catch (error) {
      console.error('Ошибка сохранения порядка расчета:', error);
      message.error('Не удалось сохранить порядок расчета');
    }
  };

  // Удаление порядка расчета
  const handleDeleteTactic = async () => {
    if (!currentTacticId) {
      message.warning('Выберите порядок расчета для удаления');
      return;
    }

    // Найдем название тактики для отображения в подтверждении
    const tacticToDelete = tactics.find(t => t.id === currentTacticId);
    const tacticName = tacticToDelete?.name || 'Без названия';

    modal.confirm({
      title: 'Удаление порядка расчета',
      content: `Вы уверены, что хотите удалить порядок расчета "${tacticName}"? Это действие необратимо.`,
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          const { error } = await supabase
            .from('markup_tactics')
            .delete()
            .eq('id', currentTacticId);

          if (error) throw error;

          message.success(`Порядок расчета "${tacticName}" удален`);

          // Очищаем форму и состояние
          setSelectedTacticId(null);
          setCurrentTacticId(null);
          setCurrentTacticName('');
          setMarkupSequences({
            works: [],
            materials: [],
            subcontract_works: [],
            subcontract_materials: [],
            work_comp: [],
            material_comp: [],
          });
          setBaseCosts({
            works: 0,
            materials: 0,
            subcontract_works: 0,
            subcontract_materials: 0,
            work_comp: 0,
            material_comp: 0,
          });

          // Обновляем список тактик
          await fetchTactics();

          // Возвращаемся к списку схем
          setIsTacticSelected(false);
        } catch (error) {
          console.error('Ошибка удаления порядка расчета:', error);
          message.error('Не удалось удалить порядок расчета');
        }
      }
    });
  };

  // Функция копирования схемы наценок
  const handleCopyTactic = async () => {
    if (!currentTacticId) {
      message.warning('Выберите схему для копирования');
      return;
    }

    // Определяем новое название с версионированием
    let baseName = currentTacticName || 'Схема';
    let version = 2;

    // Проверяем, есть ли уже версия в названии
    const versionMatch = baseName.match(/^(.+)_v(\d+)$/);
    if (versionMatch) {
      baseName = versionMatch[1];
      version = parseInt(versionMatch[2]) + 1;
    }

    // Находим следующую доступную версию
    let defaultNewName = `${baseName}_v${version}`;
    while (tactics.some(t => t.name === defaultNewName)) {
      version++;
      defaultNewName = `${baseName}_v${version}`;
    }

    // Показываем модальное окно с возможностью изменить название
    let newName = defaultNewName;

    modal.confirm({
      title: 'Создание копии схемы',
      icon: <CopyOutlined />,
      content: (
        <div style={{ marginTop: 16 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>
            Будет создана копия схемы "{currentTacticName}" со всеми настройками порядка расчета.
          </Text>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Название новой схемы:
          </Text>
          <Input
            defaultValue={defaultNewName}
            onChange={(e) => { newName = e.target.value; }}
            placeholder="Введите название схемы"
            style={{ marginBottom: 8 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Совет: Используйте суффикс _v2, _v3 для версионирования
          </Text>
        </div>
      ),
      okText: 'Создать копию',
      cancelText: 'Отмена',
      onOk: async () => {
        if (!newName || !newName.trim()) {
          message.warning('Название схемы не может быть пустым');
          return Promise.reject();
        }

        // Проверяем уникальность имени
        if (tactics.some(t => t.name === newName.trim())) {
          message.warning('Схема с таким названием уже существует');
          return Promise.reject();
        }

        try {
          message.loading('Создание копии...', 0);

          // Получаем актуальные данные схемы из БД
          const { data: tacticToCopy, error: fetchError } = await supabase
            .from('markup_tactics')
            .select('*')
            .eq('id', currentTacticId)
            .single();

          if (fetchError || !tacticToCopy) {
            message.destroy();
            message.error('Схема не найдена');
            return;
          }

          // Подготавливаем данные для копирования
          // Используем текущие данные из состояния или данные из БД
          let sequencesToCopy: Record<string, any>;
          let baseCostsToCopy: Record<string, any>;

          if (currentTacticId && isDataLoaded) {
            // Если схема активна и загружена, используем текущие данные из состояния
            // Преобразуем в русский формат для БД
            sequencesToCopy = {
              'раб': markupSequences.works,
              'мат': markupSequences.materials,
              'суб-раб': markupSequences.subcontract_works,
              'суб-мат': markupSequences.subcontract_materials,
              'раб-комп.': markupSequences.work_comp,
              'мат-комп.': markupSequences.material_comp,
            };

            baseCostsToCopy = {
              'раб': baseCosts.works,
              'мат': baseCosts.materials,
              'суб-раб': baseCosts.subcontract_works,
              'суб-мат': baseCosts.subcontract_materials,
              'раб-комп.': baseCosts.work_comp,
              'мат-комп.': baseCosts.material_comp,
            };
          } else {
            // Используем данные из БД
            sequencesToCopy = tacticToCopy.sequences || {
              'раб': [],
              'мат': [],
              'суб-раб': [],
              'суб-мат': [],
              'раб-комп.': [],
              'мат-комп.': [],
            };

            baseCostsToCopy = tacticToCopy.base_costs || {
              'раб': 0,
              'мат': 0,
              'суб-раб': 0,
              'суб-мат': 0,
              'раб-комп.': 0,
              'мат-комп.': 0,
            };
          }

          const dataToCopy = {
            name: newName.trim(),
            is_global: false, // Копии никогда не глобальные
            sequences: sequencesToCopy,
            base_costs: baseCostsToCopy,
          };

          // Создаем копию тактики
          const { data: newTactic, error: tacticError } = await supabase
            .from('markup_tactics')
            .insert(dataToCopy)
            .select()
            .single();

          message.destroy();

          if (tacticError) throw tacticError;

          message.success(`Создана копия схемы: ${newName.trim()}`);

          // Обновляем список тактик
          await fetchTactics();

          // Переключаемся на новую схему для редактирования
          if (newTactic) {
            // Сбрасываем флаг выбора, чтобы вернуться к списку
            setIsTacticSelected(false);
            // Ждем немного для обновления UI
            setTimeout(() => {
              handleTacticChange(newTactic.id);
              setIsTacticSelected(true);
            }, 100);
          }
        } catch (error) {
          message.destroy();
          console.error('Ошибка копирования схемы:', error);
          message.error('Не удалось создать копию схемы');
          return Promise.reject(error);
        }
      }
    });
  };

  // Функции для управления порядком наценок
  const addMarkup = (tabKey: TabKey) => {
    const baseIdx = insertPositions[tabKey];
    const act1 = action1[tabKey];
    const op1Type = operand1Type[tabKey];
    const op1Value = operand1Value[tabKey];
    const act2 = action2[tabKey];
    const op2Type = operand2Type[tabKey];
    const op2Value = operand2Value[tabKey];
    const act3 = action3[tabKey];
    const op3Type = operand3Type[tabKey];
    const op3Value = operand3Value[tabKey];
    const act4 = action4[tabKey];
    const op4Type = operand4Type[tabKey];
    const op4Value = operand4Value[tabKey];
    const act5 = action5[tabKey];
    const op5Type = operand5Type[tabKey];
    const op5Value = operand5Value[tabKey];

    if (baseIdx === undefined || op1Value === undefined) {
      message.warning('Заполните обязательные поля');
      return;
    }

    const newStep: MarkupStep = {
      name: stepName[tabKey] || undefined,
      baseIndex: baseIdx,
      action1: act1,
      operand1Type: op1Type,
      operand1Key: op1Type === 'markup' ? String(op1Value) : (op1Type === 'number' ? Number(op1Value) : undefined),
      operand1Index: op1Type === 'step' ? Number(op1Value) : undefined,
      operand1MultiplyFormat: act1 === 'multiply' && op1Type === 'markup' ? operand1MultiplyFormat[tabKey] : undefined,
    };

    // Добавляем вторую операцию, если она заполнена
    if (op2Value !== undefined) {
      newStep.action2 = act2;
      newStep.operand2Type = op2Type;
      newStep.operand2Key = op2Type === 'markup' ? String(op2Value) : (op2Type === 'number' ? Number(op2Value) : undefined);
      newStep.operand2Index = op2Type === 'step' ? Number(op2Value) : undefined;
      newStep.operand2MultiplyFormat = act2 === 'multiply' && op2Type === 'markup' ? operand2MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем третью операцию, если она заполнена
    if (op3Value !== undefined) {
      newStep.action3 = act3;
      newStep.operand3Type = op3Type;
      newStep.operand3Key = op3Type === 'markup' ? String(op3Value) : (op3Type === 'number' ? Number(op3Value) : undefined);
      newStep.operand3Index = op3Type === 'step' ? Number(op3Value) : undefined;
      newStep.operand3MultiplyFormat = act3 === 'multiply' && op3Type === 'markup' ? operand3MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем четвертую операцию, если она заполнена
    if (op4Value !== undefined) {
      newStep.action4 = act4;
      newStep.operand4Type = op4Type;
      newStep.operand4Key = op4Type === 'markup' ? String(op4Value) : (op4Type === 'number' ? Number(op4Value) : undefined);
      newStep.operand4Index = op4Type === 'step' ? Number(op4Value) : undefined;
      newStep.operand4MultiplyFormat = act4 === 'multiply' && op4Type === 'markup' ? operand4MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем пятую операцию, если она заполнена
    if (op5Value !== undefined) {
      newStep.action5 = act5;
      newStep.operand5Type = op5Type;
      newStep.operand5Key = op5Type === 'markup' ? String(op5Value) : (op5Type === 'number' ? Number(op5Value) : undefined);
      newStep.operand5Index = op5Type === 'step' ? Number(op5Value) : undefined;
      newStep.operand5MultiplyFormat = act5 === 'multiply' && op5Type === 'markup' ? operand5MultiplyFormat[tabKey] : undefined;
    }

    setMarkupSequences(prev => ({
      ...prev,
      [tabKey]: [...prev[tabKey], newStep]
    }));

    // Очищаем форму
    setOperand1Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
    setInsertPositions(prev => ({ ...prev, [tabKey]: undefined }));
    setStepName(prev => ({ ...prev, [tabKey]: '' }));
    setShowSecondAction(prev => ({ ...prev, [tabKey]: false }));
    setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
    setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
    setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
  };

  const removeMarkup = (tabKey: TabKey, index: number) => {
    setMarkupSequences(prev => ({
      ...prev,
      [tabKey]: prev[tabKey].filter((_, i) => i !== index)
    }));
  };

  const editMarkup = (tabKey: TabKey, index: number) => {
    const step = markupSequences[tabKey][index];

    // Загружаем данные в форму
    setStepName(prev => ({ ...prev, [tabKey]: step.name || '' }));
    setInsertPositions(prev => ({ ...prev, [tabKey]: step.baseIndex }));
    setAction1(prev => ({ ...prev, [tabKey]: step.action1 }));
    setOperand1Type(prev => ({ ...prev, [tabKey]: step.operand1Type }));
    setOperand1Value(prev => ({
      ...prev,
      [tabKey]: step.operand1Type === 'markup' ? step.operand1Key : (step.operand1Type === 'number' ? step.operand1Key : step.operand1Index)
    }));
    setOperand1InputMode(prev => ({
      ...prev,
      [tabKey]: step.operand1Type === 'number' ? 'manual' : 'select'
    }));
    setOperand1MultiplyFormat(prev => ({
      ...prev,
      [tabKey]: step.operand1MultiplyFormat || 'addOne'
    }));

    if (step.action2 && step.operand2Type) {
      setAction2(prev => ({ ...prev, [tabKey]: step.action2! }));
      setOperand2Type(prev => ({ ...prev, [tabKey]: step.operand2Type! }));
      setOperand2Value(prev => ({
        ...prev,
        [tabKey]: step.operand2Type === 'markup' ? step.operand2Key : (step.operand2Type === 'number' ? step.operand2Key : step.operand2Index)
      }));
      setOperand2InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand2Type === 'number' ? 'manual' : 'select'
      }));
      setOperand2MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand2MultiplyFormat || 'addOne'
      }));
      setShowSecondAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowSecondAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action3 && step.operand3Type) {
      setAction3(prev => ({ ...prev, [tabKey]: step.action3! }));
      setOperand3Type(prev => ({ ...prev, [tabKey]: step.operand3Type! }));
      setOperand3Value(prev => ({
        ...prev,
        [tabKey]: step.operand3Type === 'markup' ? step.operand3Key : (step.operand3Type === 'number' ? step.operand3Key : step.operand3Index)
      }));
      setOperand3InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand3Type === 'number' ? 'manual' : 'select'
      }));
      setOperand3MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand3MultiplyFormat || 'addOne'
      }));
      setShowThirdAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action4 && step.operand4Type) {
      setAction4(prev => ({ ...prev, [tabKey]: step.action4! }));
      setOperand4Type(prev => ({ ...prev, [tabKey]: step.operand4Type! }));
      setOperand4Value(prev => ({
        ...prev,
        [tabKey]: step.operand4Type === 'markup' ? step.operand4Key : (step.operand4Type === 'number' ? step.operand4Key : step.operand4Index)
      }));
      setOperand4InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand4Type === 'number' ? 'manual' : 'select'
      }));
      setOperand4MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand4MultiplyFormat || 'addOne'
      }));
      setShowFourthAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action5 && step.operand5Type) {
      setAction5(prev => ({ ...prev, [tabKey]: step.action5! }));
      setOperand5Type(prev => ({ ...prev, [tabKey]: step.operand5Type! }));
      setOperand5Value(prev => ({
        ...prev,
        [tabKey]: step.operand5Type === 'markup' ? step.operand5Key : (step.operand5Type === 'number' ? step.operand5Key : step.operand5Index)
      }));
      setOperand5InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand5Type === 'number' ? 'manual' : 'select'
      }));
      setOperand5MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand5MultiplyFormat || 'addOne'
      }));
      setShowFifthAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
    }

    // Удаляем элемент из списка
    removeMarkup(tabKey, index);
  };

  const moveMarkupUp = (tabKey: TabKey, index: number) => {
    if (index === 0) return;
    setMarkupSequences(prev => {
      const newSequence = [...prev[tabKey]];
      [newSequence[index - 1], newSequence[index]] = [newSequence[index], newSequence[index - 1]];
      return { ...prev, [tabKey]: newSequence };
    });
  };

  const moveMarkupDown = (tabKey: TabKey, index: number) => {
    setMarkupSequences(prev => {
      if (index === prev[tabKey].length - 1) return prev;
      const newSequence = [...prev[tabKey]];
      [newSequence[index], newSequence[index + 1]] = [newSequence[index + 1], newSequence[index]];
      return { ...prev, [tabKey]: newSequence };
    });
  };

  // Получить все доступные наценки (без фильтрации)
  const getAvailableMarkups = (tabKey: TabKey) => {
    return markupParameters;
  };

  // Расчет промежуточных итогов
  const calculateIntermediateResults = (tabKey: TabKey): number[] => {
    const sequence = markupSequences[tabKey];
    const baseCost = baseCosts[tabKey];
    const results: number[] = [];

    sequence.forEach((step) => {
      // Определяем базовую стоимость для этого шага
      let baseValue: number;
      if (step.baseIndex === -1) {
        baseValue = baseCost;
      } else {
        baseValue = results[step.baseIndex] || baseCost;
      }

      // Получаем значение первого операнда
      let operand1Value: number;
      if (step.operand1Type === 'markup' && step.operand1Key) {
        const percentValue = form.getFieldValue(step.operand1Key) || 0;
        operand1Value = percentValue / 100;
      } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
        operand1Value = step.operand1Index === -1 ? baseCost : (results[step.operand1Index] || baseCost);
      } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
        operand1Value = step.operand1Key;
      } else {
        operand1Value = 0;
      }

      // Применяем первую операцию
      let resultValue: number;
      switch (step.action1) {
        case 'multiply':
          if (step.operand1Type === 'markup') {
            // Если formат 'direct' - умножаем напрямую на процент, иначе на (1 + процент)
            const multiplyFormat = step.operand1MultiplyFormat || 'addOne';
            resultValue = multiplyFormat === 'direct'
              ? baseValue * operand1Value
              : baseValue * (1 + operand1Value);
          } else {
            resultValue = baseValue * operand1Value;
          }
          break;
        case 'divide':
          if (step.operand1Type === 'markup') {
            resultValue = baseValue / (1 + operand1Value);
          } else {
            resultValue = baseValue / operand1Value;
          }
          break;
        case 'add':
          if (step.operand1Type === 'markup') {
            resultValue = baseValue + (baseValue * operand1Value);
          } else {
            resultValue = baseValue + operand1Value;
          }
          break;
        case 'subtract':
          if (step.operand1Type === 'markup') {
            resultValue = baseValue - (baseValue * operand1Value);
          } else {
            resultValue = baseValue - operand1Value;
          }
          break;
        default:
          resultValue = baseValue;
      }

      // Применяем вторую операцию, если она есть
      if (step.action2 && step.operand2Type) {
        let operand2Value: number;
        if (step.operand2Type === 'markup' && step.operand2Key) {
          const percentValue = form.getFieldValue(step.operand2Key) || 0;
          operand2Value = percentValue / 100;
        } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
          operand2Value = step.operand2Index === -1 ? baseCost : (results[step.operand2Index] || baseCost);
        } else if (step.operand2Type === 'number' && typeof step.operand2Key === 'number') {
          operand2Value = step.operand2Key;
        } else {
          operand2Value = 0;
        }

        switch (step.action2) {
          case 'multiply':
            if (step.operand2Type === 'markup') {
              const multiplyFormat2 = step.operand2MultiplyFormat || 'addOne';
              resultValue = multiplyFormat2 === 'direct'
                ? resultValue * operand2Value
                : resultValue * (1 + operand2Value);
            } else {
              resultValue = resultValue * operand2Value;
            }
            break;
          case 'divide':
            if (step.operand2Type === 'markup') {
              resultValue = resultValue / (1 + operand2Value);
            } else {
              resultValue = resultValue / operand2Value;
            }
            break;
          case 'add':
            if (step.operand2Type === 'markup') {
              resultValue = resultValue + (resultValue * operand2Value);
            } else {
              resultValue = resultValue + operand2Value;
            }
            break;
          case 'subtract':
            if (step.operand2Type === 'markup') {
              resultValue = resultValue - (resultValue * operand2Value);
            } else {
              resultValue = resultValue - operand2Value;
            }
            break;
        }
      }

      // Применяем третью операцию, если она есть
      if (step.action3 && step.operand3Type) {
        let operand3Value: number;
        if (step.operand3Type === 'markup' && step.operand3Key) {
          const percentValue = form.getFieldValue(step.operand3Key) || 0;
          operand3Value = percentValue / 100;
        } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
          operand3Value = step.operand3Index === -1 ? baseCost : (results[step.operand3Index] || baseCost);
        } else if (step.operand3Type === 'number' && typeof step.operand3Key === 'number') {
          operand3Value = step.operand3Key;
        } else {
          operand3Value = 0;
        }

        switch (step.action3) {
          case 'multiply':
            if (step.operand3Type === 'markup') {
              const multiplyFormat3 = step.operand3MultiplyFormat || 'addOne';
              resultValue = multiplyFormat3 === 'direct'
                ? resultValue * operand3Value
                : resultValue * (1 + operand3Value);
            } else {
              resultValue = resultValue * operand3Value;
            }
            break;
          case 'divide':
            if (step.operand3Type === 'markup') {
              resultValue = resultValue / (1 + operand3Value);
            } else {
              resultValue = resultValue / operand3Value;
            }
            break;
          case 'add':
            if (step.operand3Type === 'markup') {
              resultValue = resultValue + (resultValue * operand3Value);
            } else {
              resultValue = resultValue + operand3Value;
            }
            break;
          case 'subtract':
            if (step.operand3Type === 'markup') {
              resultValue = resultValue - (resultValue * operand3Value);
            } else {
              resultValue = resultValue - operand3Value;
            }
            break;
        }
      }

      // Применяем четвертую операцию, если она есть
      if (step.action4 && step.operand4Type) {
        let operand4Value: number;
        if (step.operand4Type === 'markup' && step.operand4Key) {
          const percentValue = form.getFieldValue(step.operand4Key) || 0;
          operand4Value = percentValue / 100;
        } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
          operand4Value = step.operand4Index === -1 ? baseCost : (results[step.operand4Index] || baseCost);
        } else if (step.operand4Type === 'number' && typeof step.operand4Key === 'number') {
          operand4Value = step.operand4Key;
        } else {
          operand4Value = 0;
        }

        switch (step.action4) {
          case 'multiply':
            if (step.operand4Type === 'markup') {
              const multiplyFormat4 = step.operand4MultiplyFormat || 'addOne';
              resultValue = multiplyFormat4 === 'direct'
                ? resultValue * operand4Value
                : resultValue * (1 + operand4Value);
            } else {
              resultValue = resultValue * operand4Value;
            }
            break;
          case 'divide':
            if (step.operand4Type === 'markup') {
              resultValue = resultValue / (1 + operand4Value);
            } else {
              resultValue = resultValue / operand4Value;
            }
            break;
          case 'add':
            if (step.operand4Type === 'markup') {
              resultValue = resultValue + (resultValue * operand4Value);
            } else {
              resultValue = resultValue + operand4Value;
            }
            break;
          case 'subtract':
            if (step.operand4Type === 'markup') {
              resultValue = resultValue - (resultValue * operand4Value);
            } else {
              resultValue = resultValue - operand4Value;
            }
            break;
        }
      }

      // Применяем пятую операцию, если она есть
      if (step.action5 && step.operand5Type) {
        let operand5Value: number;
        if (step.operand5Type === 'markup' && step.operand5Key) {
          const percentValue = form.getFieldValue(step.operand5Key) || 0;
          operand5Value = percentValue / 100;
        } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
          operand5Value = step.operand5Index === -1 ? baseCost : (results[step.operand5Index] || baseCost);
        } else if (step.operand5Type === 'number' && typeof step.operand5Key === 'number') {
          operand5Value = step.operand5Key;
        } else {
          operand5Value = 0;
        }

        switch (step.action5) {
          case 'multiply':
            if (step.operand5Type === 'markup') {
              const multiplyFormat5 = step.operand5MultiplyFormat || 'addOne';
              resultValue = multiplyFormat5 === 'direct'
                ? resultValue * operand5Value
                : resultValue * (1 + operand5Value);
            } else {
              resultValue = resultValue * operand5Value;
            }
            break;
          case 'divide':
            if (step.operand5Type === 'markup') {
              resultValue = resultValue / (1 + operand5Value);
            } else {
              resultValue = resultValue / operand5Value;
            }
            break;
          case 'add':
            if (step.operand5Type === 'markup') {
              resultValue = resultValue + (resultValue * operand5Value);
            } else {
              resultValue = resultValue + operand5Value;
            }
            break;
          case 'subtract':
            if (step.operand5Type === 'markup') {
              resultValue = resultValue - (resultValue * operand5Value);
            } else {
              resultValue = resultValue - operand5Value;
            }
            break;
        }
      }

      results.push(resultValue);
    });

    return results;
  };

  // Рендер вкладки с порядком наценок
  const renderMarkupSequenceTab = (tabKey: TabKey) => {
    const sequence = markupSequences[tabKey];
    const availableMarkups = getAvailableMarkups(tabKey);
    const insertPosition = insertPositions[tabKey];
    const act1 = action1[tabKey];
    const op1Type = operand1Type[tabKey];
    const op1Value = operand1Value[tabKey];
    const act2 = action2[tabKey];
    const op2Type = operand2Type[tabKey];
    const op2Value = operand2Value[tabKey];

    // Получаем промежуточные результаты
    const intermediateResults = calculateIntermediateResults(tabKey);
    const finalResult = intermediateResults.length > 0 ? intermediateResults[intermediateResults.length - 1] : baseCosts[tabKey];

    // Опции для выбора базовой стоимости или пункта
    const baseOptions = [
      { label: 'Базовая стоимость', value: -1 }
    ];

    sequence.forEach((step, index) => {
      const intermediateValue = intermediateResults[index];
      const stepLabel = step.name
        ? `${step.name} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`
        : `Пункт ${index + 1} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`;
      baseOptions.push({
        label: stepLabel,
        value: index
      });
    });

    // Опции для выбора операндов (наценки или пункты) с группировкой
    const markupOptionsList = availableMarkups.map(markup => ({
      label: `${markup.label} (${markup.default_value || 0}%)`,
      value: `markup:${markup.key}`
    }));

    const stepOptionsList = sequence.map((step, index) => {
      const intermediateValue = intermediateResults[index];
      const stepLabel = step.name
        ? `${step.name} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`
        : `Пункт ${index + 1} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`;
      return {
        label: stepLabel,
        value: `step:${index}`
      };
    });

    const baseCostOptionsList = [{
      label: `Базовая стоимость (${baseCosts[tabKey].toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`,
      value: 'base:-1'
    }];

    const operandOptions = [
      {
        label: 'Наценки',
        options: markupOptionsList
      },
      {
        label: 'Базовая стоимость',
        options: baseCostOptionsList
      },
      ...(stepOptionsList.length > 0 ? [{
        label: 'Пункты',
        options: stepOptionsList
      }] : [])
    ];

    return (
      <div style={{ padding: '8px 0' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          {/* Базовая стоимость */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: '4px' }}>Базовая (прямая) стоимость:</Text>
            <InputNumber
              value={baseCosts[tabKey]}
              onChange={(value) => setBaseCosts(prev => ({ ...prev, [tabKey]: value || 0 }))}
              style={{ width: '300px' }}
              min={0}
              step={0.01}
              precision={2}
              addonAfter="₽"
              placeholder="Введите базовую стоимость"
              formatter={formatNumberWithSpaces}
              parser={parseNumberWithSpaces}
            />
          </div>

          <Divider style={{ margin: '0' }}>Порядок расчета</Divider>

          {/* Список наценок в порядке применения */}
          {sequence.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '16px', color: token.colorTextTertiary }}>
              Наценки не добавлены. Используйте форму ниже для добавления наценок.
            </div>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <div style={{ padding: '12px 16px', background: token.colorFillQuaternary, borderRadius: '4px', fontWeight: 500, fontSize: '15px' }}>
                Базовая стоимость: <Text type="success">{baseCosts[tabKey].toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</Text>
              </div>
              {sequence.map((step, index) => {
                const intermediateResult = intermediateResults[index];

                // Определяем базовую стоимость
                let baseValue: number;
                let baseName: string;
                if (step.baseIndex === -1) {
                  baseValue = baseCosts[tabKey];
                  baseName = 'Базовая';
                } else {
                  baseValue = intermediateResults[step.baseIndex] || baseCosts[tabKey];
                  baseName = `Пункт ${step.baseIndex + 1}`;
                }

                // Получаем первый операнд
                let op1Name: string;
                let op1ValueNum: number;
                if (step.operand1Type === 'markup' && step.operand1Key) {
                  const markup = markupParameters.find(m => m.key === step.operand1Key);
                  op1Name = markup?.label || String(step.operand1Key);
                  op1ValueNum = form.getFieldValue(step.operand1Key) || 0;
                } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
                  if (step.operand1Index === -1) {
                    op1Name = 'Базовая стоимость';
                    op1ValueNum = baseCosts[tabKey];
                  } else {
                    op1Name = `Пункт ${step.operand1Index + 1}`;
                    op1ValueNum = intermediateResults[step.operand1Index] || 0;
                  }
                } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
                  op1Name = String(step.operand1Key);
                  op1ValueNum = step.operand1Key;
                } else {
                  op1Name = '?';
                  op1ValueNum = 0;
                }

                // Формируем формулу первой операции
                const action1Obj = ACTIONS.find(a => a.value === step.action1);
                let formula = `${baseName} ${action1Obj?.symbol} ${op1Name}`;
                if (step.operand1Type === 'markup') {
                  formula += ` (${op1ValueNum}%)`;
                }

                // Добавляем вторую операцию, если есть
                if (step.action2 && step.operand2Type) {
                  let op2Name: string;
                  let op2ValueNum: number;
                  if (step.operand2Type === 'markup' && step.operand2Key) {
                    const markup = markupParameters.find(m => m.key === step.operand2Key);
                    op2Name = markup?.label || String(step.operand2Key);
                    op2ValueNum = form.getFieldValue(step.operand2Key) || 0;
                  } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
                    if (step.operand2Index === -1) {
                      op2Name = 'Базовая стоимость';
                      op2ValueNum = baseCosts[tabKey];
                    } else {
                      op2Name = `Пункт ${step.operand2Index + 1}`;
                      op2ValueNum = intermediateResults[step.operand2Index] || 0;
                    }
                  } else {
                    op2Name = '?';
                    op2ValueNum = 0;
                  }

                  const action2Obj = ACTIONS.find(a => a.value === step.action2);
                  formula += ` ${action2Obj?.symbol} ${op2Name}`;
                  if (step.operand2Type === 'markup') {
                    formula += ` (${op2ValueNum}%)`;
                  }
                }

                // Добавляем третью операцию, если есть
                if (step.action3 && step.operand3Type) {
                  let op3Name: string;
                  let op3ValueNum: number;
                  if (step.operand3Type === 'markup' && step.operand3Key) {
                    const markup = markupParameters.find(m => m.key === step.operand3Key);
                    op3Name = markup?.label || String(step.operand3Key);
                    op3ValueNum = form.getFieldValue(step.operand3Key) || 0;
                  } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
                    if (step.operand3Index === -1) {
                      op3Name = 'Базовая стоимость';
                      op3ValueNum = baseCosts[tabKey];
                    } else {
                      op3Name = `Пункт ${step.operand3Index + 1}`;
                      op3ValueNum = intermediateResults[step.operand3Index] || 0;
                    }
                  } else {
                    op3Name = '?';
                    op3ValueNum = 0;
                  }

                  const action3Obj = ACTIONS.find(a => a.value === step.action3);
                  formula += ` ${action3Obj?.symbol} ${op3Name}`;
                  if (step.operand3Type === 'markup') {
                    formula += ` (${op3ValueNum}%)`;
                  }
                }

                // Добавляем четвертую операцию, если есть
                if (step.action4 && step.operand4Type) {
                  let op4Name: string;
                  let op4ValueNum: number;
                  if (step.operand4Type === 'markup' && step.operand4Key) {
                    const markup = markupParameters.find(m => m.key === step.operand4Key);
                    op4Name = markup?.label || String(step.operand4Key);
                    op4ValueNum = form.getFieldValue(step.operand4Key) || 0;
                  } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
                    if (step.operand4Index === -1) {
                      op4Name = 'Базовая стоимость';
                      op4ValueNum = baseCosts[tabKey];
                    } else {
                      op4Name = `Пункт ${step.operand4Index + 1}`;
                      op4ValueNum = intermediateResults[step.operand4Index] || 0;
                    }
                  } else {
                    op4Name = '?';
                    op4ValueNum = 0;
                  }

                  const action4Obj = ACTIONS.find(a => a.value === step.action4);
                  formula += ` ${action4Obj?.symbol} ${op4Name}`;
                  if (step.operand4Type === 'markup') {
                    formula += ` (${op4ValueNum}%)`;
                  }
                }

                // Добавляем пятую операцию, если есть
                if (step.action5 && step.operand5Type) {
                  let op5Name: string;
                  let op5ValueNum: number;
                  if (step.operand5Type === 'markup' && step.operand5Key) {
                    const markup = markupParameters.find(m => m.key === step.operand5Key);
                    op5Name = markup?.label || String(step.operand5Key);
                    op5ValueNum = form.getFieldValue(step.operand5Key) || 0;
                  } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
                    if (step.operand5Index === -1) {
                      op5Name = 'Базовая стоимость';
                      op5ValueNum = baseCosts[tabKey];
                    } else {
                      op5Name = `Пункт ${step.operand5Index + 1}`;
                      op5ValueNum = intermediateResults[step.operand5Index] || 0;
                    }
                  } else {
                    op5Name = '?';
                    op5ValueNum = 0;
                  }

                  const action5Obj = ACTIONS.find(a => a.value === step.action5);
                  formula += ` ${action5Obj?.symbol} ${op5Name}`;
                  if (step.operand5Type === 'markup') {
                    formula += ` (${op5ValueNum}%)`;
                  }
                }

                // Формируем детальную формулу с числами
                let detailedFormula = '';

                // Первая операция
                if (step.operand1Type === 'markup') {
                  const format1 = step.operand1MultiplyFormat || 'addOne';
                  if (step.action1 === 'multiply') {
                    const multiplier = format1 === 'addOne' ? (1 + (op1ValueNum / 100)) : (op1ValueNum / 100);
                    detailedFormula = `(${baseValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${action1Obj?.symbol} ${Number(multiplier.toFixed(4))})`;
                  } else {
                    const multiplier = 1 + (op1ValueNum / 100);
                    detailedFormula = `(${baseValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${action1Obj?.symbol} ${Number(multiplier.toFixed(4))})`;
                  }
                } else if (step.operand1Type === 'number') {
                  detailedFormula = `(${baseValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${action1Obj?.symbol} ${op1ValueNum})`;
                } else {
                  detailedFormula = `(${baseValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${action1Obj?.symbol} ${op1ValueNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
                }

                // Вторая операция
                if (step.action2 && step.operand2Type) {
                  let op2Name: string;
                  let op2ValueNum: number;
                  if (step.operand2Type === 'markup' && step.operand2Key) {
                    op2ValueNum = form.getFieldValue(step.operand2Key) || 0;
                  } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
                    op2ValueNum = step.operand2Index === -1 ? baseCosts[tabKey] : (intermediateResults[step.operand2Index] || 0);
                  } else {
                    op2ValueNum = 0;
                  }

                  const action2Obj = ACTIONS.find(a => a.value === step.action2);
                  if (step.operand2Type === 'markup') {
                    const format2 = step.operand2MultiplyFormat || 'addOne';
                    if (step.action2 === 'multiply') {
                      const multiplier = format2 === 'addOne' ? (1 + (op2ValueNum / 100)) : (op2ValueNum / 100);
                      detailedFormula += ` ${action2Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    } else {
                      const multiplier = 1 + (op2ValueNum / 100);
                      detailedFormula += ` ${action2Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    }
                  } else {
                    detailedFormula += ` ${action2Obj?.symbol} ${op2ValueNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  }
                }

                // Третья операция
                if (step.action3 && step.operand3Type) {
                  let op3ValueNum: number;
                  if (step.operand3Type === 'markup' && step.operand3Key) {
                    op3ValueNum = form.getFieldValue(step.operand3Key) || 0;
                  } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
                    op3ValueNum = step.operand3Index === -1 ? baseCosts[tabKey] : (intermediateResults[step.operand3Index] || 0);
                  } else {
                    op3ValueNum = 0;
                  }

                  const action3Obj = ACTIONS.find(a => a.value === step.action3);
                  if (step.operand3Type === 'markup') {
                    const format3 = step.operand3MultiplyFormat || 'addOne';
                    if (step.action3 === 'multiply') {
                      const multiplier = format3 === 'addOne' ? (1 + (op3ValueNum / 100)) : (op3ValueNum / 100);
                      detailedFormula += ` ${action3Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    } else {
                      const multiplier = 1 + (op3ValueNum / 100);
                      detailedFormula += ` ${action3Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    }
                  } else {
                    detailedFormula += ` ${action3Obj?.symbol} ${op3ValueNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  }
                }

                // Четвертая операция
                if (step.action4 && step.operand4Type) {
                  let op4ValueNum: number;
                  if (step.operand4Type === 'markup' && step.operand4Key) {
                    op4ValueNum = form.getFieldValue(step.operand4Key) || 0;
                  } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
                    op4ValueNum = step.operand4Index === -1 ? baseCosts[tabKey] : (intermediateResults[step.operand4Index] || 0);
                  } else {
                    op4ValueNum = 0;
                  }

                  const action4Obj = ACTIONS.find(a => a.value === step.action4);
                  if (step.operand4Type === 'markup') {
                    const format4 = step.operand4MultiplyFormat || 'addOne';
                    if (step.action4 === 'multiply') {
                      const multiplier = format4 === 'addOne' ? (1 + (op4ValueNum / 100)) : (op4ValueNum / 100);
                      detailedFormula += ` ${action4Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    } else {
                      const multiplier = 1 + (op4ValueNum / 100);
                      detailedFormula += ` ${action4Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    }
                  } else {
                    detailedFormula += ` ${action4Obj?.symbol} ${op4ValueNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  }
                }

                // Пятая операция
                if (step.action5 && step.operand5Type) {
                  let op5ValueNum: number;
                  if (step.operand5Type === 'markup' && step.operand5Key) {
                    op5ValueNum = form.getFieldValue(step.operand5Key) || 0;
                  } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
                    op5ValueNum = step.operand5Index === -1 ? baseCosts[tabKey] : (intermediateResults[step.operand5Index] || 0);
                  } else {
                    op5ValueNum = 0;
                  }

                  const action5Obj = ACTIONS.find(a => a.value === step.action5);
                  if (step.operand5Type === 'markup') {
                    const format5 = step.operand5MultiplyFormat || 'addOne';
                    if (step.action5 === 'multiply') {
                      const multiplier = format5 === 'addOne' ? (1 + (op5ValueNum / 100)) : (op5ValueNum / 100);
                      detailedFormula += ` ${action5Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    } else {
                      const multiplier = 1 + (op5ValueNum / 100);
                      detailedFormula += ` ${action5Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
                    }
                  } else {
                    detailedFormula += ` ${action5Obj?.symbol} ${op5ValueNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  }
                }

                return (
                  <div
                    key={`${index}`}
                    style={{
                      padding: '8px 12px',
                      background: token.colorBgContainer,
                      border: `1px solid ${token.colorBorder}`,
                      borderRadius: '4px',
                      marginBottom: '4px'
                    }}
                  >
                    <Row gutter={[16, 8]} align="middle">
                      <Col flex="auto">
                        <Space direction="vertical" size={0}>
                          <Space>
                            <Tag color="blue">{index + 1}</Tag>
                            {step.name && <Tag color="green">{step.name}</Tag>}
                            <Text type="secondary" style={{ fontSize: '13px' }}>
                              {formula}
                            </Text>
                            <Text strong style={{ color: token.colorInfo }}>
                              → {intermediateResult.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                            </Text>
                          </Space>
                          <Text type="secondary" style={{ fontSize: '12px', marginLeft: '32px' }}>
                            {detailedFormula}
                          </Text>
                        </Space>
                      </Col>
                      <Col flex="none">
                        <Space>
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => editMarkup(tabKey, index)}
                            title="Редактировать"
                          />
                          <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            onClick={() => moveMarkupUp(tabKey, index)}
                            disabled={index === 0}
                          />
                          <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            onClick={() => moveMarkupDown(tabKey, index)}
                            disabled={index === sequence.length - 1}
                          />
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => removeMarkup(tabKey, index)}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                );
              })}
              <div style={{ padding: '12px 16px', background: token.colorInfoBg, borderRadius: '4px', fontWeight: 500, color: token.colorInfo, fontSize: '15px' }}>
                → Коммерческая стоимость: <Text strong style={{ color: token.colorInfo }}>{finalResult.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</Text>
              </div>
            </Space>
          )}

          <Divider style={{ margin: '8px 0' }}>Добавить наценку</Divider>

          {/* Добавление наценки */}
          <Space direction="vertical" style={{ width: '100%' }} size={24}>
            {/* Поле 1: Название (компактное, выровнено с полем База) */}
            <Row gutter={[8, 0]} align="middle" style={{ marginBottom: 12 }}>
              <Col flex="none" style={{ width: 80 }}>
                <span style={{ fontSize: 13, color: '#888' }}>Название:</span>
              </Col>
              <Col flex="auto" style={{ maxWidth: 320 }}>
                <Input
                  placeholder="Название пункта"
                  value={stepName[tabKey]}
                  onChange={(e) => setStepName(prev => ({ ...prev, [tabKey]: e.target.value }))}
                  allowClear
                  size="small"
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>

            {/* Секция базы */}
            <Row gutter={[8, 0]} align="middle" style={{ marginBottom: 12 }}>
              <Col flex="none" style={{ width: 80 }}>
                <span style={{ fontSize: 13, color: '#888' }}>База:</span>
              </Col>
              <Col flex="auto" style={{ maxWidth: 320 }}>
                <Select
                  placeholder="Выберите базу для расчета"
                  style={{ width: '100%' }}
                  options={baseOptions}
                  onChange={(value) => setInsertPositions(prev => ({ ...prev, [tabKey]: value }))}
                  value={insertPosition}
                  size="middle"
                />
              </Col>
            </Row>

            {/* Секция операций */}
            <div style={{ maxWidth: 460 }}>
              <div style={{
                background: 'rgba(16, 185, 129, 0.05)',
                border: '1px solid rgba(16, 185, 129, 0.15)',
                borderRadius: 6,
                padding: '16px'
              }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#10b981',
                  marginBottom: 16
                }}>
                  Операции
                </div>

                <Space direction="vertical" style={{ width: '100%' }} size={0}>
                {/* Операция 1 (обязательная) */}
                <div style={{ marginBottom: 0 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Radio.Group
                      size="small"
                      value={operand1InputMode[tabKey]}
                      onChange={(e) => {
                        setOperand1InputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                        if (e.target.value === 'manual') {
                          setOperand1Type(prev => ({ ...prev, [tabKey]: 'number' }));
                          setOperand1Value(prev => ({ ...prev, [tabKey]: undefined }));
                        } else {
                          setOperand1Type(prev => ({ ...prev, [tabKey]: 'markup' }));
                          setOperand1Value(prev => ({ ...prev, [tabKey]: undefined }));
                        }
                      }}
                    >
                      <Radio.Button value="select">Выбрать</Radio.Button>
                      <Radio.Button value="manual">Ввести число</Radio.Button>
                    </Radio.Group>
                  </div>

                  <Row gutter={8} align="middle" style={{ marginBottom: 0 }}>
                    <Col flex="120px">
                      <Select
                        placeholder="Действие"
                        style={{ width: '100%' }}
                        options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                        onChange={(value) => setAction1(prev => ({ ...prev, [tabKey]: value }))}
                        value={act1}
                        size="middle"
                      />
                    </Col>
                    <Col flex="auto" style={{ maxWidth: 250 }}>
                      {operand1InputMode[tabKey] === 'select' ? (
                        <Select
                          placeholder="Наценка/Пункт"
                          style={{ width: '100%' }}
                          options={operandOptions}
                          onChange={(value) => {
                            const [type, val] = value.split(':');
                            if (type === 'base') {
                              setOperand1Type(prev => ({ ...prev, [tabKey]: 'step' }));
                              setOperand1Value(prev => ({ ...prev, [tabKey]: -1 }));
                            } else {
                              setOperand1Type(prev => ({ ...prev, [tabKey]: type as 'markup' | 'step' | 'number' }));
                              setOperand1Value(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                            }
                          }}
                          value={op1Value !== undefined && op1Type !== 'number' ? (op1Value === -1 ? 'base:-1' : `${op1Type}:${op1Value}`) : undefined}
                          size="middle"
                        />
                      ) : (
                        <InputNumber
                          placeholder="Введите число"
                          style={{ width: '100%' }}
                          value={typeof op1Value === 'number' ? op1Value : undefined}
                          onChange={(value) => {
                            setOperand1Value(prev => ({ ...prev, [tabKey]: value || 0 }));
                          }}
                          formatter={formatNumberWithSpaces}
                          parser={parseNumberWithSpaces}
                          size="middle"
                        />
                      )}
                    </Col>
                    <Col flex="none">
                      {!showSecondAction[tabKey] && (
                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => setShowSecondAction(prev => ({ ...prev, [tabKey]: true }))}
                          title="Добавить второе действие"
                          size="middle"
                          style={{ minWidth: 32, padding: '4px 8px' }}
                        />
                      )}
                    </Col>
                  </Row>
                </div>
                {act1 === 'multiply' && op1Type === 'markup' && (
                  <Row style={{ marginBottom: showSecondAction[tabKey] ? 12 : 0, marginTop: 8, marginLeft: 128 }}>
                    <Col>
                      <Radio.Group
                        size="small"
                        value={operand1MultiplyFormat[tabKey]}
                        onChange={(e) => setOperand1MultiplyFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
                      >
                        <Radio.Button value="addOne">1 + %</Radio.Button>
                        <Radio.Button value="direct">%</Radio.Button>
                      </Radio.Group>
                    </Col>
                  </Row>
                )}
                {!(act1 === 'multiply' && op1Type === 'markup') && (
                  <div style={{ marginBottom: showSecondAction[tabKey] ? 12 : 0 }} />
                )}

                {/* Операция 2 (опциональная) */}
                {showSecondAction[tabKey] && (
                  <>
                    <div style={{ marginBottom: 0 }}>
                      <div style={{ marginBottom: 8 }}>
                        <Radio.Group
                          size="small"
                          value={operand2InputMode[tabKey]}
                          onChange={(e) => {
                            setOperand2InputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                            if (e.target.value === 'manual') {
                              setOperand2Type(prev => ({ ...prev, [tabKey]: 'number' }));
                              setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
                            } else {
                              setOperand2Type(prev => ({ ...prev, [tabKey]: 'markup' }));
                              setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
                            }
                          }}
                        >
                          <Radio.Button value="select">Выбрать</Radio.Button>
                          <Radio.Button value="manual">Ввести число</Radio.Button>
                        </Radio.Group>
                      </div>

                      <Row gutter={8} align="middle" style={{ marginBottom: 0 }}>
                        <Col flex="120px">
                          <Select
                            placeholder="Действие"
                            style={{ width: '100%' }}
                            options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                            onChange={(value) => setAction2(prev => ({ ...prev, [tabKey]: value }))}
                            value={act2}
                            size="middle"
                          />
                        </Col>
                        <Col flex="auto" style={{ maxWidth: 250 }}>
                          {operand2InputMode[tabKey] === 'select' ? (
                            <Select
                              placeholder="Наценка/Пункт"
                              style={{ width: '100%' }}
                              options={operandOptions}
                              onChange={(value) => {
                                if (value) {
                                  const [type, val] = value.split(':');
                                  if (type === 'base') {
                                    setOperand2Type(prev => ({ ...prev, [tabKey]: 'step' }));
                                    setOperand2Value(prev => ({ ...prev, [tabKey]: -1 }));
                                  } else {
                                    setOperand2Type(prev => ({ ...prev, [tabKey]: type as 'markup' | 'step' | 'number' }));
                                    setOperand2Value(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                                  }
                                } else {
                                  setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
                                }
                              }}
                              value={op2Value !== undefined && op2Type !== 'number' ? (op2Value === -1 ? 'base:-1' : `${op2Type}:${op2Value}`) : undefined}
                              allowClear
                              onClear={() => {
                                setShowSecondAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
                                setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
                              }}
                              size="middle"
                            />
                          ) : (
                            <InputNumber
                              placeholder="Введите число"
                              style={{ width: '100%' }}
                              value={typeof op2Value === 'number' ? op2Value : undefined}
                              onChange={(value) => {
                                setOperand2Value(prev => ({ ...prev, [tabKey]: value || 0 }));
                              }}
                              formatter={formatNumberWithSpaces}
                              parser={parseNumberWithSpaces}
                              size="middle"
                            />
                          )}
                        </Col>
                        <Col flex="none">
                          {!showThirdAction[tabKey] && (
                            <Button
                              icon={<PlusOutlined />}
                              onClick={() => setShowThirdAction(prev => ({ ...prev, [tabKey]: true }))}
                              title="Добавить третье действие"
                              size="middle"
                              style={{ minWidth: 32, padding: '4px 8px' }}
                            />
                          )}
                        </Col>
                      </Row>
                    </div>
                    {act2 === 'multiply' && op2Type === 'markup' && (
                      <Row style={{ marginBottom: showThirdAction[tabKey] ? 12 : 0, marginTop: 8, marginLeft: 128 }}>
                        <Col>
                          <Radio.Group
                            size="small"
                            value={operand2MultiplyFormat[tabKey]}
                            onChange={(e) => setOperand2MultiplyFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
                          >
                            <Radio.Button value="addOne">1 + %</Radio.Button>
                            <Radio.Button value="direct">%</Radio.Button>
                          </Radio.Group>
                        </Col>
                      </Row>
                    )}
                    {!(act2 === 'multiply' && op2Type === 'markup') && (
                      <div style={{ marginBottom: showThirdAction[tabKey] ? 12 : 0 }} />
                    )}
                  </>
                )}

                {/* Операция 3 (опциональная) */}
                {showThirdAction[tabKey] && (
                  <>
                    <div style={{ marginBottom: 0 }}>
                      <div style={{ marginBottom: 8 }}>
                        <Radio.Group
                          size="small"
                          value={operand3InputMode[tabKey]}
                          onChange={(e) => {
                            setOperand3InputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                            if (e.target.value === 'manual') {
                              setOperand3Type(prev => ({ ...prev, [tabKey]: 'number' }));
                              setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
                            } else {
                              setOperand3Type(prev => ({ ...prev, [tabKey]: 'markup' }));
                              setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
                            }
                          }}
                        >
                          <Radio.Button value="select">Выбрать</Radio.Button>
                          <Radio.Button value="manual">Ввести число</Radio.Button>
                        </Radio.Group>
                      </div>

                      <Row gutter={8} align="middle" style={{ marginBottom: 0 }}>
                        <Col flex="120px">
                          <Select
                            placeholder="Действие"
                            style={{ width: '100%' }}
                            options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                            onChange={(value) => setAction3(prev => ({ ...prev, [tabKey]: value }))}
                            value={action3[tabKey]}
                            size="middle"
                          />
                        </Col>
                        <Col flex="auto" style={{ maxWidth: 250 }}>
                          {operand3InputMode[tabKey] === 'select' ? (
                            <Select
                              placeholder="Наценка/Пункт"
                              style={{ width: '100%' }}
                              options={operandOptions}
                              onChange={(value) => {
                                if (value) {
                                  const [type, val] = value.split(':');
                                  if (type === 'base') {
                                    setOperand3Type(prev => ({ ...prev, [tabKey]: 'step' }));
                                    setOperand3Value(prev => ({ ...prev, [tabKey]: -1 }));
                                  } else {
                                    setOperand3Type(prev => ({ ...prev, [tabKey]: type as 'markup' | 'step' | 'number' }));
                                    setOperand3Value(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                                  }
                                } else {
                                  setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
                                }
                              }}
                              value={operand3Value[tabKey] !== undefined && operand3Type[tabKey] !== 'number' ? (operand3Value[tabKey] === -1 ? 'base:-1' : `${operand3Type[tabKey]}:${operand3Value[tabKey]}`) : undefined}
                              allowClear
                              onClear={() => {
                                setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
                                setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
                              }}
                              size="middle"
                            />
                          ) : (
                            <InputNumber
                              placeholder="Введите число"
                              style={{ width: '100%' }}
                              value={typeof operand3Value[tabKey] === 'number' ? operand3Value[tabKey] : undefined}
                              onChange={(value) => {
                                setOperand3Value(prev => ({ ...prev, [tabKey]: value || 0 }));
                              }}
                              formatter={formatNumberWithSpaces}
                              parser={parseNumberWithSpaces}
                              size="middle"
                            />
                          )}
                        </Col>
                        <Col flex="none">
                          {!showFourthAction[tabKey] && (
                            <Button
                              icon={<PlusOutlined />}
                              onClick={() => setShowFourthAction(prev => ({ ...prev, [tabKey]: true }))}
                              title="Добавить четвертое действие"
                              size="middle"
                              style={{ minWidth: 32, padding: '4px 8px' }}
                            />
                          )}
                        </Col>
                      </Row>
                    </div>
                    {action3[tabKey] === 'multiply' && operand3Type[tabKey] === 'markup' && (
                      <Row style={{ marginBottom: showFourthAction[tabKey] ? 12 : 0, marginTop: 8, marginLeft: 128 }}>
                        <Col>
                          <Radio.Group
                            size="small"
                            value={operand3MultiplyFormat[tabKey]}
                            onChange={(e) => setOperand3MultiplyFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
                          >
                            <Radio.Button value="addOne">1 + %</Radio.Button>
                            <Radio.Button value="direct">%</Radio.Button>
                          </Radio.Group>
                        </Col>
                      </Row>
                    )}
                    {!(action3[tabKey] === 'multiply' && operand3Type[tabKey] === 'markup') && (
                      <div style={{ marginBottom: showFourthAction[tabKey] ? 12 : 0 }} />
                    )}
                  </>
                )}

                {/* Операция 4 (опциональная) */}
                {showFourthAction[tabKey] && (
                  <>
                    <div style={{ marginBottom: 0 }}>
                      <div style={{ marginBottom: 8 }}>
                        <Radio.Group
                          size="small"
                          value={operand4InputMode[tabKey]}
                          onChange={(e) => {
                            setOperand4InputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                            if (e.target.value === 'manual') {
                              setOperand4Type(prev => ({ ...prev, [tabKey]: 'number' }));
                              setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
                            } else {
                              setOperand4Type(prev => ({ ...prev, [tabKey]: 'markup' }));
                              setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
                            }
                          }}
                        >
                          <Radio.Button value="select">Выбрать</Radio.Button>
                          <Radio.Button value="manual">Ввести число</Radio.Button>
                        </Radio.Group>
                      </div>

                      <Row gutter={8} align="middle" style={{ marginBottom: 0 }}>
                        <Col flex="120px">
                          <Select
                            placeholder="Действие"
                            style={{ width: '100%' }}
                            options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                            onChange={(value) => setAction4(prev => ({ ...prev, [tabKey]: value }))}
                            value={action4[tabKey]}
                            size="middle"
                          />
                        </Col>
                        <Col flex="auto" style={{ maxWidth: 250 }}>
                          {operand4InputMode[tabKey] === 'select' ? (
                            <Select
                              placeholder="Наценка/Пункт"
                              style={{ width: '100%' }}
                              options={operandOptions}
                              onChange={(value) => {
                                if (value) {
                                  const [type, val] = value.split(':');
                                  if (type === 'base') {
                                    setOperand4Type(prev => ({ ...prev, [tabKey]: 'step' }));
                                    setOperand4Value(prev => ({ ...prev, [tabKey]: -1 }));
                                  } else {
                                    setOperand4Type(prev => ({ ...prev, [tabKey]: type as 'markup' | 'step' | 'number' }));
                                    setOperand4Value(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                                  }
                                } else {
                                  setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
                                }
                              }}
                              value={operand4Value[tabKey] !== undefined && operand4Type[tabKey] !== 'number' ? (operand4Value[tabKey] === -1 ? 'base:-1' : `${operand4Type[tabKey]}:${operand4Value[tabKey]}`) : undefined}
                              allowClear
                              onClear={() => {
                                setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
                                setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
                                setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
                              }}
                              size="middle"
                            />
                          ) : (
                            <InputNumber
                              placeholder="Введите число"
                              style={{ width: '100%' }}
                              value={typeof operand4Value[tabKey] === 'number' ? operand4Value[tabKey] : undefined}
                              onChange={(value) => {
                                setOperand4Value(prev => ({ ...prev, [tabKey]: value || 0 }));
                              }}
                              formatter={formatNumberWithSpaces}
                              parser={parseNumberWithSpaces}
                              size="middle"
                            />
                          )}
                        </Col>
                        <Col flex="none">
                          {!showFifthAction[tabKey] && (
                            <Button
                              icon={<PlusOutlined />}
                              onClick={() => setShowFifthAction(prev => ({ ...prev, [tabKey]: true }))}
                              title="Добавить пятое действие"
                              size="middle"
                              style={{ minWidth: 32, padding: '4px 8px' }}
                            />
                          )}
                        </Col>
                      </Row>
                    </div>
                    {action4[tabKey] === 'multiply' && operand4Type[tabKey] === 'markup' && (
                      <Row style={{ marginBottom: showFifthAction[tabKey] ? 12 : 0, marginTop: 8, marginLeft: 128 }}>
                        <Col>
                          <Radio.Group
                            size="small"
                            value={operand4MultiplyFormat[tabKey]}
                            onChange={(e) => setOperand4MultiplyFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
                          >
                            <Radio.Button value="addOne">1 + %</Radio.Button>
                            <Radio.Button value="direct">%</Radio.Button>
                          </Radio.Group>
                        </Col>
                      </Row>
                    )}
                    {!(action4[tabKey] === 'multiply' && operand4Type[tabKey] === 'markup') && (
                      <div style={{ marginBottom: showFifthAction[tabKey] ? 12 : 0 }} />
                    )}
                  </>
                )}

                {/* Операция 5 (опциональная) */}
                {showFifthAction[tabKey] && (
                  <>
                    <div style={{ marginBottom: 0 }}>
                      <div style={{ marginBottom: 8 }}>
                        <Radio.Group
                          size="small"
                          value={operand5InputMode[tabKey]}
                          onChange={(e) => {
                            setOperand5InputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                            if (e.target.value === 'manual') {
                              setOperand5Type(prev => ({ ...prev, [tabKey]: 'number' }));
                              setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
                            } else {
                              setOperand5Type(prev => ({ ...prev, [tabKey]: 'markup' }));
                              setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
                            }
                          }}
                        >
                          <Radio.Button value="select">Выбрать</Radio.Button>
                          <Radio.Button value="manual">Ввести число</Radio.Button>
                        </Radio.Group>
                      </div>

                      <Row gutter={8} align="middle">
                        <Col flex="120px">
                          <Select
                            placeholder="Действие"
                            style={{ width: '100%' }}
                            options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                            onChange={(value) => setAction5(prev => ({ ...prev, [tabKey]: value }))}
                            value={action5[tabKey]}
                            size="middle"
                          />
                        </Col>
                        <Col flex="auto" style={{ maxWidth: 250 }}>
                          {operand5InputMode[tabKey] === 'select' ? (
                            <Select
                              placeholder="Наценка/Пункт"
                              style={{ width: '100%' }}
                              options={operandOptions}
                              onChange={(value) => {
                                if (value) {
                                  const [type, val] = value.split(':');
                                  if (type === 'base') {
                                    setOperand5Type(prev => ({ ...prev, [tabKey]: 'step' }));
                                    setOperand5Value(prev => ({ ...prev, [tabKey]: -1 }));
                                  } else {
                                    setOperand5Type(prev => ({ ...prev, [tabKey]: type as 'markup' | 'step' | 'number' }));
                                    setOperand5Value(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                                  }
                                } else {
                                  setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
                                }
                              }}
                              value={operand5Value[tabKey] !== undefined && operand5Type[tabKey] !== 'number' ? (operand5Value[tabKey] === -1 ? 'base:-1' : `${operand5Type[tabKey]}:${operand5Value[tabKey]}`) : undefined}
                              allowClear
                              onClear={() => {
                                setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
                                setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
                              }}
                              size="middle"
                            />
                          ) : (
                            <InputNumber
                              placeholder="Введите число"
                              style={{ width: '100%' }}
                              value={typeof operand5Value[tabKey] === 'number' ? operand5Value[tabKey] : undefined}
                              onChange={(value) => {
                                setOperand5Value(prev => ({ ...prev, [tabKey]: value || 0 }));
                              }}
                              formatter={formatNumberWithSpaces}
                              parser={parseNumberWithSpaces}
                              size="middle"
                            />
                          )}
                        </Col>
                      </Row>
                    </div>
                    {action5[tabKey] === 'multiply' && operand5Type[tabKey] === 'markup' && (
                      <Row style={{ marginTop: 8, marginLeft: 128 }}>
                        <Col>
                          <Radio.Group
                            size="small"
                            value={operand5MultiplyFormat[tabKey]}
                            onChange={(e) => setOperand5MultiplyFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
                          >
                            <Radio.Button value="addOne">1 + %</Radio.Button>
                            <Radio.Button value="direct">%</Radio.Button>
                          </Radio.Group>
                        </Col>
                      </Row>
                    )}
                  </>
                )}
              </Space>
              </div>

              {/* Кнопка добавить (под зеленым блоком) */}
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={insertPosition === undefined || op1Value === undefined}
                  onClick={() => addMarkup(tabKey)}
                  size="middle"
                >
                  Добавить
                </Button>
              </div>
            </div>
          </Space>
        </Space>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100%', overflow: 'visible' }} className="markup-constructor">
      <Tabs
        defaultActiveKey="tactics"
        items={[
          {
            key: 'tactics',
            label: 'Порядок применения наценок',
            children: (
              <div style={{ minHeight: '100%', overflow: 'visible' }}>
                {!isTacticSelected ? (
                  // Список схем наценок
                  <div>
                    <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Title level={4} style={{ margin: 0 }}>
                          Схемы наценок
                        </Title>
                        <Text type="secondary" style={{ fontSize: '14px' }}>
                          Выберите схему для редактирования или создайте новую
                        </Text>
                      </div>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          // Создание новой тактики
                          setSelectedTacticId(null);
                          setCurrentTacticId(null);
                          setCurrentTacticName('');
                          setMarkupSequences({
                            works: [],
                            materials: [],
                            subcontract_works: [],
                            subcontract_materials: [],
                            work_comp: [],
                            material_comp: [],
                          });
                          setBaseCosts({
                            works: 0,
                            materials: 0,
                            subcontract_works: 0,
                            subcontract_materials: 0,
                            work_comp: 0,
                            material_comp: 0,
                          });
                          setIsTacticSelected(true);
                          setIsDataLoaded(true);
                          message.info('Создается новая схема наценок');
                        }}
                        size="large"
                      >
                        Создать новую схему
                      </Button>
                    </div>

                    <Input
                      placeholder="Поиск по названию схемы..."
                      value={tacticSearchText}
                      onChange={(e) => setTacticSearchText(e.target.value)}
                      allowClear
                      style={{ marginBottom: 16 }}
                      prefix={<span style={{ color: token.colorTextTertiary }}>🔍</span>}
                    />

                    <Spin spinning={loadingTactics}>
                      <List
                        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }}
                        dataSource={
                          tactics
                            .filter(t =>
                              !tacticSearchText ||
                              t.name?.toLowerCase().includes(tacticSearchText.toLowerCase())
                            )
                            .sort((a, b) => {
                              // Глобальные схемы первыми
                              if (a.is_global && !b.is_global) return -1;
                              if (!a.is_global && b.is_global) return 1;
                              // Затем по алфавиту
                              return (a.name || '').localeCompare(b.name || '');
                            })
                        }
                        locale={{ emptyText: 'Нет доступных схем наценок. Создайте новую схему.' }}
                        renderItem={(tactic) => (
                          <List.Item>
                            <Card
                              hoverable
                              onClick={() => {
                                handleTacticChange(tactic.id);
                                setIsTacticSelected(true);
                              }}
                              style={{
                                height: '100%',
                                cursor: 'pointer',
                                border: tactic.is_global ? `2px solid ${token.colorPrimary}` : undefined
                              }}
                              bodyStyle={{ padding: 16 }}
                            >
                              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <Title level={5} style={{ margin: 0, flex: 1 }}>
                                    {tactic.name || 'Без названия'}
                                  </Title>
                                  {tactic.is_global && (
                                    <Tag color="gold" style={{ margin: 0 }}>глобальная</Tag>
                                  )}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {tactic.created_at ? `Создана: ${dayjs(tactic.created_at).format('DD.MM.YYYY')}` : ''}
                                </Text>
                                {tactic.updated_at && (
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    Обновлена: {dayjs(tactic.updated_at).format('DD.MM.YYYY HH:mm')}
                                  </Text>
                                )}
                              </Space>
                            </Card>
                          </List.Item>
                        )}
                      />
                    </Spin>
                  </div>
                ) : (
                  // Редактор схемы наценок
                  <div>
                    <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, maxWidth: '400px' }}>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Button
                            type="primary"
                            icon={<ArrowLeftOutlined />}
                            onClick={handleBackToList}
                          >
                            К списку схем
                          </Button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                            {isEditingName ? (
                              <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onPressEnter={handleSaveName}
                                style={{ flex: 1 }}
                                suffix={
                                  <Space size={4}>
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CheckOutlined />}
                                      onClick={handleSaveName}
                                      style={{ color: '#52c41a' }}
                                    />
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CloseOutlined />}
                                      onClick={handleCancelEditingName}
                                    />
                                  </Space>
                                }
                              />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Title level={4} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  {currentTacticName || 'Новая схема'}
                                  {currentTacticId && tactics.find(t => t.id === currentTacticId)?.is_global && (
                                    <Tag color="gold" style={{ margin: 0 }}>глобальная</Tag>
                                  )}
                                </Title>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={handleStartEditingName}
                                />
                              </div>
                            )}
                          </div>
                          <Text type="secondary" style={{ fontSize: '14px' }}>
                            Настройте последовательность расчета для каждого типа позиций
                          </Text>
                        </Space>
                      </div>
                      <Space>
                        {currentTacticId && (
                          <Button
                            icon={<CopyOutlined />}
                            onClick={handleCopyTactic}
                          >
                            Сделать копию
                          </Button>
                        )}
                        {currentTacticId && !tactics.find(t => t.id === currentTacticId)?.is_global && (
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleDeleteTactic}
                          >
                            Удалить
                          </Button>
                        )}
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={handleSaveTactic}
                        >
                          Сохранить
                        </Button>
                      </Space>
                    </div>

                    {/* Панель с базовыми процентами наценок */}
                    {markupParameters.length > 0 && (
                      <Card
                        size="small"
                        title={<Text strong>Базовые проценты наценок</Text>}
                        style={{ marginBottom: 16 }}
                      >
                        <Space wrap size="small">
                          {markupParameters.map((param, index) => (
                            <Tag key={param.id} color="blue">
                              {index + 1}. {param.label}: <Text strong>{param.default_value || 0}%</Text>
                            </Tag>
                          ))}
                        </Space>
                      </Card>
                    )}

                    <Tabs
                      activeKey={activeTab}
                      onChange={(key) => setActiveTab(key as TabKey)}
                      style={{ overflow: 'visible', marginTop: '-8px' }}
                      items={[
                        {
                          key: 'works',
                          label: 'Работы',
                          children: renderMarkupSequenceTab('works'),
                        },
                        {
                          key: 'materials',
                          label: 'Материалы',
                          children: renderMarkupSequenceTab('materials'),
                        },
                        {
                          key: 'subcontract_works',
                          label: 'Субподрядные работы',
                          children: renderMarkupSequenceTab('subcontract_works'),
                        },
                        {
                          key: 'subcontract_materials',
                          label: 'Субподрядные материалы',
                          children: renderMarkupSequenceTab('subcontract_materials'),
                        },
                        {
                          key: 'work_comp',
                          label: 'Раб-комп',
                          children: renderMarkupSequenceTab('work_comp'),
                        },
                        {
                          key: 'material_comp',
                          label: 'Мат-комп',
                          children: renderMarkupSequenceTab('material_comp'),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'base_percentages',
            label: 'Базовые проценты',
            children: (
              <Card
                title={
                  <Space direction="vertical" size={0}>
                    <Title level={4} style={{ margin: 0 }}>
                      Базовые проценты наценок
                    </Title>
                    <Text type="secondary" style={{ fontSize: '14px' }}>
                      Задайте базовые значения процентов по умолчанию
                    </Text>
                  </Space>
                }
                extra={
                  <Space>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleResetBasePercentages}
                    >
                      Сбросить
                    </Button>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={handleSaveBasePercentages}
                      loading={savingBasePercentages}
                    >
                      Сохранить
                    </Button>
                  </Space>
                }
              >
                <Spin spinning={loadingParameters}>
                  {loadingParameters ? (
                    <div style={{ textAlign: 'center', padding: '48px 0' }}>
                      <Text>Загрузка параметров наценок...</Text>
                    </div>
                  ) : markupParameters.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 0' }}>
                      <Text type="danger">Параметры наценок не найдены. Проверьте базу данных.</Text>
                    </div>
                  ) : (
                    <Form
                      form={basePercentagesForm}
                      layout="horizontal"
                      labelCol={{ style: { width: '250px', textAlign: 'left' } }}
                      wrapperCol={{ style: { flex: 1 } }}
                    >
                      <Row gutter={[16, 0]}>
                        {markupParameters.map((param, index) => (
                          <Col span={24} key={param.id}>
                            <Form.Item
                              label={`${index + 1}. ${param.label}`}
                              name={param.key}
                              style={{ marginBottom: '4px' }}
                            >
                              <InputNumber
                                min={0}
                                max={999.99}
                                step={0.01}
                                addonAfter="%"
                                style={{ width: '120px' }}
                                precision={2}
                              />
                            </Form.Item>
                          </Col>
                        ))}
                      </Row>
                    </Form>
                  )}
                </Spin>
              </Card>
            ),
          },
          {
            key: 'parameters',
            label: 'Управление параметрами',
            children: (
              <Card
                title={
                  <Space direction="vertical" size={0}>
                    <Title level={4} style={{ margin: 0 }}>
                      Управление параметрами наценок
                    </Title>
                    <Text type="secondary" style={{ fontSize: '14px' }}>
                      Добавление новых параметров наценок в систему
                    </Text>
                  </Space>
                }
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleOpenParameterModal}
                  >
                    Добавить параметр
                  </Button>
                }
              >
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <div>
                    <Text>
                      Здесь вы можете управлять параметрами наценок: добавлять новые, редактировать существующие, изменять порядок отображения или удалять ненужные.
                      Изменения вступают в силу немедленно и отображаются во всех формах автоматически.
                    </Text>
                  </div>

                  <Divider />

                  <div>
                    <Title level={5}>Текущие параметры наценок ({markupParameters.length})</Title>
                    <List
                      size="small"
                      dataSource={markupParameters}
                      locale={{ emptyText: 'Нет параметров. Нажмите "Добавить параметр" для создания нового.' }}
                      renderItem={(markup, index) => (
                        <List.Item
                          style={{
                            padding: '8px 16px',
                            backgroundColor: editingParameterId === markup.id ? '#f0f5ff' : undefined,
                            borderTop: index === 0 ? '1px solid #f0f0f0' : 'none',
                            borderBottom: '1px solid #f0f0f0',
                          }}
                          actions={[
                            <Button
                              key="up"
                              icon={<ArrowUpOutlined />}
                              size="small"
                              type="text"
                              disabled={index === 0}
                              onClick={() => handleMoveParameterUp(markup)}
                              title="Переместить вверх"
                            />,
                            <Button
                              key="down"
                              icon={<ArrowDownOutlined />}
                              size="small"
                              type="text"
                              disabled={index === markupParameters.length - 1}
                              onClick={() => handleMoveParameterDown(markup)}
                              title="Переместить вниз"
                            />,
                            <Button
                              key="delete"
                              icon={<DeleteOutlined />}
                              size="small"
                              type="text"
                              danger
                              onClick={() => handleDeleteParameter(markup)}
                              title="Удалить"
                            />,
                          ]}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                            <Tag color="blue" style={{ margin: 0 }}>#{index + 1}</Tag>
                            {editingParameterId === markup.id ? (
                              <Input
                                value={editingParameterLabel}
                                onChange={(e) => setEditingParameterLabel(e.target.value)}
                                onPressEnter={() => handleInlineSave(markup.id)}
                                onBlur={() => handleInlineCancel()}
                                autoFocus
                                style={{ flex: 1, maxWidth: '400px' }}
                                suffix={
                                  <Space size={4}>
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<SaveOutlined />}
                                      onClick={() => handleInlineSave(markup.id)}
                                      style={{ color: '#52c41a' }}
                                    />
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CloseOutlined />}
                                      onClick={() => handleInlineCancel()}
                                    />
                                  </Space>
                                }
                              />
                            ) : (
                              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Text
                                  strong
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => handleInlineEdit(markup)}
                                  title="Нажмите для редактирования"
                                >
                                  {markup.label}
                                </Text>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => handleInlineEdit(markup)}
                                  title="Редактировать"
                                  style={{ padding: '0 4px' }}
                                />
                              </div>
                            )}
                            <Text type="secondary" code style={{ fontSize: '12px' }}>{markup.key}</Text>
                          </div>
                        </List.Item>
                      )}
                    />
                  </div>
                </Space>
              </Card>
            ),
          },
          {
            key: 'pricing',
            label: 'Ценообразование',
            children: (
              <div style={{ padding: '24px 0' }}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <div>
                    <Title level={4} style={{ marginBottom: 8 }}>
                      Распределение затрат между материалами и работами (КП)
                    </Title>
                    <Text type="secondary">
                      Настройте, как базовые затраты и наценки распределяются между материалами и работами (КП) для выбранного тендера
                    </Text>
                  </div>

                  <Divider style={{ margin: '8px 0' }} />

                  {/* Селектор тендера и версии */}
                  <div style={{ marginBottom: 24 }}>
                    <Space direction="horizontal" size="large" style={{ width: '100%', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Выберите тендер:</Text>
                        <Select
                          showSearch
                          placeholder="Выберите тендер для настройки"
                          style={{ width: '100%', minWidth: '400px' }}
                          value={selectedTenderId}
                          onChange={handleTenderChange}
                          optionFilterProp="children"
                          filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                          }
                          options={tenders.map((tender) => ({
                            value: tender.id,
                            label: `${tender.tender_number} - ${tender.title}`,
                          }))}
                        />
                      </div>
                      {selectedTenderId && (
                        <div>
                          <Text strong style={{ display: 'block', marginBottom: 8 }}>Версия:</Text>
                          <Select
                            placeholder="Версия тендера"
                            style={{ width: '120px' }}
                            value={tenders.find(t => t.id === selectedTenderId)?.version || 1}
                            disabled
                            options={[
                              {
                                value: tenders.find(t => t.id === selectedTenderId)?.version || 1,
                                label: `v${tenders.find(t => t.id === selectedTenderId)?.version || 1}`,
                              },
                            ]}
                          />
                        </div>
                      )}
                    </Space>
                  </div>

                  {!selectedTenderId ? (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                      <Text type="secondary">Выберите тендер для настройки распределения затрат</Text>
                    </div>
                  ) : (
                    <Spin spinning={loadingPricing}>
                      <Table
                        dataSource={[
                          {
                            key: 'basic_material',
                            type: 'Основные материалы',
                            description: 'Материалы типа "мат"',
                            tags: [{ label: 'мат', color: 'blue' }, { label: 'основн.', color: 'orange' }],
                            baseTarget: pricingDistribution?.basic_material_base_target || 'material',
                            markupTarget: pricingDistribution?.basic_material_markup_target || 'work',
                          },
                          {
                            key: 'auxiliary_material',
                            type: 'Вспомогательные материалы',
                            description: 'Вспомогательные материалы',
                            tags: [{ label: 'мат', color: 'blue' }, { label: 'вспом', color: 'blue' }],
                            baseTarget: pricingDistribution?.auxiliary_material_base_target || 'work',
                            markupTarget: pricingDistribution?.auxiliary_material_markup_target || 'work',
                          },
                          {
                            key: 'subcontract_basic_material',
                            type: 'Субподрядные материалы (основные)',
                            description: 'Основные субподрядные материалы типа "суб-мат"',
                            tags: [{ label: 'суб-мат', color: 'cyan' }, { label: 'основн.', color: 'orange' }],
                            baseTarget: pricingDistribution?.subcontract_basic_material_base_target || 'work',
                            markupTarget: pricingDistribution?.subcontract_basic_material_markup_target || 'work',
                          },
                          {
                            key: 'subcontract_auxiliary_material',
                            type: 'Субподрядные материалы (вспомогательные)',
                            description: 'Вспомогательные субподрядные материалы типа "суб-мат"',
                            tags: [{ label: 'суб-мат', color: 'cyan' }, { label: 'вспом', color: 'blue' }],
                            baseTarget: pricingDistribution?.subcontract_auxiliary_material_base_target || 'work',
                            markupTarget: pricingDistribution?.subcontract_auxiliary_material_markup_target || 'work',
                          },
                          {
                            key: 'work',
                            type: 'Работы',
                            description: 'Работы типа "раб" и "суб-раб"',
                            tags: [{ label: 'раб', color: 'orange' }, { label: 'суб-раб', color: 'purple' }],
                            baseTarget: pricingDistribution?.work_base_target || 'work',
                            markupTarget: pricingDistribution?.work_markup_target || 'work',
                          },
                          {
                            key: 'component_material',
                            type: 'Материалы компании',
                            description: 'Компонентные материалы типа "мат-комп."',
                            tags: [{ label: 'мат-комп.', color: 'cyan' }, { label: 'основн.', color: 'orange' }],
                            baseTarget: pricingDistribution?.component_material_base_target || 'work',
                            markupTarget: pricingDistribution?.component_material_markup_target || 'work',
                          },
                          {
                            key: 'component_work',
                            type: 'Работы компании',
                            description: 'Компонентные работы типа "раб-комп."',
                            tags: [{ label: 'раб-комп.', color: 'magenta' }],
                            baseTarget: pricingDistribution?.component_work_base_target || 'work',
                            markupTarget: pricingDistribution?.component_work_markup_target || 'work',
                          },
                        ]}
                        columns={[
                          {
                            title: 'Тип элемента',
                            dataIndex: 'type',
                            width: 300,
                            render: (text, record) => (
                              <Space direction="vertical" size={4}>
                                <Space size={8}>
                                  <Text strong>{text}</Text>
                                  {record.tags && record.tags.map((tag: { label: string; color: string }) => (
                                    <Tag key={tag.label} color={tag.color} style={{ fontSize: '11px' }}>
                                      {tag.label}
                                    </Tag>
                                  ))}
                                </Space>
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                  {record.description}
                                </Text>
                              </Space>
                            ),
                          },
                          {
                            title: 'Базовая стоимость',
                            dataIndex: 'baseTarget',
                            width: 200,
                            render: (value: DistributionTarget, record) => (
                              <Select
                                value={value}
                                style={{ width: '100%' }}
                                onChange={(newValue: DistributionTarget) =>
                                  handleDistributionChange(record.key, 'base', newValue)
                                }
                                options={[
                                  { label: 'Материалы КП', value: 'material' },
                                  { label: 'Работы КП', value: 'work' },
                                ]}
                              />
                            ),
                          },
                          {
                            title: 'Наценка',
                            dataIndex: 'markupTarget',
                            width: 200,
                            render: (value: DistributionTarget, record) => (
                              <Select
                                value={value}
                                style={{ width: '100%' }}
                                onChange={(newValue: DistributionTarget) =>
                                  handleDistributionChange(record.key, 'markup', newValue)
                                }
                                options={[
                                  { label: 'Материалы КП', value: 'material' },
                                  { label: 'Работы КП', value: 'work' },
                                ]}
                              />
                            ),
                          },
                          {
                            title: 'Результат',
                            key: 'result',
                            render: (_, record) => {
                              const baseLabel =
                                record.baseTarget === 'material' ? 'Материалы КП' : 'Работы КП';
                              const markupLabel =
                                record.markupTarget === 'material' ? 'Материалы КП' : 'Работы КП';

                              if (baseLabel === markupLabel) {
                                return (
                                  <Tag color="blue">
                                    Всё → {baseLabel}
                                  </Tag>
                                );
                              }

                              return (
                                <Space direction="vertical" size={0}>
                                  <Tag color="green">База → {baseLabel}</Tag>
                                  <Tag color="orange">Наценка → {markupLabel}</Tag>
                                </Space>
                              );
                            },
                          },
                        ]}
                        pagination={false}
                        size="small"
                      />

                      <Divider style={{ margin: '16px 0' }} />

                      <Space>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={handleSavePricingDistribution}
                          loading={savingPricing}
                        >
                          Сохранить настройки
                        </Button>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={handleResetPricingToDefaults}
                        >
                          Сбросить к значениям по умолчанию
                        </Button>
                      </Space>
                    </Spin>
                  )}
                </Space>
              </div>
            ),
          },
        ]}
      />

      {/* Модальное окно для добавления нового параметра */}
      <Modal
        title="Добавление нового параметра наценки"
        open={isAddParameterModalOpen}
        onCancel={handleCloseParameterModal}
        footer={null}
        width={800}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form
            form={newParameterForm}
            layout="vertical"
          >
            <Form.Item
              label="Ключ параметра"
              name="parameterKey"
              rules={[
                { required: true, message: 'Введите ключ параметра' },
                {
                  pattern: /^[a-z0-9_]+$/,
                  message: 'Ключ должен содержать только строчные латинские буквы, цифры и подчеркивания (snake_case)'
                }
              ]}
              extra="Например: new_markup_parameter или works_16_markup"
            >
              <Input placeholder="new_markup_parameter" />
            </Form.Item>

            <Form.Item
              label="Название параметра (на русском)"
              name="parameterLabel"
              rules={[{ required: true, message: 'Введите название параметра' }]}
              extra="Например: Новая наценка"
            >
              <Input placeholder="Новая наценка" />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAddParameter}
                >
                  Добавить
                </Button>
                <Button onClick={handleCloseParameterModal}>
                  Отмена
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  );
};

export default MarkupConstructor;
