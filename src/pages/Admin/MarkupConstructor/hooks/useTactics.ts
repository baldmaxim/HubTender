import { useState, useEffect } from 'react';
import { message } from 'antd';
import type { FormInstance } from 'antd';
import type { Tender, MarkupParameter, MarkupTactic, MarkupStep } from '../../../../lib/types';
import { fetchTenders as apiFetchTenders } from '../../../../lib/api/tenders';
import {
  listMarkupTactics,
  getMarkupTactic,
  findGlobalMarkupTacticByName,
  createMarkupTactic,
  updateMarkupTactic,
  renameMarkupTactic,
  deleteMarkupTactic,
  getTenderMarkupTacticId,
  setTenderMarkupTacticId,
  listTenderMarkupPercentages,
} from '../../../../lib/api/markup';
import type { TabKey } from '../types';
import { INITIAL_MARKUP_SEQUENCES, INITIAL_BASE_COSTS } from '../constants';
import { convertSequencesFromDb, convertBaseCostsFromDb, convertSequencesToDb, convertBaseCostsToDb } from '../utils/keyMapping';

// Тактики наценок: загрузка/выбор/сохранение/копирование/переименование +
// localStorage-автосейв. isDataLoaded живёт здесь же, рядом с
// markupSequences/baseCosts — иначе гонка загрузки сотрёт сохранённое.
// Confirm-диалоги удаления/копирования — в components/TacticEditor;
// хук отдаёт performDeleteTactic/performCopyTactic.
export const useTactics = ({
  form,
  markupParameters,
  selectedTenderId,
  setSelectedTenderId,
  setSelectedTacticId,
  fetchPricingDistribution,
}: {
  form: FormInstance;
  markupParameters: MarkupParameter[];
  selectedTenderId: string | null;
  setSelectedTenderId: (id: string | null) => void;
  setSelectedTacticId: (id: string | null) => void;
  fetchPricingDistribution: (tenderId: string) => Promise<void>;
}) => {
  const [, setLoading] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tactics, setTactics] = useState<MarkupTactic[]>([]); // Список доступных тактик
  const [, setCurrentMarkupId] = useState<string | null>(null);
  const [currentTacticId, setCurrentTacticId] = useState<string | null>(null); // ID сохраненной тактики в БД
  const [currentTacticName, setCurrentTacticName] = useState<string>(''); // Название текущей тактики
  const [isDataLoaded, setIsDataLoaded] = useState(false); // Флаг для предотвращения автосохранения до загрузки
  const [isTacticSelected, setIsTacticSelected] = useState(false); // Флаг выбора схемы
  const [loadingTactics, setLoadingTactics] = useState(false); // Загрузка списка тактик
  const [isEditingName, setIsEditingName] = useState(false); // Флаг редактирования названия
  const [editingName, setEditingName] = useState(''); // Редактируемое название
  const [tacticSearchText, setTacticSearchText] = useState(''); // Поисковый запрос для схем

  // Состояния для порядка наценок на каждой вкладке
  const [markupSequences, setMarkupSequences] = useState<Record<TabKey, MarkupStep[]>>({ ...INITIAL_MARKUP_SEQUENCES });

  // Базовая стоимость для каждой вкладки
  const [baseCosts, setBaseCosts] = useState<Record<TabKey, number>>({ ...INITIAL_BASE_COSTS });

  // Загрузка существующей тактики из Supabase
  const fetchTacticFromSupabase = async (tenderId?: string) => {
    try {
      let tacticId: string | null = null;

      if (tenderId) {
        try {
          tacticId = await getTenderMarkupTacticId(tenderId);
        } catch (error) {
          console.error('Ошибка загрузки тендера:', error);
        }
      }

      if (!tacticId) {
        try {
          const globalTactic = await findGlobalMarkupTacticByName('Текущая тактика');
          tacticId = globalTactic?.id || null;
        } catch (error) {
          console.error('Ошибка загрузки глобальной тактики:', error);
          return null;
        }
      }

      if (!tacticId) {
        console.warn('Не найдена тактика для загрузки');
        return null;
      }

      let data: MarkupTactic | null;
      try {
        data = await getMarkupTactic(tacticId);
      } catch (error) {
        console.error('Ошибка загрузки тактики из Supabase:', error);
        return null;
      }

      if (data) {
        console.log('Загружена тактика из Supabase:', data);
        setCurrentTacticId(data.id);
        setCurrentTacticName(data.name || 'Текущая тактика');

        // Преобразование из русского формата в английский
        return {
          sequences: convertSequencesFromDb(data.sequences),
          baseCosts: convertBaseCostsFromDb(data.base_costs),
          tacticId: data.id,
        };
      }

      return null;
    } catch (error) {
      console.error('Ошибка при загрузке тактики:', error);
      return null;
    }
  };

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
      const data = await apiFetchTenders();
      setTenders(data);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const fetchTactics = async () => {
    setLoadingTactics(true);
    try {
      const data = await listMarkupTactics();
      setTactics(data);
    } catch (error) {
      console.error('Ошибка загрузки тактик:', error);
      message.error('Не удалось загрузить список тактик');
    } finally {
      setLoadingTactics(false);
    }
  };

  const fetchMarkupData = async (tenderId: string) => {
    setLoading(true);
    try {
      const data = await listTenderMarkupPercentages(tenderId);

      const markupValues: Record<string, number> = {};
      markupParameters.forEach((param) => {
        markupValues[param.key] = param.default_value || 0;
      });

      if (data.length > 0) {
        data.forEach((record) => {
          if (record.markup_parameter) {
            markupValues[record.markup_parameter.key] = record.value || 0;
          }
        });
        setCurrentMarkupId(tenderId);
      } else {
        setCurrentMarkupId(null);
      }

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

    try {
      const data = await getMarkupTactic(tacticId);

      if (data) {
        setCurrentTacticId(data.id);
        setCurrentTacticName(data.name || 'Без названия');

        // Преобразование из русского формата в английский
        setMarkupSequences(convertSequencesFromDb(data.sequences));
        setBaseCosts(convertBaseCostsFromDb(data.base_costs));
        setIsTacticSelected(true); // Показываем страницу
        setIsDataLoaded(true); // Разрешаем автосохранение
      }
    } catch (error) {
      console.error('Ошибка загрузки тактики:', error);
      message.error('Не удалось загрузить тактику');
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

  // Создание новой тактики (кнопка «Создать новую схему»)
  const handleCreateNewTactic = () => {
    setSelectedTacticId(null);
    setCurrentTacticId(null);
    setCurrentTacticName('');
    setMarkupSequences({ ...INITIAL_MARKUP_SEQUENCES });
    setBaseCosts({ ...INITIAL_BASE_COSTS });
    setIsTacticSelected(true);
    setIsDataLoaded(true);
    message.info('Создается новая схема наценок');
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
        await renameMarkupTactic(currentTacticId, editingName);

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

  // Сохранение тактики наценок
  const handleSaveTactic = async () => {
    try {
      console.log('Сохранение тактики:', { markupSequences, baseCosts });

      // Сохранение в localStorage
      localStorage.setItem('markupSequences', JSON.stringify(markupSequences));
      localStorage.setItem('markupBaseCosts', JSON.stringify(baseCosts));
      localStorage.setItem('markupSequencesVersion', 'v2');

      // Преобразование из английского формата в русский для Supabase
      const sequencesRu = convertSequencesToDb(markupSequences) as unknown as Record<string, unknown>;
      const baseCostsRu = convertBaseCostsToDb(baseCosts) as unknown as Record<string, number>;

      if (currentTacticId) {
        try {
          const data = await updateMarkupTactic(currentTacticId, {
            name: currentTacticName || 'Без названия',
            sequences: sequencesRu,
            base_costs: baseCostsRu,
          });
          console.log('Порядок расчета обновлен в Supabase:', data);

          if (selectedTenderId) {
            try {
              await setTenderMarkupTacticId(selectedTenderId, currentTacticId);
            } catch (tenderError) {
              console.error('Ошибка обновления тендера:', tenderError);
            }
          }

          await fetchTactics();
          message.success('Порядок расчета успешно обновлен');
        } catch (error) {
          console.error('Ошибка обновления в Supabase:', error);
          message.warning('Порядок расчета сохранен локально, но не удалось обновить в базе данных');
        }
      } else {
        try {
          const data = await createMarkupTactic({
            name: currentTacticName || 'Новый порядок расчета',
            sequences: sequencesRu,
            base_costs: baseCostsRu,
            is_global: false,
          });
          console.log('Порядок расчета сохранен в Supabase:', data);
          setCurrentTacticId(data.id);
          setSelectedTacticId(data.id);

          if (selectedTenderId) {
            try {
              await setTenderMarkupTacticId(selectedTenderId, data.id);
            } catch (tenderError) {
              console.error('Ошибка обновления тендера:', tenderError);
            }
          }

          await fetchTactics();
          message.success('Порядок расчета успешно создан');
        } catch (error) {
          console.error('Ошибка сохранения в Supabase:', error);
          message.warning('Порядок расчета сохранен локально, но не удалось сохранить в базу данных');
        }
      }
    } catch (error) {
      console.error('Ошибка сохранения порядка расчета:', error);
      message.error('Не удалось сохранить порядок расчета');
    }
  };

  // Тело удаления порядка расчета (confirm-диалог — в TacticEditor)
  const performDeleteTactic = async (tacticName: string) => {
    if (!currentTacticId) return;
    try {
      await deleteMarkupTactic(currentTacticId);

      message.success(`Порядок расчета "${tacticName}" удален`);

      // Очищаем форму и состояние
      setSelectedTacticId(null);
      setCurrentTacticId(null);
      setCurrentTacticName('');
      setMarkupSequences({ ...INITIAL_MARKUP_SEQUENCES });
      setBaseCosts({ ...INITIAL_BASE_COSTS });

      // Обновляем список тактик
      await fetchTactics();

      // Возвращаемся к списку схем
      setIsTacticSelected(false);
    } catch (error) {
      console.error('Ошибка удаления порядка расчета:', error);
      message.error('Не удалось удалить порядок расчета');
    }
  };

  // Тело копирования схемы (confirm-диалог с полем имени — в TacticEditor)
  const performCopyTactic = async (newName: string) => {
    if (!currentTacticId) return;
    try {
      message.loading('Создание копии...', 0);

      let tacticToCopy: MarkupTactic | null;
      try {
        tacticToCopy = await getMarkupTactic(currentTacticId);
      } catch {
        tacticToCopy = null;
      }

      if (!tacticToCopy) {
        message.destroy();
        message.error('Схема не найдена');
        return;
      }

      // Подготавливаем данные для копирования
      // Используем текущие данные из состояния или данные из БД
      let sequencesToCopy: Record<string, MarkupStep[]> | MarkupTactic['sequences'];
      let baseCostsToCopy: Record<string, number> | MarkupTactic['base_costs'];

      if (currentTacticId && isDataLoaded) {
        // Если схема активна и загружена, используем текущие данные из состояния
        // Преобразуем в русский формат для БД
        sequencesToCopy = convertSequencesToDb(markupSequences);
        baseCostsToCopy = convertBaseCostsToDb(baseCosts);
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

      const newTactic = await createMarkupTactic({
        name: newName.trim(),
        is_global: false,
        sequences: sequencesToCopy as unknown as Record<string, unknown>,
        base_costs: baseCostsToCopy as unknown as Record<string, number>,
      });

      message.destroy();

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
      throw error;
    }
  };

  return {
    tenders,
    tactics,
    loadingTactics,
    currentTacticId,
    currentTacticName,
    isDataLoaded,
    isTacticSelected,
    setIsTacticSelected,
    isEditingName,
    editingName,
    setEditingName,
    tacticSearchText,
    setTacticSearchText,
    markupSequences,
    setMarkupSequences,
    baseCosts,
    setBaseCosts,
    fetchTenders,
    fetchTactics,
    handleTenderChange,
    handleTacticChange,
    handleBackToList,
    handleCreateNewTactic,
    handleStartEditingName,
    handleSaveName,
    handleCancelEditingName,
    handleSaveTactic,
    performDeleteTactic,
    performCopyTactic,
  };
};
