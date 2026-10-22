import React from 'react';
import { Form, DatePicker, Input, Space, List, Select, Tag, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { FormInstance } from 'antd';
import type { ChronologyItem } from '../../../../lib/types';
import { textareaEnterToSave } from '../../../../utils/keyboardSave';
import { DATE_INPUT_FORMATS } from '../../utils/tenderMonitor';

const { Text } = Typography;

interface ChronologyListProps {
  editable: boolean;
  items?: ChronologyItem[];
  form?: FormInstance;
  fieldName?: string;
}

export const ChronologyList: React.FC<ChronologyListProps> = ({
  editable,
  items = [],
  form,
  fieldName = 'chronology_items',
}) => {
  if (!editable) {
    if (items.length === 0) {
      return <Text type="secondary">Нет записей</Text>;
    }

    return (
      <List
        size="small"
        dataSource={items}
        style={{ padding: 0 }}
        renderItem={(item, index) => (
          <List.Item style={{ padding: '4px 0', border: 'none' }}>
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              <Space size={8} wrap>
                <Text strong>
                  {index + 1}) {item.date ? dayjs(item.date).format('DD.MM.YYYY') : 'Без даты'}
                </Text>
                {item.type === 'call_follow_up' ? <Tag color="error">Звонок</Tag> : null}
              </Space>
              <Text>{item.text}</Text>
            </Space>
          </List.Item>
        )}
      />
    );
  }

  return (
    <Form.List name={fieldName}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...restField }) => (
            <div key={key} className="tm-dyn-row tm-dyn-row--chronology">
              <Form.Item {...restField} name={[name, 'type']} initialValue="default">
                <Select
                  options={[
                    { value: 'default', label: 'Событие' },
                    { value: 'call_follow_up', label: 'Звонок' },
                  ]}
                  aria-label="Тип события"
                />
              </Form.Item>

              <Form.Item {...restField} name={[name, 'date']}>
                <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" aria-label="Дата события" />
              </Form.Item>

              <Form.Item
                {...restField}
                name={[name, 'text']}
                rules={[{ required: true, message: 'Введите текст события' }]}
              >
                <Input.TextArea
                  placeholder="Описание события"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  allowClear
                  onKeyDown={textareaEnterToSave(
                    () => form?.submit(),
                    (v) => form?.setFieldValue([fieldName, name, 'text'], v)
                  )}
                />
              </Form.Item>

              <button
                type="button"
                className="tm-btn tm-btn--icon tm-btn--delete"
                onClick={() => remove(name)}
                aria-label="Удалить строку"
                title="Удалить строку"
              >
                <DeleteOutlined aria-hidden />
              </button>
            </div>
          ))}

          <button
            type="button"
            className="tm-btn tm-btn--small"
            onClick={() => add({ date: null, text: '', type: 'default' })}
          >
            <PlusOutlined aria-hidden />
            Добавить строку
          </button>
        </>
      )}
    </Form.List>
  );
};
