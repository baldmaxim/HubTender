import { useState } from 'react';
import { Form, message } from 'antd';
import type { MaterialLibraryFull, MaterialName, ItemType, UnitType, DeliveryPriceType } from '../../../../lib/supabase';
import {
  createMaterialLibrary,
  updateMaterialLibrary,
  deleteMaterialLibrary,
} from '../../../../lib/api/library';

export const useMaterialsActions = (materialNames: MaterialName[], onRefresh: () => void) => {
  const [form] = Form.useForm();
  const [addForm] = Form.useForm();
  const [editingKey, setEditingKey] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null);
  const [selectedAddUnit, setSelectedAddUnit] = useState<UnitType | null>(null);
  const [addDeliveryType, setAddDeliveryType] = useState<DeliveryPriceType>('в цене');
  const [addItemType, setAddItemType] = useState<ItemType>('мат');

  const isEditing = (record: MaterialLibraryFull) => record.id === editingKey;

  const edit = (record: Partial<MaterialLibraryFull>) => {
    if (record.unit) {
      setSelectedUnit(record.unit as UnitType);
    }

    form.setFieldsValue({
      material_type: record.material_type,
      item_type: record.item_type,
      material_name_id: record.material_name,
      consumption_coefficient: record.consumption_coefficient || 1.0,
      currency_type: record.currency_type || 'RUB',
      unit_rate: record.unit_rate,
      delivery_price_type: record.delivery_price_type || 'в цене',
      delivery_amount: record.delivery_amount || 0,
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

      const materialName = materialNames.find(m => m.name === row.material_name_id);
      if (!materialName) {
        message.error('Выберите материал из списка');
        return;
      }

      await updateMaterialLibrary(id, {
        material_type: row.material_type,
        item_type: row.item_type,
        material_name_id: materialName.id,
        consumption_coefficient: row.consumption_coefficient,
        unit_rate: row.unit_rate,
        currency_type: row.currency_type,
        delivery_price_type: row.delivery_price_type,
        delivery_amount: row.delivery_price_type === 'суммой' ? row.delivery_amount : 0,
      });
      message.success('Материал обновлен');

      await onRefresh();
      setEditingKey('');
      setSelectedUnit(null);
    } catch (error) {
      console.error('Error saving material:', error);
      message.error('Ошибка при сохранении');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMaterialLibrary(id);

      message.success('Материал удален');
      await onRefresh();
    } catch (error) {
      console.error('Error deleting material:', error);
      message.error('Ошибка при удалении');
    }
  };

  const handleAddSubmit = async () => {
    try {
      const row = await addForm.validateFields();

      const materialName = materialNames.find(m => m.name === row.material_name_id);
      if (!materialName) {
        message.error('Выберите материал из списка');
        return;
      }

      await createMaterialLibrary({
        material_type: row.material_type,
        item_type: row.item_type,
        material_name_id: materialName.id,
        consumption_coefficient: row.consumption_coefficient,
        unit_rate: row.unit_rate,
        currency_type: row.currency_type,
        delivery_price_type: row.delivery_price_type,
        delivery_amount: row.delivery_price_type === 'суммой' ? row.delivery_amount : 0,
      });

      message.success('Материал добавлен');
      await onRefresh();
      cancelAdd();
    } catch (error) {
      console.error('Error adding material:', error);
      message.error('Ошибка при добавлении');
    }
  };

  const handleMaterialNameSelect = (value: string) => {
    const selected = materialNames.find(m => m.name === value);
    if (selected) {
      setSelectedUnit(selected.unit);
    }
  };

  const handleAddMaterialNameSelect = (value: string) => {
    const selected = materialNames.find(m => m.name === value);
    if (selected) {
      setSelectedAddUnit(selected.unit);
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setAddItemType('мат');
    addForm.setFieldsValue({
      material_type: 'основн.',
      item_type: 'мат',
      consumption_coefficient: 1.0,
      currency_type: 'RUB',
      delivery_price_type: 'в цене',
      delivery_amount: 0,
    });
  };

  return {
    form,
    addForm,
    editingKey,
    isAdding,
    selectedUnit,
    selectedAddUnit,
    addDeliveryType,
    setAddDeliveryType,
    addItemType,
    setAddItemType,
    isEditing,
    edit,
    cancel,
    cancelAdd,
    save,
    handleDelete,
    handleAddSubmit,
    handleMaterialNameSelect,
    handleAddMaterialNameSelect,
    handleAdd,
  };
};
