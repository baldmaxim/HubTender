import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
} from 'antd';
import { listUnits } from '../../lib/api/nomenclatures';
import { createAdditionalPosition } from '../../lib/api/positions';
import { getErrorMessage } from '../../utils/errors';

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
  /** Defensive disable: на случай если модалка открыта в момент истечения дедлайна. */
  disabled?: boolean;
  onCancel: () => void;
  onSuccess: (newPositionId: string) => void;
}

const AddAdditionalPositionModal: React.FC<AddAdditionalPositionModalProps> = ({
  open,
  parentPositionId,
  tenderId,
  disabled,
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
      // Go сортирует units по sort_order; исходный .order('code') —
      // воспроизводим клиентом.
      const data = (await listUnits())
        .slice()
        .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      setUnits(data as unknown as Unit[]);
    } catch (error) {
      console.error('Ошибка загрузки единиц измерения:', error);
      message.error('Не удалось загрузить единицы измерения');
    }
  };

  const handleOk = async () => {
    if (disabled) {
      message.warning('Срок редактирования истёк');
      return;
    }
    try {
      setLoading(true);
      const values = await form.validateFields();

      if (!parentPositionId) {
        message.error('Не указана родительская позиция');
        return;
      }

      // Go: read parent + расчёт десятичного суффикса + insert в одной tx.
      const newId = await createAdditionalPosition({
        parent_position_id: parentPositionId,
        tender_id: tenderId,
        work_name: values.work_name,
        unit_code: values.unit_code,
        manual_volume: values.manual_volume,
        manual_note: values.manual_note || null,
      });

      message.success('Дополнительная работа успешно добавлена');
      form.resetFields();
      onSuccess(newId);
    } catch (error) {
      console.error('Ошибка добавления дополнительной работы:', error);
      message.error('Ошибка добавления: ' + getErrorMessage(error));
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
      okButtonProps={{ disabled }}
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
