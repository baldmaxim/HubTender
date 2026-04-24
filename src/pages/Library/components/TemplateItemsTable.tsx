import React from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TemplateItemWithDetails } from '../hooks/useTemplateItems';

interface TemplateItemsTableProps {
  dataSource: TemplateItemWithDetails[];
  columns: ColumnsType<TemplateItemWithDetails>;
  rowClassName: (record: TemplateItemWithDetails) => string;
}

export const TemplateItemsTable: React.FC<TemplateItemsTableProps> = ({
  dataSource,
  columns,
  rowClassName,
}) => {
  return (
    <Table
      dataSource={dataSource}
      columns={columns}
      rowKey="id"
      rowClassName={rowClassName}
      pagination={false}
      locale={{ emptyText: 'Нет данных' }}
      style={{ marginBottom: 16 }}
      size="small"
    />
  );
};
