import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
} from 'antd';
import { supabase } from '../../lib/supabase';

const { TextArea } = Input;

interface Unit {
  id: string;
  code: string;
  name: string;
}

interface AddAdditionalPositionModalProps {
  open: boolean;
  parentPositionId: string | null;
  tenderId: string;
  onCancel: () => void;
  onSuccess: (newPositionId: string) => void;
}

const AddAdditionalPositionModal: React.FC<AddAdditionalPositionModalProps> = ({
  open,
  parentPositionId,
  tenderId,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);

  // Загрузка единиц измерения
  useEffect(() => {
    fetchUnits();
  }, []);

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabase
        .from('units')
        .select('*')
        .order('code', { ascending: true });

      if (error) throw error;
      setUnits(data || []);
    } catch (error: any) {
      console.error('Ошибка загрузки единиц измерения:', error);
      message.error('Не удалось загрузить единицы измерения');
    }
  };

  const handleOk = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      if (!parentPositionId) {
        message.error('Не указана родительская позиция');
        return;
      }

      // Получаем родительскую позицию
      const { data: parentPosition, error: parentError } = await supabase
        .from('client_positions')
        .select('*')
        .eq('id', parentPositionId)
        .single();

      if (parentError) throw parentError;

      // Получаем все дополнительные работы для этого родителя
      const { data: existingAdditional, error: additionalError } = await supabase
        .from('client_positions')
        .select('position_number')
        .eq('parent_position_id', parentPositionId)
        .eq('is_additional', true)
        .order('position_number', { ascending: false })
        .limit(1);

      if (additionalError) throw additionalError;

      // Вычисляем position_number с суффиксом (например, 5.1, 5.2, 5.3)
      let newPositionNumber: number;
      if (existingAdditional && existingAdditional.length > 0) {
        // Есть уже дополнительные работы - увеличиваем суффикс
        const lastNumber = existingAdditional[0].position_number;
        const decimalPart = lastNumber - Math.floor(lastNumber);
        const nextSuffix = Math.round((decimalPart + 0.1) * 10) / 10;
        newPositionNumber = Math.floor(lastNumber) + nextSuffix;
      } else {
        // Первая дополнительная работа - добавляем .1
        newPositionNumber = parentPosition.position_number + 0.1;
      }

      // Создаем новую дополнительную позицию
      const newPosition = {
        tender_id: tenderId,
        position_number: newPositionNumber,
        work_name: values.work_name,
        unit_code: values.unit_code,
        manual_volume: values.manual_volume,
        manual_note: values.manual_note || null,
        hierarchy_level: (parentPosition.hierarchy_level || 0) + 1,
        is_additional: true,
        parent_position_id: parentPositionId,
        // Копируем некоторые поля от родителя для целостности
        volume: null,
        client_note: null,
        item_no: null,
      };

      const { data: inserted, error: insertError } = await supabase
        .from('client_positions')
        .insert(newPosition)
        .select('id')
        .single();

      if (insertError) throw insertError;

      message.success('Дополнительная работа успешно добавлена');
      form.resetFields();
      onSuccess(inserted.id);
    } catch (error: any) {
      console.error('Ошибка добавления дополнительной работы:', error);
      message.error('Ошибка добавления: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title="Добавить дополнительную работу"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="Добавить"
      cancelText="Отмена"
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          manual_volume: 1,
        }}
      >
        <Form.Item
          name="work_name"
          label="Наименование работы"
          rules={[{ required: true, message: 'Введите наименование работы' }]}
        >
          <Input placeholder="Введите наименование дополнительной работы" />
        </Form.Item>

        <Form.Item
          name="unit_code"
          label="Единица измерения"
          rules={[{ required: true, message: 'Выберите единицу измерения' }]}
        >
          <Select
            showSearch
            placeholder="Выберите единицу измерения"
            optionFilterProp="children"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={units.map(unit => ({
              value: unit.code,
              label: unit.code,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="manual_volume"
          label="Количество ГП"
          rules={[
            { required: true, message: 'Введите количество' },
            { type: 'number', min: 0.01, message: 'Количество должно быть больше 0' },
          ]}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="Введите количество"
            precision={2}
            min={0.01}
          />
        </Form.Item>

        <Form.Item
          name="manual_note"
          label="Примечание ГП"
        >
          <TextArea
            rows={3}
            placeholder="Введите примечание (необязательно)"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddAdditionalPositionModal;
