import React from 'react';
import { Modal, Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import type { RoleRecord, UserRecord } from '../types';

interface EditUserModalProps {
  open: boolean;
  editingUser: UserRecord | null;
  form: FormInstance;
  roles: RoleRecord[];
  isPhone: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  open,
  editingUser,
  form,
  roles,
  isPhone,
  onOk,
  onCancel,
}) => (
  <Modal
    title={`Редактирование пользователя: ${editingUser?.full_name}`}
    open={open}
    onOk={onOk}
    onCancel={onCancel}
    okText="Сохранить"
    cancelText="Отмена"
    width={isPhone ? '100%' : 700}
  >
    <Form form={form} layout="vertical">
      <Form.Item
        name="full_name"
        label="ФИО"
        rules={[
          { required: true, message: 'Введите ФИО' },
          { min: 3, message: 'ФИО должно содержать минимум 3 символа' },
        ]}
      >
        <Input placeholder="Иванов Иван Иванович" />
      </Form.Item>

      <Form.Item
        name="email"
        label="Email"
        rules={[
          { required: true, message: 'Введите email' },
          { type: 'email', message: 'Введите корректный email' },
        ]}
      >
        <Input placeholder="example@su10.ru" />
      </Form.Item>

      <Form.Item name="role_code" label="Роль" rules={[{ required: true, message: 'Выберите роль' }]}>
        <Select
          placeholder="Выберите роль"
          options={roles.map((role) => ({ value: role.code, label: role.name }))}
        />
      </Form.Item>
    </Form>
  </Modal>
);
