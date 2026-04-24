import { useState } from 'react';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { supabase } from '../../../../lib/supabase';
import { getErrorMessage } from '../../../../utils/errors';

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
      // Загружаем данные батчами, так как Supabase ограничивает 1000 строк за запрос
      let allMaterials: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('material_names')
          .select('*')
          .order('name')
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allMaterials = [...allMaterials, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const formattedData: MaterialRecord[] = allMaterials.map((item: any) => ({
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

  const saveMaterial = async (values: any, editingMaterialId?: string) => {
    try {
      if (editingMaterialId) {
        // Валидация: проверить что unit существует в справочнике
        const { data: unitExists, error: unitCheckError } = await supabase
          .from('units')
          .select('code')
          .eq('code', values.unit)
          .maybeSingle();

        if (unitCheckError) {
          console.error('Ошибка проверки единицы измерения:', unitCheckError);
          throw new Error('Ошибка проверки единицы измерения');
        }

        if (!unitExists) {
          message.error(`Единица измерения "${values.unit}" не существует в справочнике`);
          return false;
        }

        // UPDATE без ручного updated_at (триггер установит автоматически)
        const { error } = await supabase
          .from('material_names')
          .update({
            name: values.name,
            unit: values.unit,
          })
          .eq('id', editingMaterialId)
          .select();

        if (error) {
          console.error('[NOMENCLATURE UPDATE ERROR]', {
            table: 'material_names',
            id: editingMaterialId,
            values: values,
            error: error,
            code: error.code,
            message: error.message,
          });
          throw error;
        }

        message.success('Материал обновлен');
      } else {
        // Проверка на дубликат перед вставкой
        const normalizedInputName = normalizeName(values.name);
        const { data: existingMaterials, error: checkError } = await supabase
          .from('material_names')
          .select('name, unit')
          .eq('unit', values.unit);

        if (checkError) throw checkError;

        // Проверяем нормализованные имена
        const duplicate = existingMaterials?.find(
          (mat) => normalizeName(mat.name) === normalizedInputName
        );

        if (duplicate) {
          message.warning(`Материал "${duplicate.name}" с единицей "${duplicate.unit}" уже существует`);
          return false;
        }

        const { error } = await supabase
          .from('material_names')
          .insert([{
            name: values.name,
            unit: values.unit,
          }]);

        if (error) throw error;
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
          const { error } = await supabase
            .from('material_names')
            .delete()
            .eq('id', record.id);

          if (error) throw error;

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
          // Перепривязываем все ссылки на дубли → на оригинал
          for (const { duplicateId, keeperId } of remapPairs) {
            const { error: boqError } = await supabase
              .from('boq_items')
              .update({ material_name_id: keeperId })
              .eq('material_name_id', duplicateId);
            if (boqError) throw boqError;

            const { error: libError } = await supabase
              .from('materials_library')
              .update({ material_name_id: keeperId })
              .eq('material_name_id', duplicateId);
            if (libError) throw libError;
          }

          // Удаляем освободившиеся дубли
          const toDeleteIds = remapPairs.map((p) => p.duplicateId);
          const { error: deleteError } = await supabase
            .from('material_names')
            .delete()
            .in('id', toDeleteIds);
          if (deleteError) throw deleteError;

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
