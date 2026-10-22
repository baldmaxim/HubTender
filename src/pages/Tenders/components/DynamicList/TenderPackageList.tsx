import React from 'react';
import { Form, DatePicker, Input, Space, List, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { FormInstance } from 'antd';
import type { TenderPackageItem } from '../../../../lib/types';
import { DATE_INPUT_FORMATS, getPackageLinkHref } from '../../utils/tenderMonitor';

const { Text } = Typography;

interface TenderPackageListProps {
  editable: boolean;
  items?: TenderPackageItem[];
  form?: FormInstance;
  fieldName?: string;
}

export const TenderPackageList: React.FC<TenderPackageListProps> = ({
  editable,
  items = [],
  form,
  fieldName = 'tender_package_items',
}) => {
  void form;

  if (!editable) {
    if (items.length === 0) {
      return <Text type="secondary">Нет записей</Text>;
    }

    return (
      <List
        size="small"
        dataSource={items}
        style={{ padding: 0 }}
        renderItem={(item, index) => {
          const href = getPackageLinkHref(item.link);

          return (
            <List.Item style={{ padding: '4px 0', border: 'none' }}>
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text strong>
                  {index + 1}) {item.date ? dayjs(item.date).format('DD.MM.YYYY') : 'Без даты'}
                </Text>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {item.text}
                  </a>
                ) : (
                  <Text>{item.text}</Text>
                )}
              </Space>
            </List.Item>
          );
        }}
      />
    );
  }

  return (
    <Form.List name={fieldName}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name, ...restField }) => (
            <div key={key} className="tm-dyn-row tm-dyn-row--package">
              <Form.Item {...restField} name={[name, 'date']}>
                <DatePicker format={DATE_INPUT_FORMATS} placeholder="Выберите дату" aria-label="Дата" />
              </Form.Item>

              <Form.Item
                {...restField}
                name={[name, 'text']}
                rules={[{ required: true, message: 'Введите наименование' }]}
              >
                <Input.TextArea
                  placeholder="Наименование"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  allowClear
                  aria-label="Наименование"
                />
              </Form.Item>

              <Form.Item {...restField} name={[name, 'link']}>
                <Input allowClear placeholder="Ссылка" aria-label="Ссылка" />
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
            onClick={() => add({ date: null, text: '', link: '' })}
          >
            <PlusOutlined aria-hidden />
            Добавить строку
          </button>
        </>
      )}
    </Form.List>
  );
};
