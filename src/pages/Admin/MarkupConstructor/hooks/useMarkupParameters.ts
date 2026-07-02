import { useState } from 'react';
import { message } from 'antd';
import type { FormInstance } from 'antd';
import type { useAppProps } from 'antd/es/app/context';
import type { MarkupParameter } from '../../../../lib/types';
import {
  listActiveMarkupParameters,
  createMarkupParameter,
  updateMarkupParameter,
  deleteMarkupParameter,
  setMarkupParameterOrderNum,
} from '../../../../lib/api/markup';

// Параметры наценок: загрузка, базовые проценты (default_value) и CRUD
// с inline-редактированием. Перенесено из MarkupConstructor без изменений
// логики; form-инстансы и modal приходят параметрами.
export const useMarkupParameters = ({
  form,
  basePercentagesForm,
  newParameterForm,
  modal,
}: {
  form: FormInstance;
  basePercentagesForm: FormInstance;
  newParameterForm: FormInstance;
  modal: useAppProps['modal'];
}) => {
  // Состояния для параметров наценок (загружаются из БД)
  const [markupParameters, setMarkupParameters] = useState<MarkupParameter[]>([]);
  const [loadingParameters, setLoadingParameters] = useState(false);

  // Состояния для управления параметрами
  const [isAddParameterModalOpen, setIsAddParameterModalOpen] = useState(false);

  // Состояния для inline редактирования параметров
  const [editingParameterId, setEditingParameterId] = useState<string | null>(null);
  const [editingParameterLabel, setEditingParameterLabel] = useState('');

  // Состояния для базовых процентов
  const [savingBasePercentages, setSavingBasePercentages] = useState(false);

  const fetchMarkupParameters = async () => {
    setLoadingParameters(true);
    try {
      const data = await listActiveMarkupParameters();
      console.log('=== Загружены параметры из БД ===');
      setMarkupParameters(data);

      const initialValues: Record<string, number> = {};
      data.forEach((param) => {
        initialValues[param.key] = param.default_value || 0;
        console.log(`  ${param.label} (${param.key}): ${param.default_value}`);
      });
      basePercentagesForm.setFieldsValue(initialValues);
      console.log('================================');

      form.setFieldsValue(initialValues);
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

      console.log('=== Сохранение базовых процентов ===');
      console.log('Значения формы:', values);

      const updatePromises = markupParameters.map(async (param) => {
        const newValue = values[param.key] ?? param.default_value ?? 0;
        console.log(`  ${param.label} (${param.key}): ${param.default_value} -> ${newValue}`);
        await updateMarkupParameter(param.id, { default_value: newValue });
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

      await createMarkupParameter({
        key: parameterKey,
        label: parameterLabel,
        is_active: true,
        order_num: maxOrderNum + 1,
      });

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
      await updateMarkupParameter(parameterId, { label: editingParameterLabel });

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
          await deleteMarkupParameter(parameter.id);
          message.success(`Параметр "${parameter.label}" удален`);
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
      await setMarkupParameterOrderNum(parameter.id, prevParameter.order_num ?? 0);
      await setMarkupParameterOrderNum(prevParameter.id, parameter.order_num ?? 0);

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
      await setMarkupParameterOrderNum(parameter.id, nextParameter.order_num ?? 0);
      await setMarkupParameterOrderNum(nextParameter.id, parameter.order_num ?? 0);

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

  return {
    markupParameters,
    loadingParameters,
    savingBasePercentages,
    isAddParameterModalOpen,
    editingParameterId,
    editingParameterLabel,
    setEditingParameterLabel,
    fetchMarkupParameters,
    handleSaveBasePercentages,
    handleResetBasePercentages,
    handleAddParameter,
    handleInlineEdit,
    handleInlineSave,
    handleInlineCancel,
    handleDeleteParameter,
    handleMoveParameterUp,
    handleMoveParameterDown,
    handleOpenParameterModal,
    handleCloseParameterModal,
  };
};
