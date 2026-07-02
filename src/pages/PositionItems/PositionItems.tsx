import { useState, useMemo, memo } from 'react';
import { Card, Tabs } from 'antd';
import { useParams } from 'react-router-dom';
import WorkEditForm from './WorkEditForm';
import MaterialEditForm from './MaterialEditForm';
import { useBoqItems } from './hooks/useBoqItems';
import { useItemActions } from './hooks/useItemActions';
import { useItemBulkActions } from './hooks/useItemBulkActions';
import { usePositionTabTitle } from './hooks/usePositionTabRegistration';
import ItemsTable, { ITEMS_PLAIN_FIT_WIDTH } from './components/ItemsTable';
import ItemsMobileCards from './components/ItemsMobileCards';
import ItemsToolbar from './components/ItemsToolbar';
import PositionHeader from './components/PositionHeader';
import PositionLandscapeInfo from './components/PositionLandscapeInfo';
import AddItemForm from './components/AddItemForm';
import TemplateSelectModal from './components/TemplateSelectModal';
import AuditHistoryTab from './components/AuditHistoryTab';
import { BoqItemsImportModal } from './components/BoqItemsImportModal';
import { useDeadlineCheck } from '../../hooks/useDeadlineCheck';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../components/responsive/LandscapeTableOverlay';

interface PositionItemsProps {
  /** Передаётся из WorkspaceKeepAlive (несколько экземпляров смонтированы сразу —
   *  нельзя полагаться на useParams). Fallback на useParams для прямого роутинга. */
  positionId?: string;
}

