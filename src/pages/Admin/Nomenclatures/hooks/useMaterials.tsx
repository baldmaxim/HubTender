import { useState } from 'react';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { getErrorMessage } from '../../../../utils/errors';
import {
  listMaterialNames,
  listMaterialNamesByUnit,
  createMaterialName,
  updateMaterialName,
  deleteMaterialName,
  deleteMaterialNamesIn,
  remapBoqMaterialName,
  remapMaterialsLibraryMaterialName,
  unitExists,
} from '../../../../lib/api/nomenclatures';

const { confirm } = Modal;

export interface MaterialRecord {
  key: string;
  id: string;
  name: string;
  unit: string;
  created_at: string;
}

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

export const useMaterials = () => {
  const [materialsData, setMaterialsData] = useState<MaterialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  const loadMaterials = async () => {
    setLoading(true);
    try {
      const data = await listMaterialNames();
      const formattedData: MaterialRecord[] = data.map((item) => ({
        key: item.id,
        id: item.id,
        name: item.name,
        unit: item.unit,
        created_at: new Date(item.created_at).toLocaleDateString('ru-RU'),
      }));

      console.log(`[Nomenclatures/Materials] Loaded ${formattedData.length} materials`);
      setMaterialsData(formattedData);
    } catch (error) {
      console.error('Ошибка загрузки материалов:', error);
      message.error('Ошибка загрузки материалов');
    } finally {
      setLoading(false);
    }
  };

  const saveMaterial = async (values: { name: string; unit: string }, editingMaterialId?: string) => {
    try {
      if (editingMaterialId) {
        const exists = await unitExists(values.unit);
        if (!exists) {
          message.error(`Единица измерения "${values.unit}" не существует в справочнике`);
          return false;
        }

        await updateMaterialName(editingMaterialId, values);
        message.success('Материал обновлен');
      } else {
        const normalizedInputName = normalizeName(values.name);
        const existingMaterials = await listMaterialNamesByUnit(values.unit);
        const duplicate = existingMaterials.find(
          (mat) => normalizeName(mat.name) === normalizedInputName
        );

        if (duplicate) {
          message.warning(`Материал "${duplicate.name}" с единицей "${duplicate.unit}" уже существует`);
          return false;
        }

        await createMaterialName(values);
        message.success('Материал добавлен');
      }

      await loadMaterials();
      return true;
    } catch (error) {
      console.error('Ошибка сохранения материала:', error);
      message.error(getErrorMessage(error) || 'Ошибка сохранения материала');
      return false;
    }
  };

  const deleteMaterial = (record: MaterialRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    confirm({
      title: 'Подтверждение удаления',
      icon: <ExclamationCircleOutlined />,
      content: `Вы уверены, что хотите удалить материал "${record.name}"?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          await deleteMaterialName(record.id);
          message.success('Материал удален');
          await loadMaterials();
        } catch (error) {
          console.error('Ошибка удаления материала:', error);
          message.error(getErrorMessage(error) || 'Ошибка удаления материала');
        }
      },
    });
  };

  // Поиск дублей по нормализованному имени + единице
  const findDuplicates = (): Set<string> => {
    const seen = new Map<string, number>();
    const duplicateKeys = new Set<string>();

    materialsData.forEach((material) => {
      const key = `${normalizeName(material.name)}|${material.unit}`;
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
    const groups = new Map<string, MaterialRecord[]>();
    for (const material of materialsData) {
      const key = `${normalizeName(material.name)}|${material.unit}`;
      const group = groups.get(key);
      if (group) {
        group.push(material);
      } else {
        groups.set(key, [material]);
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
      content: `Будет удалено ${remapPairs.length} дублирующих записей материалов. Связанные позиции BOQ и библиотека будут перепривязаны на оригинал. Продолжить?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          for (const { duplicateId, keeperId } of remapPairs) {
            await remapBoqMaterialName(duplicateId, keeperId);
            await remapMaterialsLibraryMaterialName(duplicateId, keeperId);
          }

          await deleteMaterialNamesIn(remapPairs.map((p) => p.duplicateId));

          message.success(`Удалено ${remapPairs.length} дублей`);
          await loadMaterials();
        } catch (error) {
          console.error('Ошибка удаления дублей:', error);
          message.error(getErrorMessage(error) || 'Ошибка удаления дублей');
        }
      },
    });
  };

  // Фильтрация данных
  const getFilteredData = (): MaterialRecord[] => {
    if (!showDuplicatesOnly) {
      return materialsData;
    }

    const duplicateKeys = findDuplicates();
    return materialsData.filter((material) => {
      const key = `${normalizeName(material.name)}|${material.unit}`;
      return duplicateKeys.has(key);
    });
  };

  const toggleDuplicatesFilter = () => {
    setShowDuplicatesOnly(!showDuplicatesOnly);
  };

  return {
    materialsData: getFilteredData(),
    duplicatesCount: buildRemapPairs().length,
    loading,
    showDuplicatesOnly,
    loadMaterials,
    saveMaterial,
    deleteMaterial,
    toggleDuplicatesFilter,
    deleteAllDuplicates,
  };
};
