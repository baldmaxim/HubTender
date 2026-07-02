import React, { useState, useRef } from 'react';
import { Tabs, Input, Button, Space } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import MaterialsTab, { type MaterialsTabHandle } from './MaterialsTab/MaterialsTab';
import WorksTab, { type WorksTabHandle } from './WorksTab/WorksTab';

const Library: React.FC = () => {
  const [activeTab, setActiveTab] = useState('materials');
  const [searchText, setSearchText] = useState('');
  const materialsTabRef = useRef<MaterialsTabHandle>(null);
  const worksTabRef = useRef<WorksTabHandle>(null);

  const handleAdd = () => {
    if (activeTab === 'materials' && materialsTabRef.current) {
      materialsTabRef.current.handleAdd();
    } else if (activeTab === 'works' && worksTabRef.current) {
      worksTabRef.current.handleAdd();
    }
  };

  const tabItems = [
    {
      key: 'materials',
      label: 'Материалы',
      children: <MaterialsTab ref={materialsTabRef} searchText={searchText} />
    },
    {
      key: 'works',
      label: 'Работы',
      children: <WorksTab ref={worksTabRef} searchText={searchText} />
    }
  ];

  return (
    <div style={{ margin: '-16px', padding: '24px' }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSearchText(''); // Очищаем поиск при смене вкладки
        }}
        items={tabItems}
        size="large"
        tabBarExtraContent={
          <Space>
            <Input
              placeholder="Поиск..."
              prefix={<SearchOutlined />}
              style={{ width: 250 }}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
            >
              {activeTab === 'materials' ? 'Добавить материал' : 'Добавить работу'}
            </Button>
          </Space>
        }
      />
    </div>
  );
};

export default Library;
