import { useState, useMemo } from 'react';
import { Card, Button, Typography, Tag, Input, InputNumber, Select, Modal, message, AutoComplete, Tabs } from 'antd';
import { DeleteOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import WorkEditForm from './WorkEditForm';
import MaterialEditForm from './MaterialEditForm';
import { useBoqItems } from './hooks/useBoqItems';
import { useItemActions } from './hooks/useItemActions';
import ItemsTable from './components/ItemsTable';
import AddItemForm from './components/AddItemForm';
import TemplateSelectModal from './components/TemplateSelectModal';
import AuditHistoryTab from './components/AuditHistoryTab';
import { BoqItemsImportModal } from './components/BoqItemsImportModal';
import { supabase } from '../../lib/supabase';
import { useDeadlineCheck } from '../../hooks/useDeadlineCheck';
import { useAuth } from '../../contexts/AuthContext';
import { deleteBoqItemWithAudit, updateBoqItemWithAudit } from '../../lib/supabaseWithAudit';
import { getErrorMessage } from '../../utils/errors';

const { Text, Title } = Typography;

const PositionItems: React.FC = () => {
  const { positionId } = useParams<{ positionId: string }>();
  const { user } = useAuth();

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
  } = useBoqItems(positionId);

  // Проверка дедлайна для блокировки редактирования
  const { canEdit: canEditByDeadline, loading: deadlineLoading } =
    useDeadlineCheck(position?.tender_id);

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
  });

  // Вычисление общей суммы
  const totalSum = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.total_amount || 0), 0);
  }, [items]);

  const handleEditClick = (record: any) => {
    setExpandedRowKeys([record.id]);
  };

  const onFormSave = async (data: any) => {
    await handleFormSave(data, expandedRowKeys, items, () => setExpandedRowKeys([]));
  };

  const onFormCancel = () => {
    setExpandedRowKeys([]);
  };

  const onSaveGPData = async () => {
    if (positionId) {
      await handleSaveGPData(positionId, gpVolume, gpNote, fetchPositionData);
    }
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
    setSelectedDeleteIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCancelDeleteMode = () => {
    setIsDeleteMode(false);
    setSelectedDeleteIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedDeleteIds.size === 0) return;
    const count = selectedDeleteIds.size;
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Удалить элементы?',
      content: `Вы уверены, что хотите удалить ${count} выбранных элемент${count === 1 ? '' : count < 5 ? 'а' : 'ов'}? Это действие необратимо.`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        setIsBulkDeleting(true);
        try {
          for (const id of selectedDeleteIds) {
            await deleteBoqItemWithAudit(user?.id, id);
          }
          setIsDeleteMode(false);
          setSelectedDeleteIds(new Set());
          await fetchItems();
          message.success(`Удалено ${count} элемент${count === 1 ? '' : count < 5 ? 'а' : 'ов'}`);
        } catch (error) {
          message.error('Ошибка удаления: ' + getErrorMessage(error));
        } finally {
          setIsBulkDeleting(false);
        }
      },
    });
  };

  const handleClearAllItems = async () => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Очистить все элементы?',
      content: 'Вы действительно хотите удалить все работы и материалы из этой позиции? Это действие необратимо.',
      okText: 'Да, очистить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          // Удаляем все элементы позиции из БД
          for (const item of items) {
            await deleteBoqItemWithAudit(user?.id, item.id);
          }

          if (positionId) {
            const { error } = await supabase
              .from('client_positions')
              .update({
                total_material: 0,
                total_works: 0,
              })
              .eq('id', positionId);

            if (error) throw error;
          }

          // Обновляем состояние
          await fetchItems();
          message.success('Все элементы успешно удалены');
        } catch (error) {
          message.error('Ошибка при удалении элементов: ' + getErrorMessage(error));
        }
      },
    });
  };

  const handleApplyCostToAll = async () => {
    if (!selectedCostCategoryId) {
      message.error('Выберите затрату на строительство');
      return;
    }

    if (items.length === 0) {
      message.warning('Нет элементов для применения затраты');
      return;
    }

    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Распространить затрату на все строки?',
      content: `Выбранная затрата будет применена ко всем ${items.length} элементам (работы и материалы). Продолжить?`,
      okText: 'Да, применить',
      cancelText: 'Отмена',
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          for (const item of items) {
            await updateBoqItemWithAudit(user?.id, item.id, {
              detail_cost_category_id: selectedCostCategoryId,
            });
          }

          // Обновляем состояние
          await fetchItems();
          message.success(`Затрата успешно применена к ${items.length} элементам`);

          // Очищаем выбор
          setSelectedCostCategoryId(null);
          setCostSearchText('');
        } catch (error) {
          message.error('Ошибка при применении затраты: ' + getErrorMessage(error));
        }
      },
    });
  };

  // Получить опции для AutoComplete затрат
  const getCostCategoryOptions = () => {
    return costCategories
      .filter((c) => c.label.toLowerCase().includes(costSearchText.toLowerCase()))
      .map((c) => ({
        value: c.label,
        id: c.value,
        label: c.label,
      }));
  };

  if (!position) {
    return <div>Загрузка...</div>;
  }

  return (
    <div style={{ padding: '0 8px' }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {position.is_additional && <Tag color="orange">ДОП</Tag>}
              <Title level={4} style={{ margin: 0 }}>
                {position.position_number}. {position.item_no ? `${position.item_no} ` : ''}{position.work_name}
              </Title>
            </div>

              {!position.is_additional && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text type="secondary">
                    Кол-во заказчика: <Text strong>{position.volume?.toFixed(2) || '-'}</Text>
                    {position.unit_code && <> &nbsp;Ед. изм.: <Text strong>{position.unit_code}</Text></>}
                  </Text>
                  {position.client_note && (
                    <Text type="secondary">
                      Примечание заказчика: <Text strong>{position.client_note}</Text>
                    </Text>
                  )}
                </div>
              )}

              {position.is_additional && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text type="secondary">Наименование:</Text>
                    <Input
                      value={workName}
                      onChange={(e) => setWorkName(e.target.value)}
                      onBlur={onSaveAdditionalWorkData}
                      disabled={!canEditByDeadline || deadlineLoading}
                      style={{ width: 300 }}
                      size="small"
                      placeholder="Наименование работы"
                    />
                    <Text type="secondary" style={{ marginLeft: 16, paddingTop: 4 }}>Примечание ГП:</Text>
                    <Input.TextArea
                      value={gpNote}
                      onChange={(e) => setGpNote(e.target.value)}
                      onBlur={onSaveGPData}
                      disabled={!canEditByDeadline || deadlineLoading}
                      style={{ width: 300 }}
                      size="small"
                      placeholder="Примечание"
                      autoSize={{ minRows: 1, maxRows: 2 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text type="secondary">Кол-во ГП:</Text>
                    <InputNumber
                      value={gpVolume}
                      onChange={(value) => setGpVolume(value || 0)}
                      onBlur={onSaveGPData}
                      disabled={!canEditByDeadline || deadlineLoading}
                      precision={5}
                      style={{ width: 120 }}
                      size="small"
                      parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                    />
                    <Text type="secondary" style={{ marginLeft: 16 }}>Ед. изм:</Text>
                    <Select
                      value={unitCode}
                      onChange={(value) => {
                        setUnitCode(value);
                        setTimeout(() => onSaveAdditionalWorkData(), 100);
                      }}
                      disabled={!canEditByDeadline || deadlineLoading}
                      style={{ width: 100 }}
                      size="small"
                      showSearch
                      placeholder="Выберите"
                      optionFilterProp="children"
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      options={units.map(unit => ({
                        value: unit.code,
                        label: unit.code,
                      }))}
                    />
                  </div>
                </div>
              )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {!position.is_additional && (
              <>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                    <Text type="secondary">Кол-во ГП:</Text>
                    <InputNumber
                      value={gpVolume}
                      onChange={(value) => setGpVolume(value || 0)}
                      onBlur={onSaveGPData}
                      disabled={!canEditByDeadline || deadlineLoading}
                      precision={5}
                      style={{ width: 120 }}
                      size="small"
                      parser={(value) => parseFloat(value!.replace(/,/g, '.'))}
                    />
                    <Text type="secondary">{position.unit_code}</Text>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, whiteSpace: 'nowrap' }}>
                  <Text type="secondary" style={{ paddingTop: 4 }}>Примечание ГП:</Text>
                  <Input.TextArea
                    value={gpNote}
                    onChange={(e) => setGpNote(e.target.value)}
                    onBlur={onSaveGPData}
                    disabled={!canEditByDeadline || deadlineLoading}
                    style={{ width: 400 }}
                    size="small"
                    placeholder="Примечание"
                    autoSize={{ minRows: 1, maxRows: 2 }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'current',
            label: 'Текущие',
            children: (
              <>
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
                    disabled={!canEditByDeadline || deadlineLoading}
                  />
                </Card>

                <Card
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Элементы позиции</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isDeleteMode ? (
                          <>
                            {selectedDeleteIds.size > 0 && (
                              <Button
                                type="primary"
                                danger
                                icon={<DeleteOutlined />}
                                loading={isBulkDeleting}
                                onClick={handleBulkDelete}
                              >
                                Удалить ({selectedDeleteIds.size})
                              </Button>
                            )}
                            <Button onClick={handleCancelDeleteMode}>Отменить выбор</Button>
                          </>
                        ) : (
                          <>
                            <AutoComplete
                              value={costSearchText}
                              onChange={(value) => setCostSearchText(value)}
                              onSelect={(value, option: any) => {
                                setSelectedCostCategoryId(option.id);
                                setCostSearchText(option.label);
                              }}
                              options={getCostCategoryOptions()}
                              placeholder="Выберите затрату на строительство"
                              style={{ width: 525 }}
                              allowClear
                              onClear={() => {
                                setCostSearchText('');
                                setSelectedCostCategoryId(null);
                              }}
                              filterOption={false}
                              disabled={!canEditByDeadline || deadlineLoading}
                            />
                            <Button
                              type="primary"
                              icon={<ThunderboltOutlined />}
                              onClick={handleApplyCostToAll}
                              disabled={!selectedCostCategoryId || items.length === 0 || !canEditByDeadline || deadlineLoading}
                            >
                              Распространить затрату на все строки
                            </Button>
                            <Button
                              type="default"
                              icon={<UploadOutlined />}
                              onClick={() => setImportModalVisible(true)}
                              disabled={!canEditByDeadline || deadlineLoading}
                              style={{ backgroundColor: '#10b981', borderColor: '#10b981', color: 'white' }}
                            >
                              Импорт из Excel
                            </Button>
                            <Button
                              danger
                              icon={<DeleteOutlined />}
                              onClick={handleClearAllItems}
                              disabled={items.length === 0 || !canEditByDeadline || deadlineLoading}
                            >
                              Очистить все
                            </Button>
                          </>
                        )}
                        <div style={{ fontSize: 16, fontWeight: 'bold' }}>
                          Итого: <span style={{ color: '#10b981' }}>{Math.round(totalSum).toLocaleString('ru-RU')}</span>
                        </div>
                      </div>
                    </div>
                  }
                >
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
                    readOnly={!canEditByDeadline || deadlineLoading}
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
                            readOnly={!canEditByDeadline || deadlineLoading}
                          />
                        );
                      } else {
                        const workItems = items.filter(
                          item => item.boq_item_type === 'раб' ||
                            item.boq_item_type === 'суб-раб' ||
                            item.boq_item_type === 'раб-комп.'
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
                            readOnly={!canEditByDeadline || deadlineLoading}
                          />
                        );
                      }
                    }}
                  />
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
          onClose={(success) => {
            setImportModalVisible(false);
            if (success) {
              fetchItems();
            }
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

export default PositionItems;
