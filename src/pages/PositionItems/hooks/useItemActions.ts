import { message } from 'antd';
import {
  supabase,
  type ClientPosition,
  type BoqItemInsert,
  type BoqItemType,
  type MaterialType,
  type CurrencyType,
  type DeliveryPriceType,
  type WorkLibraryFull,
  type MaterialLibraryFull,
  type BoqItemFull,
} from '../../../lib/supabase';
import { insertTemplateItems } from '../../../utils/insertTemplateItems';
import { useAuth } from '../../../contexts/AuthContext';
import {
  insertBoqItemWithAudit,
  updateBoqItemWithAudit,
  deleteBoqItemWithAudit,
} from '../../../lib/supabaseWithAudit';
import { getErrorMessage } from '../../../utils/errors';

interface UseItemActionsProps {
  position: ClientPosition | null;
  works: WorkLibraryFull[];
  materials: MaterialLibraryFull[];
  items: BoqItemFull[];
  getCurrencyRate: (currency: CurrencyType) => number;
  fetchItems: () => Promise<void>;
}

export const useItemActions = ({
  position,
  works,
  materials,
  items,
  getCurrencyRate,
  fetchItems,
}: UseItemActionsProps) => {
  const { user } = useAuth();

  const updateClientPositionTotals = async (positionId: string) => {
    try {
      const { data: boqItems, error: fetchError } = await supabase
        .from('boq_items')
        .select('boq_item_type, total_amount')
        .eq('client_position_id', positionId);

      if (fetchError) throw fetchError;

      const totalMaterial = (boqItems || [])
        .filter(item => ['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type))
        .reduce((sum, item) => sum + (item.total_amount || 0), 0);

      const totalWorks = (boqItems || [])
        .filter(item => ['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type))
        .reduce((sum, item) => sum + (item.total_amount || 0), 0);

      const { error } = await supabase
        .from('client_positions')
        .update({
          total_material: totalMaterial,
          total_works: totalWorks,
        })
        .eq('id', positionId);

      if (error) throw error;
    } catch (error) {
      console.error('Ошибка обновления итогов позиции:', getErrorMessage(error));
    }
  };

  const handleAddWork = async (workNameId: string) => {
    if (!workNameId || !position) {
      message.error('Выберите работу');
      return;
    }

    try {
      const workLib = works.find(w => w.work_name_id === workNameId);
      if (!workLib) throw new Error('Работа не найдена в библиотеке');

      const maxSort = Math.max(...items.map(i => i.sort_number || 0), 0);

      const quantity = 1;
      const unitRate = workLib.unit_rate || 0;
      const rate = getCurrencyRate(workLib.currency_type as CurrencyType);
      const totalAmount = quantity * unitRate * rate;

      const newItem: BoqItemInsert = {
        tender_id: position.tender_id,
        client_position_id: position.id,
        sort_number: maxSort + 1,
        boq_item_type: workLib.item_type as BoqItemType,
        work_name_id: workLib.work_name_id,
        unit_code: workLib.unit,
        quantity: quantity,
        unit_rate: unitRate,
        currency_type: workLib.currency_type as CurrencyType,
        total_amount: totalAmount,
      };

      await insertBoqItemWithAudit(user?.id, newItem);

      message.success('Работа добавлена');
      await fetchItems();
      await updateClientPositionTotals(position.id);
    } catch (error) {
      message.error('Ошибка добавления работы: ' + getErrorMessage(error));
    }
  };

  const handleAddMaterial = async (materialNameId: string) => {
    if (!materialNameId || !position) {
      message.error('Выберите материал');
      return;
    }

    try {
      const matLib = materials.find(m => m.material_name_id === materialNameId);
      if (!matLib) throw new Error('Материал не найден в библиотеке');

      const maxSort = Math.max(...items.map(i => i.sort_number || 0), 0);

      // Для непривязанных материалов используем количество ГП из позиции
      const gpVolume = position.manual_volume || 0;
      // base_quantity должно быть > 0 из-за CHECK constraint
      const baseQuantity = gpVolume > 0 ? gpVolume : 1;
      const consumptionCoeff = matLib.consumption_coefficient || 1;
      // Quantity теперь представляет базовое количество (без коэффициента расхода)
      const quantity = baseQuantity;
      const unitRate = matLib.unit_rate || 0;
      const rate = getCurrencyRate(matLib.currency_type as CurrencyType);

      let deliveryPrice = 0;
      if (matLib.delivery_price_type === 'не в цене') {
        deliveryPrice = unitRate * rate * 0.03; // Полная точность (5 знаков)
      } else if (matLib.delivery_price_type === 'суммой' && matLib.delivery_amount) {
        deliveryPrice = matLib.delivery_amount;
      }

      // Для непривязанных материалов применяем коэффициент расхода к итоговой сумме
      const totalAmount = quantity * consumptionCoeff * (unitRate * rate + deliveryPrice);

      const newItem: BoqItemInsert = {
        tender_id: position.tender_id,
        client_position_id: position.id,
        sort_number: maxSort + 1,
        boq_item_type: matLib.item_type as BoqItemType,
        material_type: matLib.material_type as MaterialType,
        material_name_id: matLib.material_name_id,
        unit_code: matLib.unit,
        quantity: quantity,
        base_quantity: baseQuantity,
        unit_rate: unitRate,
        consumption_coefficient: matLib.consumption_coefficient,
        currency_type: matLib.currency_type as CurrencyType,
        delivery_price_type: matLib.delivery_price_type as DeliveryPriceType,
        delivery_amount: matLib.delivery_amount,
        total_amount: totalAmount,
      };

      await insertBoqItemWithAudit(user?.id, newItem);

      message.success('Материал добавлен');
      await fetchItems();
      await updateClientPositionTotals(position.id);
    } catch (error) {
      message.error('Ошибка добавления материала: ' + getErrorMessage(error));
    }
  };

  const handleAddTemplate = async (templateId: string, setLoading: (loading: boolean) => void) => {
    if (!templateId || !position) {
      message.error('Выберите шаблон');
      return;
    }

    try {
      setLoading(true);
      const result = await insertTemplateItems(templateId, position.id, user?.id);

      message.success(
        `Вставлено из шаблона: ${result.worksCount} работ, ${result.materialsCount} материалов`
      );
      await fetchItems();
      await updateClientPositionTotals(position.id);
    } catch (error) {
      message.error('Ошибка вставки шаблона: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBoqItemWithAudit(user?.id, id);

      message.success('Элемент удален');
      await fetchItems();
      if (position) {
        await updateClientPositionTotals(position.id);
      }
    } catch (error) {
      message.error('Ошибка удаления: ' + getErrorMessage(error));
    }
  };

  const updateLinkedMaterialsQuantity = async (workId: string) => {
    try {
      const { data: workData, error: workError } = await supabase
        .from('boq_items')
        .select('quantity')
        .eq('id', workId)
        .single();

      if (workError) throw workError;

      const workQuantity = workData.quantity || 0;

      const { data: linkedMaterials, error: materialsError } = await supabase
        .from('boq_items')
        .select('id, conversion_coefficient, consumption_coefficient, unit_rate, currency_type, delivery_price_type, delivery_amount')
        .eq('parent_work_item_id', workId);

      if (materialsError) throw materialsError;

      for (const material of linkedMaterials || []) {
        const conversionCoeff = material.conversion_coefficient || 1;
        const consumptionCoeff = material.consumption_coefficient || 1;
        const newQuantity = workQuantity * conversionCoeff * consumptionCoeff;

        const unitRate = material.unit_rate || 0;
        const rate = getCurrencyRate(material.currency_type as CurrencyType);
        let deliveryPrice = 0;

        if (material.delivery_price_type === 'не в цене') {
          deliveryPrice = unitRate * rate * 0.03; // Полная точность (5 знаков)
        } else if (material.delivery_price_type === 'суммой' && material.delivery_amount) {
          deliveryPrice = material.delivery_amount;
        }

        const totalAmount = newQuantity * (unitRate * rate + deliveryPrice);

        await updateBoqItemWithAudit(user?.id, material.id, {
          quantity: newQuantity,
          total_amount: totalAmount,
        });
      }
    } catch (error) {
      console.error('Ошибка обновления количества материалов:', getErrorMessage(error));
    }
  };

  const handleFormSave = async (
    data: Record<string, unknown>,
    expandedRowKeys: string[],
    items: BoqItemFull[],
    onSuccess: () => void
  ) => {
    try {
      const recordId = expandedRowKeys[0];
      if (!recordId) return;

      await updateBoqItemWithAudit(user?.id, recordId, data);

      const updatedItem = items.find(item => item.id === recordId);
      if (updatedItem && ['раб', 'суб-раб', 'раб-комп.'].includes(updatedItem.boq_item_type)) {
        await updateLinkedMaterialsQuantity(recordId);
      }

      message.success('Изменения сохранены');
      await fetchItems();
      if (position) {
        await updateClientPositionTotals(position.id);
      }
      onSuccess();
    } catch (error) {
      message.error('Ошибка сохранения: ' + getErrorMessage(error));
    }
  };

  const handleSaveGPData = async (
    positionId: string,
    gpVolume: number,
    gpNote: string,
    onSuccess: () => void
  ) => {
    try {
      const { error } = await supabase
        .from('client_positions')
        .update({
          manual_volume: gpVolume,
          manual_note: gpNote,
        })
        .eq('id', positionId);

      if (error) throw error;
      onSuccess();
    } catch (error) {
      message.error('Ошибка сохранения данных ГП: ' + getErrorMessage(error));
    }
  };

  const handleSaveAdditionalWorkData = async (
    positionId: string,
    workName: string,
    unitCode: string,
    onSuccess: () => void
  ) => {
    try {
      const { error } = await supabase
        .from('client_positions')
        .update({
          work_name: workName,
          unit_code: unitCode,
        })
        .eq('id', positionId);

      if (error) throw error;
      onSuccess();
      message.success('Данные дополнительной работы сохранены');
    } catch (error) {
      message.error('Ошибка сохранения данных: ' + getErrorMessage(error));
    }
  };

  const getItemGroupBounds = (
    item: BoqItemFull,
    items: BoqItemFull[]
  ): { start: number; end: number } => {
    // Привязанный материал - границы блока работы
    if (item.parent_work_item_id) {
      const workIndex = items.findIndex(i => i.id === item.parent_work_item_id);
      let endIndex = workIndex;

      for (let i = workIndex + 1; i < items.length; i++) {
        if (items[i].parent_work_item_id === item.parent_work_item_id) {
          endIndex = i;
        } else {
          break;
        }
      }

      return { start: workIndex + 1, end: endIndex };
    }

    // Работа с материалами - перемещается среди других работ с материалами (Группа 1)
    const isWork = ['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type);
    const hasMaterials = items.some(m => m.parent_work_item_id === item.id);

    if (isWork && hasMaterials) {
      // Найти первую и последнюю работу с материалами (включая их материалы)
      let start = 0;
      let end = items.length - 1;

      for (let i = 0; i < items.length; i++) {
        const isWorkWithMats = ['раб', 'суб-раб', 'раб-комп.'].includes(items[i].boq_item_type) &&
          items.some(m => m.parent_work_item_id === items[i].id);
        if (isWorkWithMats) {
          start = i;
          break;
        }
      }

      // Найти последний привязанный материал
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].parent_work_item_id) {
          end = i;
          break;
        }
      }

      return { start, end };
    }

    // Непривязанный элемент (работа или материал) - Группа 2
    // Все непривязанные элементы идут после Группы 1
    let start = 0;
    for (let i = 0; i < items.length; i++) {
      const isUnlinked = !items[i].parent_work_item_id &&
        !items.some(m => m.parent_work_item_id === items[i].id);
      if (isUnlinked) {
        start = i;
        break;
      }
    }

    return { start, end: items.length - 1 };
  };

  const handleMoveItem = async (itemId: string, direction: 'up' | 'down') => {
    try {
      const currentIndex = items.findIndex(i => i.id === itemId);
      const item = items[currentIndex];
      const bounds = getItemGroupBounds(item, items);

      // Проверка возможности перемещения
      if (direction === 'up' && currentIndex <= bounds.start) {
        message.warning('Невозможно переместить элемент выше');
        return;
      }

      if (direction === 'down' && currentIndex >= bounds.end) {
        message.warning('Невозможно переместить элемент ниже');
        return;
      }

      // Swap с соседним элементом
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      const targetItem = items[targetIndex];

      // Обновить sort_number атомарно
      const updates = [
        { id: item.id, sort_number: targetItem.sort_number },
        { id: targetItem.id, sort_number: item.sort_number }
      ];

      for (const update of updates) {
        await updateBoqItemWithAudit(user?.id, update.id, { sort_number: update.sort_number });
      }

      await fetchItems();
      message.success('Элемент перемещен');
    } catch (error) {
      message.error('Ошибка перемещения: ' + getErrorMessage(error));
    }
  };

  return {
    handleAddWork,
    handleAddMaterial,
    handleAddTemplate,
    handleDelete,
    handleFormSave,
    handleSaveGPData,
    handleSaveAdditionalWorkData,
    handleMoveItem,
  };
};
