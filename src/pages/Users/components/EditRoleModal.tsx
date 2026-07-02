import React from 'react';
import { Modal, Form, Checkbox, Alert } from 'antd';
import type { FormInstance } from 'antd';
import { ALL_PAGES, PAGE_LABELS, PAGES_STRUCTURE } from '../../../lib/types/types';
import type { RoleRecord } from '../types';

interface EditRoleModalProps {
  open: boolean;
  editingRole: RoleRecord | null;
  form: FormInstance;
  isPhone: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export const EditRoleModal: React.FC<EditRoleModalProps> = ({
  open,
  editingRole,
  form,
  isPhone,
  onOk,
  onCancel,
}) => {
  const isDeveloperRole = !!editingRole && editingRole.name === 'Разработчик';

  return (
    <Modal
      title={`Редактирование прав доступа: ${editingRole?.name}`}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText="Сохранить"
      cancelText="Отмена"
      width={isPhone ? '100%' : 700}
    >
      <Form form={form} layout="vertical">
        {isDeveloperRole && (
          <Alert
            message="Полный доступ"
            description="Роль «Разработчик» имеет полный доступ ко всем страницам портала. Список страниц недоступен для редактирования."
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item name="allowed_pages" label="Доступные страницы" tooltip="Если ничего не выбрано - полный доступ">
          <Checkbox.Group style={{ width: '100%' }} disabled={isDeveloperRole}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {PAGES_STRUCTURE.map((group, groupIndex) => {
                const groupPages = group.pages.filter((page) => ALL_PAGES.includes(page));
                if (groupPages.length === 0) {
                  return null;
                }
                return (
                  <div key={groupIndex}>
                    {group.title && (
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {group.title}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: group.title ? 12 : 0 }}>
                      {groupPages.map((page) => (
                        <Checkbox key={page} value={page}>{PAGE_LABELS[page] || page}</Checkbox>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Checkbox.Group>
        </Form.Item>

        <Alert
          message="Важно"
          description="После изменения прав роли, все пользователи с этой ролью автоматически получат обновленные права доступа. Пользователям необходимо выйти и снова войти в систему."
          type="warning"
          showIcon
        />
      </Form>
    </Modal>
  );
};