const PositionItems: React.FC<PositionItemsProps> = ({ positionId: propPositionId }) => {
  const params = useParams<{ positionId: string }>();
  const positionId = propPositionId ?? params.positionId;
  const { user } = useAuth();
  const { isPhone, isLandscapePhone, isMobile, isPhoneDevice } = useIsMobile();
  const { theme } = useTheme();

  const [workSearchText, setWorkSearchText] = useState<string>('');
  const [materialSearchText, setMaterialSearchText] = useState<string>('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [templateModalVisible, setTemplateModalVisible] = useState<boolean>(false);
  const [importModalVisible, setImportModalVisible] = useState<boolean>(false);
  const [selectedCostCategoryId, setSelectedCostCategoryId] = useState<string | null>(null);
  const [costSearchText, setCostSearchText] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('current');
  const [isDeleteMode, setIsDeleteMode] = useState<boolean>(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);

  const {
    position,
    items,
    works,
    materials,
    templates,
    loading,
    currencyRates,
    costCategories,
    workNames,
    materialNames,
    units,
    gpVolume,
    setGpVolume,
    gpNote,
    setGpNote,
    workName,
    setWorkName,
    unitCode,
    setUnitCode,
    getCurrencyRate,
    fetchPositionData,
    fetchItems,
  } = useBoqItems(positionId, isPhoneDevice);

  // Обновление заголовка вкладки приложения для этой позиции
  usePositionTabTitle(positionId, position);

  // Проверка дедлайна для блокировки редактирования
  const { canEdit: canEditByDeadline, loading: deadlineLoading } =
    useDeadlineCheck(position?.tender_id);
  const isReadOnlyByDeadline = !canEditByDeadline || deadlineLoading;

  // На телефоне (любая ориентация) страница — только для просмотра
  const readOnly = isReadOnlyByDeadline || isMobile || isLandscapePhone;

  const {
    handleAddWork,
    handleAddMaterial,
    handleAddTemplate,
    handleFormSave,
    handleSaveGPData,
    handleSaveAdditionalWorkData,
    handleMoveItem,
  } = useItemActions({
    position,
    works,
    materials,
    items,
    getCurrencyRate,
    fetchItems,
    readOnly: isReadOnlyByDeadline,
  });

  const { handleBulkDelete, handleClearAllItems, handleApplyCostToAll, getCostCategoryOptions } =
    useItemBulkActions({
      positionId,
      items,
      userId: user?.id,
      fetchItems,
      costCategories,
      costSearchText,
      selectedCostCategoryId,
      setSelectedCostCategoryId,
      setCostSearchText,
      selectedDeleteIds,
      setIsDeleteMode,
      setSelectedDeleteIds,
      setIsBulkDeleting,
    });

  const totalSum = useMemo(
    () => items.reduce((sum, item) => sum + (item.total_amount || 0), 0),
    [items],
  );

  const handleEditClick = (record: { id: string }) => setExpandedRowKeys([record.id]);

  const onFormSave = async (data: Record<string, unknown>) => {
    await handleFormSave(data, expandedRowKeys, items, () => setExpandedRowKeys([]));
  };
  const onFormCancel = () => setExpandedRowKeys([]);

  const onSaveGPData = async () => {
    if (positionId) await handleSaveGPData(positionId, gpVolume, gpNote, fetchPositionData);
  };
  const onSaveAdditionalWorkData = async () => {
    if (positionId && position?.is_additional) {
      await handleSaveAdditionalWorkData(positionId, workName, unitCode, fetchPositionData);
    }
  };

  const handleStartDelete = (id: string) => {
    setExpandedRowKeys([]);
    setIsDeleteMode(true);
    setSelectedDeleteIds(new Set([id]));
  };
  const handleToggleDeleteSelection = (id: string) => {
    setSelectedDeleteIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const handleCancelDeleteMode = () => {
    setIsDeleteMode(false);
    setSelectedDeleteIds(new Set());
  };

  if (!position) {
    return <div>Загрузка...</div>;
  }

  // Тело карточки «Элементы позиции» в зависимости от устройства/ориентации
  const itemsBody = (() => {
    if (isPhone && !isLandscapePhone) {
      return <ItemsMobileCards items={items} totalSum={totalSum} />;
    }
    if (isLandscapePhone) {
      return (
        <LandscapeTableOverlay theme={theme} fit="zoom" width={ITEMS_PLAIN_FIT_WIDTH}>
          <PositionLandscapeInfo
            position={position}
            gpVolume={gpVolume}
            gpNote={gpNote}
            workName={workName}
            unitCode={unitCode}
          />
          <ItemsTable plain readOnly items={items} loading={loading} getCurrencyRate={getCurrencyRate} />
        </LandscapeTableOverlay>
      );
    }
    return (
      <ItemsTable
        items={items}
        loading={loading}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={setExpandedRowKeys}
        onEditClick={handleEditClick}
        onStartDelete={handleStartDelete}
        onToggleDeleteSelection={handleToggleDeleteSelection}
        onMoveItem={handleMoveItem}
        getCurrencyRate={getCurrencyRate}
        isDeleteMode={isDeleteMode}
        selectedDeleteIds={selectedDeleteIds}
        readOnly={readOnly}
        expandedRowRender={(record) => {
          const isWork = ['раб', 'суб-раб', 'раб-комп.'].includes(record.boq_item_type);
          if (isWork) {
            return (
              <WorkEditForm
                record={record}
                workNames={workNames}
                costCategories={costCategories}
                currencyRates={currencyRates}
                onSave={onFormSave}
                onCancel={onFormCancel}
                readOnly={readOnly}
              />
            );
          }
          const workItems = items.filter((item) =>
            ['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type),
          );
          return (
            <MaterialEditForm
              record={record}
              materialNames={materialNames}
              workItems={workItems}
              costCategories={costCategories}
              currencyRates={currencyRates}
              gpVolume={gpVolume}
              onSave={onFormSave}
              onCancel={onFormCancel}
              readOnly={readOnly}
            />
          );
        }}
      />
    );
  })();

  return (
    <div style={{ padding: '0 8px' }}>
      <PositionHeader
        position={position}
        gpVolume={gpVolume}
        setGpVolume={setGpVolume}
        gpNote={gpNote}
        setGpNote={setGpNote}
        workName={workName}
        setWorkName={setWorkName}
        unitCode={unitCode}
        setUnitCode={setUnitCode}
        units={units}
        disabled={isReadOnlyByDeadline}
        onSaveGPData={onSaveGPData}
        onSaveAdditionalWorkData={onSaveAdditionalWorkData}
        isPhone={isPhoneDevice}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'current',
            label: 'Текущие',
            children: (
              <>
                {!isPhoneDevice && (
                  <Card title="Добавление работ и материалов" style={{ marginBottom: 16 }}>
                    <AddItemForm
                      works={works}
                      materials={materials}
                      workSearchText={workSearchText}
                      materialSearchText={materialSearchText}
                      onWorkSearchChange={setWorkSearchText}
                      onMaterialSearchChange={setMaterialSearchText}
                      onAddWork={(workNameId) => {
                        handleAddWork(workNameId);
                        setWorkSearchText('');
                      }}
                      onAddMaterial={(materialNameId) => {
                        handleAddMaterial(materialNameId);
                        setMaterialSearchText('');
                      }}
                      onOpenTemplateModal={() => setTemplateModalVisible(true)}
                      disabled={isReadOnlyByDeadline}
                    />
                  </Card>
                )}

                <Card
                  title={
                    isPhoneDevice ? (
                      <span>Элементы позиции</span>
                    ) : (
                      <ItemsToolbar
                        isDeleteMode={isDeleteMode}
                        selectedDeleteCount={selectedDeleteIds.size}
                        isBulkDeleting={isBulkDeleting}
                        onBulkDelete={handleBulkDelete}
                        onCancelDeleteMode={handleCancelDeleteMode}
                        costSearchText={costSearchText}
                        setCostSearchText={setCostSearchText}
                        setSelectedCostCategoryId={setSelectedCostCategoryId}
                        selectedCostCategoryId={selectedCostCategoryId}
                        getCostCategoryOptions={getCostCategoryOptions}
                        onApplyCostToAll={handleApplyCostToAll}
                        onOpenImport={() => setImportModalVisible(true)}
                        onClearAll={handleClearAllItems}
                        itemsCount={items.length}
                        disabled={isReadOnlyByDeadline}
                        totalSum={totalSum}
                      />
                    )
                  }
                  styles={{ body: { padding: isPhoneDevice ? 8 : 0 } }}
                >
                  {itemsBody}
                </Card>
              </>
            ),
          },
          {
            key: 'history',
            label: 'История',
            children: <AuditHistoryTab positionId={positionId} />,
          },
        ]}
      />

      {/* Модалка выбора шаблона */}
      <TemplateSelectModal
        visible={templateModalVisible}
        templates={templates}
        onCancel={() => setTemplateModalVisible(false)}
        onSelect={(templateId) => {
          handleAddTemplate(templateId, () => {});
          setTemplateModalVisible(false);
        }}
      />

      {/* Модалка импорта из Excel */}
      {positionId && position?.tender_id && (
        <BoqItemsImportModal
          open={importModalVisible}
          positionId={positionId}
          tenderId={position.tender_id}
          onClose={() => {
            setImportModalVisible(false);
            // Обновляем всегда: при ошибке часть элементов уже вставлена
            // (вставка идёт по одному), иначе они не появятся до перезагрузки.
            fetchItems();
          }}
        />
      )}
    </div>
  );
};

