import React from 'react';
import { Modal, Form, Input, Select, Alert, Typography, Button } from 'antd';
import type { FormInstance } from 'antd';
import { TreeNode } from '../hooks/useConstructionCost.tsx';
import { useTheme } from '../../../../contexts/ThemeContext';
import type { Tables } from '../../../../lib/supabase/database.types';

const { Paragraph } = Typography;

interface CostModalsProps {
  editModalOpen: boolean;
  editingItem: TreeNode | null;
  form: FormInstance;
  unitsData: Tables<'units'>[];
  sqlModalOpen: boolean;
  sqlContent: string;
  importErrors: string[];
  addCategoryModalOpen: boolean;
  addDetailModalOpen: boolean;
  addLocationModalOpen: boolean;
  selectedCategory: TreeNode | null;
  selectedDetail: TreeNode | null;
  addCategoryForm: FormInstance;
  addDetailForm: FormInstance;
  addLocationForm: FormInstance;
  onEditSave: () => void;
  onEditCancel: () => void;
  onSqlClose: () => void;
  onImportErrorsClose: () => void;
  onAddCategorySave: () => void;
  onAddCategoryCancel: () => void;
  onAddDetailSave: () => void;
  onAddDetailCancel: () => void;
  onAddLocationSave: () => void;
  onAddLocationCancel: () => void;
}

export const CostModals: React.FC<CostModalsProps> = ({
  editModalOpen,
  editingItem,
  form,
  unitsData,
  sqlModalOpen,
  sqlContent,
  importErrors,
  addCategoryModalOpen,
  addDetailModalOpen,
  addLocationModalOpen,
  selectedCategory,
  selectedDetail,
  addCategoryForm,
  addDetailForm,
  addLocationForm,
  onEditSave,
  onEditCancel,
  onSqlClose,
  onImportErrorsClose,
  onAddCategorySave,
  onAddCategoryCancel,
  onAddDetailSave,
  onAddDetailCancel,
  onAddLocationSave,
  onAddLocationCancel,
}) => {
  const { theme } = useTheme();

  return (
    <>
      {/* Модальное окно редактирования */}
      <Modal
        title={`Редактирование ${editingItem?.type === 'category' ? 'категории' : 'детализации'}`}
        open={editModalOpen}
        onOk={onEditSave}
        onCancel={onEditCancel}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Наименование"
            rules={[{ required: true, message: 'Введите наименование' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="unit"
            label="Единица измерения"
            rules={[{ required: true, message: 'Выберите единицу измерения' }]}
          >
            <Select>
              {unitsData.map(unit => (
                <Select.Option key={unit.code} value={unit.code}>
                  {unit.name} ({unit.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {editingItem?.type === 'detail' && (
            <Form.Item
              name="location"
              label="Локация"
              rules={[{ required: true, message: 'Введите локацию' }]}
            >
              <Input />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Модальное окно с SQL */}
      <Modal
        title="Необходимо добавить новые единицы измерения"
        open={sqlModalOpen}
        onCancel={onSqlClose}
        width={800}
        footer={[
          <Button
            key="copy"
            type="primary"
            onClick={() => {
              navigator.clipboard.writeText(sqlContent);
            }}
          >
            Скопировать SQL
          </Button>,
          <Button key="close" onClick={onSqlClose}>
            Закрыть
          </Button>,
        ]}
      >
        <Alert
          message="Обнаружены неизвестные единицы измерения"
          description="Выполните следующий SQL запрос в Supabase SQL Editor, затем повторите импорт файла."
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Paragraph>
          <pre style={{
            background: theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
            color: theme === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.88)',
            padding: 12,
            borderRadius: 4,
            overflow: 'auto',
            maxHeight: 400,
            fontSize: 12,
            border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
            fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace'
          }}>
            {sqlContent}
          </pre>
        </Paragraph>
      </Modal>

      {/* Модальное окно с ошибками импорта */}
      <Modal
        title="Ошибки импорта"
        open={importErrors.length > 0}
        onCancel={onImportErrorsClose}
        footer={[
          <Button key="close" onClick={onImportErrorsClose}>
            Закрыть
          </Button>,
        ]}
        width={600}
      >
        <Alert
          message="Импорт завершен с ошибками"
          description="Исправьте указанные ошибки в файле и повторите импорт."
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {importErrors.map((error, index) => (
            <Alert
              key={index}
              message={error}
              type="warning"
              style={{ marginBottom: 8 }}
            />
          ))}
        </div>
      </Modal>

      {/* Модальное окно добавления категории */}
      <Modal
        title="Добавить категорию затрат"
        open={addCategoryModalOpen}
        onOk={onAddCategorySave}
        onCancel={onAddCategoryCancel}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={addCategoryForm} layout="vertical">
          <Form.Item
            name="name"
            label="Наименование категории"
            rules={[{ required: true, message: 'Введите наименование категории' }]}
          >
            <Input placeholder="Например: Земляные работы" />
          </Form.Item>
          <Form.Item
            name="unit"
            label="Единица измерения"
            rules={[{ required: true, message: 'Выберите единицу измерения' }]}
          >
            <Select placeholder="Выберите единицу">
              {unitsData.map(unit => (
                <Select.Option key={unit.code} value={unit.code}>
                  {unit.name} ({unit.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Модальное окно добавления детализации */}
      <Modal
        title={`Добавить детализацию в "${selectedCategory?.structure}"`}
        open={addDetailModalOpen}
        onOk={onAddDetailSave}
        onCancel={onAddDetailCancel}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={addDetailForm} layout="vertical">
          <Form.Item
            name="name"
            label="Наименование детализации"
            rules={[{ required: true, message: 'Введите наименование детализации' }]}
          >
            <Input placeholder="Например: Разработка грунта" />
          </Form.Item>
          <Form.Item
            name="unit"
            label="Единица измерения"
            rules={[{ required: true, message: 'Выберите единицу измерения' }]}
          >
            <Select placeholder="Выберите единицу">
              {unitsData.map(unit => (
                <Select.Option key={unit.code} value={unit.code}>
                  {unit.name} ({unit.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="location"
            label="Локализация"
            rules={[{ required: true, message: 'Введите локализацию' }]}
          >
            <Input placeholder="Например: Секция А" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модальное окно добавления локализации */}
      <Modal
        title={`Добавить локализацию для "${selectedDetail?.structure}"`}
        open={addLocationModalOpen}
        onOk={onAddLocationSave}
        onCancel={onAddLocationCancel}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form form={addLocationForm} layout="vertical">
          <Form.Item
            name="location"
            label="Локализация"
            rules={[{ required: true, message: 'Введите локализацию' }]}
          >
            <Input placeholder="Например: Секция Б" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
