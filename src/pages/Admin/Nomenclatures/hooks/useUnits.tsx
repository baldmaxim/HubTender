import { useState } from 'react';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { getErrorMessage } from '../../../../utils/errors';
import {
  listUnits,
  listActiveUnits,
  createUnit,
  updateUnit,
  deleteUnit as apiDeleteUnit,
  type UnitInput,
} from '../../../../lib/api/nomenclatures';

const { confirm } = Modal;

export interface UnitRecord {
  key: string;
  code: string;
  name: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export const useUnits = () => {
  const [unitsData, setUnitsData] = useState<UnitRecord[]>([]);
  const [unitsList, setUnitsList] = useState<{code: string, name: string}[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUnits = async () => {
    setLoading(true);
    try {
      const data = await listUnits();
      const formattedData: UnitRecord[] = data.map((item) => ({
        key: item.code,
        code: item.code,
        name: item.name,
        category: item.category || 'общая',
        sort_order: item.sort_order || 0,
        is_active: item.is_active !== false,
        created_at: new Date(item.created_at).toLocaleDateString('ru-RU'),
      }));

      setUnitsData(formattedData);
    } catch (error) {
      console.error('Ошибка загрузки единиц измерения:', error);
      message.error('Ошибка загрузки единиц измерения');
    } finally {
      setLoading(false);
    }
  };

  const loadUnitsList = async () => {
    try {
      const data = await listActiveUnits();
      setUnitsList(data.map((item) => ({ code: item.code, name: item.name })));
    } catch (error) {
      console.error('Ошибка загрузки списка единиц:', error);
    }
  };

  const saveUnit = async (values: UnitInput, editingUnitCode?: string) => {
    try {
      if (editingUnitCode) {
        await updateUnit(editingUnitCode, values);
        message.success('Единица измерения обновлена');
      } else {
        await createUnit(values);
        message.success('Единица измерения добавлена');
      }
      await loadUnits();
      return true;
    } catch (error) {
      console.error('Ошибка сохранения единицы измерения:', error);
      message.error(getErrorMessage(error) || 'Ошибка сохранения единицы измерения');
      return false;
    }
  };

  const deleteUnit = (record: UnitRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    confirm({
      title: 'Подтверждение удаления',
      icon: <ExclamationCircleOutlined />,
      content: `Вы уверены, что хотите удалить единицу измерения "${record.name}" (${record.code})?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          await apiDeleteUnit(record.code);
          message.success('Единица измерения удалена');
          await loadUnits();
        } catch (error) {
          console.error('Ошибка удаления единицы измерения:', error);
          message.error(getErrorMessage(error) || 'Ошибка удаления единицы измерения');
        }
      },
    });
  };

  return {
    unitsData,
    unitsList,
    loading,
    loadUnits,
    loadUnitsList,
    saveUnit,
    deleteUnit,
  };
};
