import React from 'react';
import { Modal, Form, Input, Alert } from 'antd';
import type { FormInstance } from 'antd';

interface CreateRoleModalProps {
  open: boolean;
  form: FormInstance;
  isPhone: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export const CreateRoleModal: React.FC<CreateRoleModalProps> = ({ open, form, isPhone, onOk, onCancel }) => (
  <Modal
    title="Создание новой роли"
    open={open}
    onOk={onOk}
    onCancel={onCancel}
    okText="Создать"
    cancelText="Отмена"
    width={isPhone ? '100%' : 500}
  >
    <Form form={form} layout="vertical">
      <Form.Item
        name="name"
        label="Название роли"
        rules={[
          { required: true, message: 'Введите название роли' },
          { min: 3, message: 'Название должно содержать минимум 3 символа' },
        ]}
      >
        <Input placeholder="Например: Главный инженер" />
      </Form.Item>

      <Alert
        message="Информация"
        description="После создания роли вы сможете настроить права доступа к страницам. Код роли будет сгенерирован автоматически на основе названия."
        type="info"
        showIcon
      />
    </Form>
  </Modal>
);
