import { useState } from 'react';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { getErrorMessage } from '../../../../utils/errors';
import {
  listWorkNames,
  listWorkNamesByUnit,
  createWorkName,
  updateWorkName,
  deleteWorkName,
  deleteWorkNamesIn,
  remapBoqWorkName,
  remapWorksLibraryWorkName,
  unitExists,
} from '../../../../lib/api/nomenclatures';

const { confirm } = Modal;

// Очистка имени для сравнения (убираем все лишние пробелы)
const cleanName = (name: string): string => {
  return name
    .replace(/\s+/g, ' ')  // Схлопнуть все whitespace символы в один пробел
    .trim()                // Убрать пробелы с краев
    .replace(/[.,;:!?]+$/, ''); // Убрать trailing пунктуацию
};

// Унификация наименования для сравнения дубликатов
const normalizeName = (name: string): string => {
  return cleanName(name).toLowerCase();
};

export interface WorkRecord {
  key: string;
  id: string;
  name: string;
  unit: string;
  created_at: string;
}

export const useWorks = () => {
  const [worksData, setWorksData] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  const loadWorks = async () => {
    setLoading(true);
    try {
      const data = await listWorkNames();
      const formattedData: WorkRecord[] = data.map((item) => ({
        key: item.id,
        id: item.id,
        name: item.name,
        unit: item.unit,
        created_at: new Date(item.created_at).toLocaleDateString('ru-RU'),
      }));

      console.log(`[Nomenclatures/Works] Loaded ${formattedData.length} works`);
      setWorksData(formattedData);
    } catch (error) {
      console.error('Ошибка загрузки работ:', error);
      message.error('Ошибка загрузки работ');
    } finally {
      setLoading(false);
    }
  };

  const saveWork = async (values: { name: string; unit: string }, editingWorkId?: string) => {
    try {
      if (editingWorkId) {
        const exists = await unitExists(values.unit);
        if (!exists) {
          message.error(`Единица измерения "${values.unit}" не существует в справочнике`);
          return false;
        }

        await updateWorkName(editingWorkId, values);
        message.success('Работа обновлена');
      } else {
        const normalizedInputName = normalizeName(values.name);
        const existingWorks = await listWorkNamesByUnit(values.unit);
        const duplicate = existingWorks.find(
          (work) => normalizeName(work.name) === normalizedInputName
        );

        if (duplicate) {
          message.warning(`Работа "${duplicate.name}" с единицей "${duplicate.unit}" уже существует`);
          return false;
        }

        await createWorkName(values);
        message.success('Работа добавлена');
      }

      await loadWorks();
      return true;
    } catch (error) {
      console.error('Ошибка сохранения работы:', error);
      message.error(getErrorMessage(error) || 'Ошибка сохранения работы');
      return false;
    }
  };

  const deleteWork = (record: WorkRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    confirm({
      title: 'Подтверждение удаления',
      icon: <ExclamationCircleOutlined />,
      content: `Вы уверены, что хотите удалить работу "${record.name}"?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          await deleteWorkName(record.id);
          message.success('Работа удалена');
          await loadWorks();
        } catch (error) {
          console.error('Ошибка удаления работы:', error);
          message.error(getErrorMessage(error) || 'Ошибка удаления работы');
        }
      },
    });
  };

  // Поиск дублей по нормализованному имени + единице
  const findDuplicates = (): Set<string> => {
    const seen = new Map<string, number>();
    const duplicateKeys = new Set<string>();

    worksData.forEach((work) => {
      const key = `${normalizeName(work.name)}|${work.unit}`;
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);

      if (count > 0) {
        duplicateKeys.add(key);
      }
    });

    return duplicateKeys;
  };

  // Строит список пар {duplicateId, keeperId} для перепривязки
  const buildRemapPairs = (): Array<{ duplicateId: string; keeperId: string }> => {
    const groups = new Map<string, WorkRecord[]>();
    for (const work of worksData) {
      const key = `${normalizeName(work.name)}|${work.unit}`;
      const group = groups.get(key);
      if (group) {
        group.push(work);
      } else {
        groups.set(key, [work]);
      }
    }
    const pairs: Array<{ duplicateId: string; keeperId: string }> = [];
    for (const group of groups.values()) {
      if (group.length > 1) {
        const keeperId = group[0].id;
        for (const duplicate of group.slice(1)) {
          pairs.push({ duplicateId: duplicate.id, keeperId });
        }
      }
    }
    return pairs;
  };

  const deleteAllDuplicates = () => {
    const remapPairs = buildRemapPairs();
    if (remapPairs.length === 0) {
      message.info('Дублей не найдено');
      return;
    }
    const theme = localStorage.getItem('tenderHub_theme') || 'light';
    confirm({
      title: 'Удаление дублей',
      icon: <ExclamationCircleOutlined />,
      content: `Будет удалено ${remapPairs.length} дублирующих записей работ. Связанные позиции BOQ и библиотека будут перепривязаны на оригинал. Продолжить?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          for (const { duplicateId, keeperId } of remapPairs) {
            await remapBoqWorkName(duplicateId, keeperId);
            await remapWorksLibraryWorkName(duplicateId, keeperId);
          }

          await deleteWorkNamesIn(remapPairs.map((p) => p.duplicateId));

          message.success(`Удалено ${remapPairs.length} дублей`);
          await loadWorks();
        } catch (error) {
          console.error('Ошибка удаления дублей:', error);
          message.error(getErrorMessage(error) || 'Ошибка удаления дублей');
        }
      },
    });
  };

  // Фильтрация данных
  const getFilteredData = (): WorkRecord[] => {
    if (!showDuplicatesOnly) {
      return worksData;
    }

    const duplicateKeys = findDuplicates();
    return worksData.filter((work) => {
      const key = `${normalizeName(work.name)}|${work.unit}`;
      return duplicateKeys.has(key);
    });
  };

  const toggleDuplicatesFilter = () => {
    setShowDuplicatesOnly(!showDuplicatesOnly);
  };

  return {
    worksData: getFilteredData(),
    duplicatesCount: buildRemapPairs().length,
    loading,
    showDuplicatesOnly,
    loadWorks,
    saveWork,
    deleteWork,
    toggleDuplicatesFilter,
    deleteAllDuplicates,
  };
};
