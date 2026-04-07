import React, { useState, useMemo, useCallback } from 'react';
import { Table, Tabs, message } from 'antd';
import TenderModal from './TenderModal';
import UploadBOQModal from './UploadBOQModal';
import { VersionMatchModal } from './VersionMatch';
import { useTendersData, type TenderRecord } from './hooks/useTendersData';
import { useTenderActions } from './hooks/useTenderActions';
import { getTendersTableColumns } from './components/TendersTableColumns';
import { getTendersActionMenu } from './components/TendersActionMenu';
import { TendersToolbar } from './components/TendersToolbar';
import type { Tender } from '../../../lib/supabase';
import './Tenders.css';

const Tenders: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'active' | 'archive'>('active');
  const [searchText, setSearchText] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [uploadBOQVisible, setUploadBOQVisible] = useState(false);
  const [selectedTenderForUpload, setSelectedTenderForUpload] = useState<TenderRecord | null>(null);
  const [versionMatchVisible, setVersionMatchVisible] = useState(false);
  const [selectedTenderForVersion, setSelectedTenderForVersion] = useState<Tender | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { tendersData, loading, fetchTenders } = useTendersData();
  const actions = useTenderActions(fetchTenders);

  const handleOpenUploadBOQ = useCallback((record: TenderRecord) => {
    setSelectedTenderForUpload(record);
    setUploadBOQVisible(true);
  }, []);

  const handleCloseUploadBOQ = () => {
    setUploadBOQVisible(false);
    setSelectedTenderForUpload(null);
  };

  const handleUploadSuccess = () => {
    message.success('Позиции заказчика успешно загружены');
  };

  const handleExportAll = () => {
    message.success('Экспорт всех тендеров начат');
  };

  const handleCopy = (record: TenderRecord) => {
    message.success(`Тендер скопирован: ${record.tender}`);
  };

  const handleArchive = (record: TenderRecord) => {
    actions.handleArchive(record);
  };

  const handleUnarchive = (record: TenderRecord) => {
    actions.handleUnarchive(record);
  };

  const handleExport = (record: TenderRecord) => {
    message.success(`Экспорт тендера: ${record.tender}`);
  };

  const handleNewVersion = useCallback((record: TenderRecord) => {
    setSelectedTenderForVersion(record.raw as Tender);
    setVersionMatchVisible(true);
  }, []);

  const getActionMenu = useCallback((record: TenderRecord) => {
    return getTendersActionMenu({
      record,
      onEdit: actions.handleEdit,
      onDelete: actions.handleDelete,
      onCopy: handleCopy,
      onNewVersion: handleNewVersion,
      onArchive: handleArchive,
      onUnarchive: handleUnarchive,
      onExport: handleExport,
      isArchived: record.is_archived || false,
    });
  }, [actions.handleEdit, actions.handleDelete, handleNewVersion, handleArchive, handleUnarchive]);

  const columns = useMemo(() => getTendersTableColumns({
    onOpenUploadBOQ: handleOpenUploadBOQ,
    getActionMenu,
  }), [handleOpenUploadBOQ, getActionMenu]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

  const tabFilteredData = useMemo(() => {
    const search = searchText.toLowerCase();
    return tendersData.filter((item) => {
      if (activeTab === 'active' ? item.is_archived : !item.is_archived) return false;
      if (!search) return true;
      return (
        item.tender.toLowerCase().includes(search) ||
        item.tenderNumber.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search)
      );
    });
  }, [tendersData, searchText, activeTab]);

  const handlePaginationChange = useCallback((page: number, nextPageSize: number) => {
    if (nextPageSize !== pageSize) {
      setPageSize(nextPageSize);
      setCurrentPage(1);
      return;
    }

    setCurrentPage(page);
  }, [pageSize]);

  const paginationConfig = useMemo(() => ({
    current: currentPage,
    pageSize,
    showSizeChanger: true,
    pageSizeOptions: ['10', '25', '50', '100'],
    showTotal: (total: number) => `Всего: ${total} тендеров`,
    onChange: handlePaginationChange,
  }), [currentPage, pageSize, handlePaginationChange]);

  return (
    <div style={{ padding: '0' }}>
      <TendersToolbar
        searchText={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setCurrentPage(1);
        }}
        onExportAll={handleExportAll}
        onCreateNew={actions.handleCreateNewTender}
        onRefresh={fetchTenders}
      />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as 'active' | 'archive');
          setCurrentPage(1);
        }}
        items={[
          {
            key: 'active',
            label: 'В работе',
            children: (
              <Table
                rowSelection={rowSelection}
                columns={columns}
                dataSource={tabFilteredData}
                loading={loading}
                pagination={paginationConfig}
                scroll={{ x: 'max-content' }}
                size="small"
                locale={{
                  emptyText: 'Нет активных тендеров для отображения.',
                }}
                className="tenders-table"
                style={{
                  borderRadius: 8,
                }}
              />
            ),
          },
          {
            key: 'archive',
            label: 'Архив',
            children: (
              <Table
                rowSelection={rowSelection}
                columns={columns}
                dataSource={tabFilteredData}
                loading={loading}
                pagination={paginationConfig}
                scroll={{ x: 'max-content' }}
                size="small"
                locale={{
                  emptyText: 'Нет архивных тендеров для отображения.',
                }}
                className="tenders-table"
                style={{
                  borderRadius: 8,
                }}
              />
            ),
          },
        ]}
      />

      <TenderModal
        visible={actions.isModalVisible}
        form={actions.form}
        onOk={actions.handleModalOk}
        onCancel={actions.handleModalCancel}
        isEditMode={actions.isEditMode}
      />

      {selectedTenderForUpload && (
        <UploadBOQModal
          visible={uploadBOQVisible}
          tenderId={selectedTenderForUpload.id}
          tenderName={selectedTenderForUpload.tender}
          onCancel={handleCloseUploadBOQ}
          onSuccess={handleUploadSuccess}
        />
      )}

      <VersionMatchModal
        open={versionMatchVisible}
        onClose={() => {
          setVersionMatchVisible(false);
          setSelectedTenderForVersion(null);
          fetchTenders();
        }}
        tender={selectedTenderForVersion}
      />
    </div>
  );
};

export default Tenders;