// Стили для подсветки строк по типу
const styles = `
  .boq-row-rab {
    background-color: rgba(255, 152, 0, 0.15) !important;
  }
  .boq-row-rab > td.ant-table-cell-fix-left {
    background-color: rgba(255, 152, 0, 0.15) !important;
  }
  .boq-row-rab:hover > td {
    background-color: rgba(255, 152, 0, 0.25) !important;
  }
  .boq-row-sub-rab {
    background-color: rgba(156, 39, 176, 0.15) !important;
  }
  .boq-row-sub-rab > td.ant-table-cell-fix-left {
    background-color: rgba(156, 39, 176, 0.15) !important;
  }
  .boq-row-sub-rab:hover > td {
    background-color: rgba(156, 39, 176, 0.25) !important;
  }
  .boq-row-rab-comp {
    background-color: rgba(244, 67, 54, 0.15) !important;
  }
  .boq-row-rab-comp > td.ant-table-cell-fix-left {
    background-color: rgba(244, 67, 54, 0.15) !important;
  }
  .boq-row-rab-comp:hover > td {
    background-color: rgba(244, 67, 54, 0.25) !important;
  }
  .boq-row-mat {
    background-color: rgba(33, 150, 243, 0.15) !important;
  }
  .boq-row-mat > td.ant-table-cell-fix-left {
    background-color: rgba(33, 150, 243, 0.15) !important;
  }
  .boq-row-mat:hover > td {
    background-color: rgba(33, 150, 243, 0.25) !important;
  }
  .boq-row-sub-mat {
    background-color: rgba(156, 204, 101, 0.15) !important;
  }
  .boq-row-sub-mat > td.ant-table-cell-fix-left {
    background-color: rgba(156, 204, 101, 0.15) !important;
  }
  .boq-row-sub-mat:hover > td {
    background-color: rgba(156, 204, 101, 0.25) !important;
  }
  .boq-row-mat-comp {
    background-color: rgba(0, 137, 123, 0.15) !important;
  }
  .boq-row-mat-comp > td.ant-table-cell-fix-left {
    background-color: rgba(0, 137, 123, 0.15) !important;
  }
  .boq-row-mat-comp:hover > td {
    background-color: rgba(0, 137, 123, 0.25) !important;
  }
`;

if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}

// memo: в keep-alive смонтировано несколько экземпляров (по вкладке на позицию);
// positionId стабилен, поэтому скрытые вкладки не перерендериваются при open/close.
export default memo(PositionItems);
