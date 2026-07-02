import React from 'react';
import { Card, Typography, Space, Form, Input, Button, List, Tag, Divider, Modal } from 'antd';
import { SaveOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, EditOutlined, CloseOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { MarkupParameter } from '../../../../lib/types';

const { Title, Text } = Typography;

/** Вкладка «Управление параметрами»: список параметров наценок с inline-
 *  редактированием, изменением порядка и модалкой добавления. */
export const ParametersTab: React.FC<{
  markupParameters: MarkupParameter[];
  editingParameterId: string | null;
  editingParameterLabel: string;
  setEditingParameterLabel: (label: string) => void;
  onInlineEdit: (parameter: MarkupParameter) => void;
  onInlineSave: (parameterId: string) => void;
  onInlineCancel: () => void;
  onDeleteParameter: (parameter: MarkupParameter) => void;
  onMoveParameterUp: (parameter: MarkupParameter) => void;
  onMoveParameterDown: (parameter: MarkupParameter) => void;
  isAddParameterModalOpen: boolean;
  newParameterForm: FormInstance;
  onAddParameter: () => void;
  onOpenParameterModal: () => void;
  onCloseParameterModal: () => void;
}> = ({
  markupParameters,
  editingParameterId,
  editingParameterLabel,
  setEditingParameterLabel,
  onInlineEdit,
  onInlineSave,
  onInlineCancel,
  onDeleteParameter,
  onMoveParameterUp,
  onMoveParameterDown,
  isAddParameterModalOpen,
  newParameterForm,
  onAddParameter,
  onOpenParameterModal,
  onCloseParameterModal,
}) => (
  <>
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>
            Управление параметрами наценок
          </Title>
          <Text type="secondary" style={{ fontSize: '14px' }}>
            Добавление новых параметров наценок в систему
          </Text>
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onOpenParameterModal}
        >
          Добавить параметр
        </Button>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text>
            Здесь вы можете управлять параметрами наценок: добавлять новые, редактировать существующие, изменять порядок отображения или удалять ненужные.
            Изменения вступают в силу немедленно и отображаются во всех формах автоматически.
          </Text>
        </div>

        <Divider />

        <div>
          <Title level={5}>Текущие параметры наценок ({markupParameters.length})</Title>
          <List
            size="small"
            dataSource={markupParameters}
            locale={{ emptyText: 'Нет параметров. Нажмите "Добавить параметр" для создания нового.' }}
            renderItem={(markup, index) => (
              <List.Item
                style={{
                  padding: '8px 16px',
                  backgroundColor: editingParameterId === markup.id ? '#f0f5ff' : undefined,
                  borderTop: index === 0 ? '1px solid #f0f0f0' : 'none',
                  borderBottom: '1px solid #f0f0f0',
                }}
                actions={[
                  <Button
                    key="up"
                    icon={<ArrowUpOutlined />}
                    size="small"
                    type="text"
                    disabled={index === 0}
                    onClick={() => onMoveParameterUp(markup)}
                    title="Переместить вверх"
                  />,
                  <Button
                    key="down"
                    icon={<ArrowDownOutlined />}
                    size="small"
                    type="text"
                    disabled={index === markupParameters.length - 1}
                    onClick={() => onMoveParameterDown(markup)}
                    title="Переместить вниз"
                  />,
                  <Button
                    key="delete"
                    icon={<DeleteOutlined />}
                    size="small"
                    type="text"
                    danger
                    onClick={() => onDeleteParameter(markup)}
                    title="Удалить"
                  />,
                ]}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <Tag color="blue" style={{ margin: 0 }}>#{index + 1}</Tag>
                  {editingParameterId === markup.id ? (
                    <Input
                      value={editingParameterLabel}
                      onChange={(e) => setEditingParameterLabel(e.target.value)}
                      onPressEnter={() => onInlineSave(markup.id)}
                      onBlur={() => onInlineCancel()}
                      autoFocus
                      style={{ flex: 1, maxWidth: '400px' }}
                      suffix={
                        <Space size={4}>
                          <Button
                            type="text"
                            size="small"
                            icon={<SaveOutlined />}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              onInlineSave(markup.id);
                            }}
                            style={{ color: '#52c41a' }}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              onInlineCancel();
                            }}
                          />
                        </Space>
                      }
                    />
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Text
                        strong
                        style={{ cursor: 'pointer' }}
                        onClick={() => onInlineEdit(markup)}
                        title="Нажмите для редактирования"
                      >
                        {markup.label}
                      </Text>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => onInlineEdit(markup)}
                        title="Редактировать"
                        style={{ padding: '0 4px' }}
                      />
                    </div>
                  )}
                  <Text type="secondary" code style={{ fontSize: '12px' }}>{markup.key}</Text>
                </div>
              </List.Item>
            )}
          />
        </div>
      </Space>
    </Card>

    {/* Модальное окно для добавления нового параметра */}
    <Modal
      title="Добавление нового параметра наценки"
      open={isAddParameterModalOpen}
      onCancel={onCloseParameterModal}
      footer={null}
      width={800}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Form
          form={newParameterForm}
          layout="vertical"
        >
          <Form.Item
            label="Ключ параметра"
            name="parameterKey"
            rules={[
              { required: true, message: 'Введите ключ параметра' },
              {
                pattern: /^[a-z0-9_]+$/,
                message: 'Ключ должен содержать только строчные латинские буквы, цифры и подчеркивания (snake_case)'
              }
            ]}
            extra="Например: new_markup_parameter или works_16_markup"
          >
            <Input placeholder="new_markup_parameter" />
          </Form.Item>

          <Form.Item
            label="Название параметра (на русском)"
            name="parameterLabel"
            rules={[{ required: true, message: 'Введите название параметра' }]}
            extra="Например: Новая наценка"
          >
            <Input placeholder="Новая наценка" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={onAddParameter}
              >
                Добавить
              </Button>
              <Button onClick={onCloseParameterModal}>
                Отмена
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  </>
);
