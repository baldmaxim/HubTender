import React, { useState, useEffect, useRef } from 'react';
import { Tabs, Button, Space, Input } from 'antd';
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import type { TabsProps } from 'antd';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import { useMaterials } from './hooks/useMaterials.tsx';
import { useWorks } from './hooks/useWorks.tsx';
import { useUnits } from './hooks/useUnits.tsx';
import { MaterialsTab, type MaterialsTabRef } from './components/MaterialsTab';
import { WorksTab, type WorksTabRef } from './components/WorksTab';
import { UnitsTab, type UnitsTabRef } from './components/UnitsTab';
import { NomenclatureImport } from './components/NomenclatureImport';
import './Nomenclatures.css';

const unitColors: Record<string, string> = {
  'шт': 'blue',
  'м': 'green',
  'м2': 'cyan',
  'м3': 'purple',
  'кг': 'orange',
  'т': 'red',
  'л': 'magenta',
  'компл': 'volcano',
  'м.п.': 'geekblue',
};

const Nomenclatures: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState('materials');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<'materials' | 'works'>('materials');

  const materialsTabRef = useRef<MaterialsTabRef>(null);
  const worksTabRef = useRef<WorksTabRef>(null);
  const unitsTabRef = useRef<UnitsTabRef>(null);

  const materials = useMaterials();
  const works = useWorks();
  const units = useUnits();

  useEffect(() => {
    materials.loadMaterials();
    works.loadWorks();
    units.loadUnits();
    units.loadUnitsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native WS hub — обновляем справочники при любом изменении (topic `references`
  // покрывает materials/works library, material/work names, units; bulk-импорт
  // шлёт одно statement-level событие).
  useRealtimeTopic('references', () => {
    void materials.loadMaterials();
    void works.loadWorks();
    void units.loadUnits();
    void units.loadUnitsList();
  });

  const filteredMaterialsData = materials.materialsData.filter(item =>
    searchText === '' || item.name.toLowerCase().includes(searchText.toLowerCase())
  );

  const filteredWorksData = works.worksData.filter(item =>
    searchText === '' || item.name.toLowerCase().includes(searchText.toLowerCase())
  );

  const filteredUnitsData = units.unitsData.filter(item =>
    searchText === '' ||
    item.name.toLowerCase().includes(searchText.toLowerCase()) ||
    item.code.toLowerCase().includes(searchText.toLowerCase())
  );

  const handlePageChange = (page: number, newPageSize: number) => {
    setCurrentPage(page);
    if (newPageSize !== pageSize) {
      setPageSize(newPageSize);
      setCurrentPage(1);
    }
  };

  const handleAddClick = () => {
    if (activeTab === 'materials') {
      materialsTabRef.current?.openAddModal();
    } else if (activeTab === 'works') {
      worksTabRef.current?.openAddModal();
    } else if (activeTab === 'units') {
      unitsTabRef.current?.openAddModal();
    }
  };

  const tabItems: TabsProps['items'] = [
    {
      key: 'materials',
      label: 'Материалы',
      children: (
        <MaterialsTab
          ref={materialsTabRef}
          data={filteredMaterialsData}
          loading={materials.loading}
          unitsList={units.unitsList}
          unitColors={unitColors}
          currentPage={currentPage}
          pageSize={pageSize}
          showDuplicatesOnly={materials.showDuplicatesOnly}
          duplicatesCount={materials.duplicatesCount}
          onDelete={materials.deleteMaterial}
          onSave={materials.saveMaterial}
          onPageChange={handlePageChange}
          onToggleDuplicates={materials.toggleDuplicatesFilter}
          onDeleteDuplicates={materials.deleteAllDuplicates}
        />
      ),
    },
    {
      key: 'works',
      label: 'Работы',
      children: (
        <WorksTab
          ref={worksTabRef}
          data={filteredWorksData}
          loading={works.loading}
          unitsList={units.unitsList}
          unitColors={unitColors}
          currentPage={currentPage}
          pageSize={pageSize}
          showDuplicatesOnly={works.showDuplicatesOnly}
          duplicatesCount={works.duplicatesCount}
          onDelete={works.deleteWork}
          onSave={works.saveWork}
          onPageChange={handlePageChange}
          onToggleDuplicates={works.toggleDuplicatesFilter}
          onDeleteDuplicates={works.deleteAllDuplicates}
        />
      ),
    },
    {
      key: 'units',
      label: 'Единицы измерения',
      children: (
        <UnitsTab
          ref={unitsTabRef}
          data={filteredUnitsData}
          loading={units.loading}
          unitColors={unitColors}
          currentPage={currentPage}
          pageSize={pageSize}
          onDelete={units.deleteUnit}
          onSave={units.saveUnit}
          onPageChange={handlePageChange}
        />
      ),
    },
  ];

  return (
    <div
      className="nomenclatures-page"
      style={{
        margin: '-16px',
        padding: '24px',
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Tabs
        defaultActiveKey="materials"
        items={tabItems}
        size="large"
        onChange={(key) => setActiveTab(key)}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column'
        }}
        tabBarExtraContent={
          <Space>
            <Input
              placeholder="Поиск..."
              prefix={<SearchOutlined />}
              style={{ width: 400 }}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddClick}>
              Добавить
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={() => {
                setImportMode(activeTab === 'materials' ? 'materials' : 'works');
                setImportModalOpen(true);
              }}
            >
              Импорт из Excel
            </Button>
          </Space>
        }
      />

      <NomenclatureImport
        open={importModalOpen}
        mode={importMode}
        onClose={(success) => {
          setImportModalOpen(false);
          if (success) {
            if (importMode === 'materials') {
              materials.loadMaterials();
            } else {
              works.loadWorks();
            }
          }
        }}
      />
    </div>
  );
};

export default Nomenclatures;
