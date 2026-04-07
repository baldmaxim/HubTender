import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Card, Tabs, Button, Space, message } from 'antd';
import { supabase } from '../../lib/supabase';
import { UploadOutlined, PlusOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations, TenderRegistry } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenderData } from './hooks/useTenderData';
import { useTenderCRUD } from './hooks/useTenderCRUD';
import { TenderAddForm, TenderDrawerModern } from './components';
import { TenderGrid } from './components/TenderGrid';
import ImportTendersModal from './ImportTendersModal';
import './Tenders.css';
import './TendersModern.css';

const Tenders: React.FC = () => {
  const { user } = useAuth();
  const isGeneralDirector = user?.role_code === 'general_director';
  const isDirector = user?.role_code === 'director' || isGeneralDirector;

  const [activeTab, setActiveTab] = useState<'current' | 'waiting' | 'archive'>('current');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedTender, setSelectedTender] = useState<TenderRegistryWithRelations | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { tenders, statuses, constructionScopes, tenderNumbers, loading, refetch } = useTenderData();
  const { handleMoveUp, handleMoveDown, handleArchive } = useTenderCRUD(tenders, refetch);

  // Синхронизация selectedTender с обновлёнными данными после refetch
  useEffect(() => {
    if (selectedTender && tenders.length > 0) {
      const updatedTender = tenders.find(t => t.id === selectedTender.id);
      if (updatedTender) {
        setSelectedTender(updatedTender);
      }
    }
  }, [tenders]);

  // Обработчик drag and drop сортировки
  const handleReorder = async (draggedId: string, targetId: string) => {
    const draggedIndex = tenders.findIndex((t) => t.id === draggedId);
    const targetIndex = tenders.findIndex((t) => t.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const draggedTender = tenders[draggedIndex];
    const targetTender = tenders[targetIndex];

    // Swap sort_order
    const { error: error1 } = await supabase
      .from('tender_registry')
      .update({ sort_order: targetTender.sort_order })
      .eq('id', draggedTender.id);

    const { error: error2 } = await supabase
      .from('tender_registry')
      .update({ sort_order: draggedTender.sort_order })
      .eq('id', targetTender.id);

    if (!error1 && !error2) {
      refetch();
    } else {
      message.error('Ошибка при изменении порядка');
    }
  };

  // Фильтрация тендеров по активной вкладке
  const filteredTenders = useMemo(() => {
    return tenders.filter((t) => {
      if (activeTab === 'current') {
        // Текущие: не архивные и не в ожидании
        return !t.is_archived && (t.status as any)?.name !== 'Ожидаем тендерный пакет';
      }
      if (activeTab === 'waiting') {
        // В ожидании: не архивные и статус "Ожидаем тендерный пакет"
        return !t.is_archived && (t.status as any)?.name === 'Ожидаем тендерный пакет';
      }
      // Архив
      return t.is_archived;
    });
  }, [tenders, activeTab]);

  const handleRowClick = (record: TenderRegistryWithRelations) => {
    // Сохранить текущую позицию прокрутки
    if (tableContainerRef.current) {
      setScrollPosition(tableContainerRef.current.scrollTop);
    }

    // Если кликнули на уже выбранную строку - закрыть drawer
    if (selectedTender?.id === record.id && drawerVisible) {
      setDrawerVisible(false);
      setSelectedTender(null);
      return;
    }

    // Обновляем выбранный тендер и открываем/обновляем Drawer
    setSelectedTender(record);
    setDrawerVisible(true);
  };

  const handleDrawerClose = () => {
    setDrawerVisible(false);
    setSelectedTender(null);

    // Восстановить прокрутку после анимации закрытия
    setTimeout(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTop = scrollPosition;
      }
    }, 300);
  };

  const handlePageChange = (page: number, size: number) => {
    if (size !== pageSize) {
      setPageSize(size);
      setCurrentPage(1);
      return;
    }

    setCurrentPage(page);
  };

  return (
    <div className="tenders-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Card
          title="Перечень тендеров"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0 }}
          styles={{ body: { flex: 1, overflow: 'auto', padding: '16px' } }}
          extra={
            !isDirector && activeTab === 'current' && (
              <Space>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? 'Скрыть форму' : 'Добавить тендер'}
                </Button>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => setImportModalOpen(true)}
                >
                  Импорт из Excel
                </Button>
              </Space>
            )
          }
        >
          <Tabs
            activeKey={activeTab}
            onChange={(key) => { setActiveTab(key as 'current' | 'waiting' | 'archive'); setCurrentPage(1); }}
            items={[
              {
                key: 'current',
                label: `Текущие (${tenders.filter((t) => !t.is_archived && (t.status as any)?.name !== 'Ожидаем тендерный пакет').length})`,
                children: (
                  <>
                    {/* Inline-форма добавления (только во вкладке "Текущие") */}
                    {!isDirector && showAddForm && (
                      <TenderAddForm
                        statuses={statuses}
                        constructionScopes={constructionScopes}
                        tenderNumbers={tenderNumbers}
                        onSuccess={() => {
                          refetch();
                          setShowAddForm(false);
                        }}
                        onCancel={() => setShowAddForm(false)}
                      />
                    )}

                    {/* Таблица текущих тендеров */}
                    <div ref={tableContainerRef} className="tenders-table-wrapper">
                      <TenderGrid
                        dataSource={filteredTenders}
                        loading={loading}
                        currentPage={currentPage}
                        pageSize={pageSize}
                        totalCount={filteredTenders.length}
                        onPageChange={handlePageChange}
                        onRowClick={handleRowClick}
                        onReorder={handleReorder}
                      />
                    </div>
                  </>
                ),
              },
              {
                key: 'waiting',
                label: `В ожидании (${tenders.filter((t) => !t.is_archived && (t.status as any)?.name === 'Ожидаем тендерный пакет').length})`,
                children: (
                  <div ref={tableContainerRef} className="tenders-table-wrapper">
                    <TenderGrid
                      dataSource={filteredTenders}
                      loading={loading}
                      currentPage={currentPage}
                      pageSize={pageSize}
                      totalCount={filteredTenders.length}
                      onPageChange={handlePageChange}
                      onRowClick={handleRowClick}
                      onReorder={handleReorder}
                    />
                  </div>
                ),
              },
              {
                key: 'archive',
                label: `Архив (${tenders.filter((t) => t.is_archived).length})`,
                children: (
                  <div ref={tableContainerRef} className="tenders-table-wrapper">
                    <TenderGrid
                      dataSource={filteredTenders}
                      loading={loading}
                      currentPage={currentPage}
                      pageSize={pageSize}
                      totalCount={filteredTenders.length}
                      onPageChange={handlePageChange}
                      onRowClick={handleRowClick}
                      onReorder={handleReorder}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>

      {/* Drawer без разрыва */}
      {drawerVisible && (
        <TenderDrawerModern
          open={drawerVisible}
          tender={selectedTender}
          statuses={statuses}
          constructionScopes={constructionScopes}
          onClose={handleDrawerClose}
          onUpdate={refetch}
          readOnly={isGeneralDirector}
        />
      )}

      {/* Import Modal */}
      <ImportTendersModal
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onSuccess={() => {
          setImportModalOpen(false);
          refetch();
        }}
        constructionScopes={constructionScopes}
        statuses={statuses}
      />
    </div>
  );
};

export default Tenders;
