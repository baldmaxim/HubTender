import { useState } from 'react';
import { Form, message } from 'antd';
import type { WorkLibraryFull, WorkName, WorkItemType, UnitType } from '../../../../lib/types';
import {
  createWorkLibrary,
  updateWorkLibrary,
  deleteWorkLibrary,
} from '../../../../lib/api/library';

export const useWorksActions = (workNames: WorkName[], onRefresh: () => void) => {
  const [form] = Form.useForm();
  const [addForm] = Form.useForm();
  const [editingKey, setEditingKey] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null);
  const [selectedAddUnit, setSelectedAddUnit] = useState<UnitType | null>(null);
  const [addItemType, setAddItemType] = useState<WorkItemType>('раб');

  const isEditing = (record: WorkLibraryFull) => record.id === editingKey;

  const edit = (record: Partial<WorkLibraryFull>) => {
    if (record.unit) {
      setSelectedUnit(record.unit as UnitType);
    }

    form.setFieldsValue({
      item_type: record.item_type,
      work_name_id: record.work_name,
      currency_type: record.currency_type || 'RUB',
      unit_rate: record.unit_rate,
    });
    setEditingKey(record.id || '');
  };

  const cancel = () => {
    setEditingKey('');
    setSelectedUnit(null);
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setSelectedAddUnit(null);
    addForm.resetFields();
  };

  const save = async (id: string) => {
    try {
      const row = await form.validateFields();

      const workName = workNames.find(w => w.name === row.work_name_id);
      if (!workName) {
        message.error('Выберите работу из списка');
        return;
      }

      await updateWorkLibrary(id, {
        work_name_id: workName.id,
        item_type: row.item_type,
        unit_rate: row.unit_rate,
        currency_type: row.currency_type,
      });
      message.success('Работа обновлена');

      await onRefresh();
      setEditingKey('');
      setSelectedUnit(null);
    } catch (error) {
      console.error('Error saving work:', error);
      message.error('Ошибка при сохранении');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkLibrary(id);

      message.success('Работа удалена');
      await onRefresh();
    } catch (error) {
      console.error('Error deleting work:', error);
      message.error('Ошибка при удалении');
    }
  };

  const handleAddSubmit = async () => {
    try {
      const row = await addForm.validateFields();

      const workName = workNames.find(w => w.name === row.work_name_id);
      if (!workName) {
        message.error('Выберите работу из списка');
        return;
      }

      await createWorkLibrary({
        work_name_id: workName.id,
        item_type: row.item_type,
        unit_rate: row.unit_rate,
        currency_type: row.currency_type,
      });

      message.success('Работа добавлена');
      await onRefresh();
      cancelAdd();
    } catch (error) {
      console.error('Error adding work:', error);
      message.error('Ошибка при добавлении');
    }
  };

  const handleWorkNameSelect = (value: string) => {
    const selected = workNames.find(w => w.name === value);
    if (selected) {
      setSelectedUnit(selected.unit);
    }
  };

  const handleAddWorkNameSelect = (value: string) => {
    const selected = workNames.find(w => w.name === value);
    if (selected) {
      setSelectedAddUnit(selected.unit);
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setAddItemType('раб');
    addForm.setFieldsValue({
      item_type: 'раб',
      currency_type: 'RUB',
      unit_rate: 0,
    });
  };

  return {
    form,
    addForm,
    editingKey,
    isAdding,
    selectedUnit,
    selectedAddUnit,
    addItemType,
    setAddItemType,
    isEditing,
    edit,
    cancel,
    cancelAdd,
    save,
    handleDelete,
    handleAddSubmit,
    handleWorkNameSelect,
    handleAddWorkNameSelect,
    handleAdd,
  };
};
