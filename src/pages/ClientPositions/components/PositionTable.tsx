import React, { useMemo, useState } from 'react';
import { Card, Table, Typography, Tag, Tooltip, Space, Button } from 'antd';
import {
  PlusOutlined,
  CopyOutlined,
  CheckOutlined,
  DownloadOutlined,
  DeleteOutlined,
  MoreOutlined,
  ClearOutlined,
  FileTextOutlined,
  FileAddOutlined,
  FilterOutlined,
  UploadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ClientPosition, Tender } from '../../../lib/supabase';

const { Text } = Typography;

interface PositionTableProps {
  clientPositions: ClientPosition[];
  selectedTender: Tender | null;
  loading: boolean;
  copiedPositionId: string | null;
  copiedNotePositionId: string | null;
  selectedTargetIds: Set<string>;
  isBulkPasting: boolean;
  positionCounts: Record<string, { works: number; materials: number; total: number }>;
  currentTheme: string;
  leafPositionIndices: Set<string>;
  readOnly?: boolean;
  isFilterActive?: boolean;
  filterSelectedCount?: number;
  totalPositionsCount?: number;
  onRowClick: (record: ClientPosition, index: number) => void;
  onOpenAdditionalModal: (parentId: string, event: React.MouseEvent) => void;
  onCopyPosition: (positionId: string, event: React.MouseEvent) => void;
  onPastePosition: (positionId: string, event: React.MouseEvent) => void;
  onToggleSelection: (positionId: string, event: React.MouseEvent) => void;
  onBulkPaste: () => void;
  onCopyNote: (positionId: string, noteValue: string | null, event: React.MouseEvent) => void;
  onPasteNote: (positionId: string, event: React.MouseEvent) => void;
  onBulkPasteNote: () => void;
  isDeleteSelectionMode?: boolean;
  selectedDeleteIds?: Set<string>;
  isBulkDeleting?: boolean;
  onStartDeleteSelection: (positionId: string, event: React.MouseEvent) => void;
  onToggleDeleteSelection?: (positionId: string, event: React.MouseEvent) => void;
  onCancelDeleteSelection?: () => void;
  onBulkDeleteBoqItems?: () => void;
  onDeleteAdditionalPosition: (positionId: string, positionName: string, event: React.MouseEvent) => void;
  onClearPositionBoqItems: (positionId: string, positionName: string, event: React.MouseEvent) => void;
  isLevelChangeMode?: boolean;
  selectedLevelChangeIds?: Set<string>;
  isLevelChanging?: boolean;
  onStartLevelChange: (event: React.MouseEvent) => void;
  onToggleLevelChangeSelection?: (positionId: string, event: React.MouseEvent) => void;
  onCancelLevelChange?: () => void;
  onBulkLevelChange?: () => void;
  canChangeLevel?: boolean;
  onExportToExcel: () => void;
  onMassImport?: () => void;
  tempSelectedPositionIds?: Set<string>;
  onToggleFilterCheckbox?: (positionId: string) => void;
  onApplyFilter?: () => void;
  onClearFilter?: () => void;
  showAllPositions?: boolean;
  onToggleShowAll?: () => void;
}

export const PositionTable: React.FC<PositionTableProps> = ({
  clientPositions,
  selectedTender,
  loading,
  copiedPositionId,
  copiedNotePositionId,
  selectedTargetIds,
  isBulkPasting,
  positionCounts,
  currentTheme,
  leafPositionIndices,
  readOnly,
  onRowClick,
  onOpenAdditionalModal,
  onCopyPosition,
  onPastePosition,
  onToggleSelection,
  onBulkPaste,
  onCopyNote,
  onPasteNote,
  onBulkPasteNote,
  isDeleteSelectionMode = false,
  selectedDeleteIds = new Set(),
  isBulkDeleting = false,
  onStartDeleteSelection,
  onToggleDeleteSelection,
  onCancelDeleteSelection,
  onBulkDeleteBoqItems,
  onDeleteAdditionalPosition,
  onClearPositionBoqItems,
  isLevelChangeMode = false,
  selectedLevelChangeIds = new Set(),
  isLevelChanging = false,
  onStartLevelChange,
  onToggleLevelChangeSelection,
  onCancelLevelChange,
  onBulkLevelChange,
  canChangeLevel = false,
  onExportToExcel,
  onMassImport,
  isFilterActive = false,
  filterSelectedCount = 0,
  totalPositionsCount = 0,
  tempSelectedPositionIds = new Set(),
  onToggleFilterCheckbox,
  onApplyFilter,
  onClearFilter,
  showAllPositions = false,
  onToggleShowAll,
}) => {
  // Состояние для отслеживания открытой позиции
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);

  const columns: ColumnsType<ClientPosition> = useMemo(() => [
    {
      title: <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Фильтр</div>,
      key: 'filter_checkbox',
      width: 60,
      align: 'center',
      fixed: 'left',
      render: (_, record) => (
        <Tag
          color={tempSelectedPositionIds.has(record.id) ? 'blue' : 'default'}
          style={{
            cursor: readOnly ? 'not-allowed' : 'pointer',
            margin: 0,
            opacity: readOnly ? 0.5 : 1,
            pointerEvents: readOnly ? 'none' : 'auto',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFilterCheckbox?.(record.id);
          }}
        >
          {tempSelectedPositionIds.has(record.id) ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }}></span>}
        </Tag>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>№</div>,
      dataIndex: 'position_number',
      key: 'position_number',
      width: 50,
      align: 'center',
      fixed: 'left',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Раздел / Наименование</div>,
      key: 'section_name',
      width: 400,
      fixed: 'left',
      render: (_, record, index) => {
        const isLeaf = leafPositionIndices.has(record.id);
        const sectionColor = isLeaf ? '#52c41a' : '#ff7875';
        const isAdditional = record.is_additional;
        const paddingLeft = isAdditional ? 20 : 0;

        if (isLeaf && selectedTender) {
          return (
            <div
              style={{
                display: 'block',
                paddingLeft: `${paddingLeft}px`,
              }}
            >
              {isAdditional ? (
                <Tag color="orange" style={{ marginRight: 8 }}>ДОП</Tag>
              ) : (
                record.item_no && (
                  <Text strong style={{ color: sectionColor, marginRight: 8 }}>
                    {record.item_no}
                  </Text>
                )
              )}
              <Text style={{ textDecoration: 'underline' }}>{record.work_name}</Text>
            </div>
          );
        }

        return (
          <div style={{ paddingLeft: `${paddingLeft}px` }}>
            {isAdditional ? (
              <Tag color="orange" style={{ marginRight: 8 }}>ДОП</Tag>
            ) : (
              record.item_no && (
                <Text strong style={{ color: sectionColor, marginRight: 8 }}>
                  {record.item_no}
                </Text>
              )
            )}
            <Text>{record.work_name}</Text>
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Данные заказчика</div>,
      key: 'client_data',
      width: 250,
      render: (_, record) => (
        <div style={{ fontSize: 12 }}>
          {record.volume && (
            <div>
              <Text type="secondary">Кол-во: </Text>
              <Text strong>{record.volume.toFixed(2)}</Text>
            </div>
          )}
          {record.unit_code && (
            <div>
              <Text type="secondary">Ед.изм.: </Text>
              <Text>{record.unit_code}</Text>
            </div>
          )}
          {record.client_note && (
            <div>
              <Text type="secondary">Примечание: </Text>
              <Text italic>{record.client_note}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Данные ГП</div>,
      key: 'gp_data',
      width: 300,
      render: (_, record, index) => {
        const isLeaf = leafPositionIndices.has(record.id);

        return (
          <div style={{ fontSize: 12 }}>
            {isLeaf && (
              <div style={{ marginBottom: 4 }}>
                <Text type="secondary">Кол-во: </Text>
                <Text>{record.manual_volume?.toFixed(2) || '-'}</Text>
              </div>
            )}
            {isLeaf && record.unit_code && (
              <div style={{ marginBottom: 4 }}>
                <Text type="secondary">Ед.изм.: </Text>
                <Text>{record.unit_code}</Text>
              </div>
            )}
            <div>
              <Text type="secondary">Примечание: </Text>
              <Text>{record.manual_note || '-'}</Text>
            </div>
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      key: 'total',
      width: 110,
      align: 'center',
      render: (_, record, index) => {
        const isLeaf = leafPositionIndices.has(record.id);
        const counts = positionCounts[record.id] || { works: 0, materials: 0, total: 0 };
        const total = counts.total; // Используем реальную сумму из boq_items
        const isExpanded = expandedPositionId === record.id;

        const tooltipColor = currentTheme === 'dark' ? {
          overlayInnerStyle: { backgroundColor: '#434343', color: '#fff' }
        } : {};

        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minHeight: '48px' }}>
            {/* Пустой div для баланса слева */}
            <div style={{ flex: 1, minWidth: 0 }} />

            {/* ЦЕНТР: Счетчики и сумма */}
            {(counts.works > 0 || counts.materials > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {/* Сумма */}
                {total > 0 && (
                  <Text
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: currentTheme === 'dark' ? '#52c41a' : '#389e0d',
                    }}
                  >
                    {Math.round(total).toLocaleString('ru-RU')}
                  </Text>
                )}
                {/* Счётчики */}
                <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                  <span>
                    Р: <span style={{ color: '#ff9800', fontWeight: 600 }}>{counts.works}</span>
                  </span>
                  <span>
                    М: <span style={{ color: '#1890ff', fontWeight: 600 }}>{counts.materials}</span>
                  </span>
                </div>
              </div>
            )}

            {/* СПРАВА: Кнопки действий */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, alignSelf: 'center' }}>
              {/* Теги выбора для вставки работ/примечания */}
              {(() => {
                const isTarget = selectedTargetIds.has(record.id);
                const targetStyle = {
                  cursor: readOnly ? 'not-allowed' : 'pointer', margin: 0,
                  opacity: readOnly ? 0.5 : 1, pointerEvents: readOnly ? 'none' as const : 'auto' as const,
                  backgroundColor: isTarget ? '#faad14' : undefined,
                  borderColor: isTarget ? '#faad14' : undefined,
                  color: isTarget ? '#fff' : undefined,
                };
                const handleClick = (e: React.MouseEvent) => { e.stopPropagation(); onToggleSelection(record.id, e); };
                return (
                  <>
                    {isLeaf && copiedPositionId && copiedPositionId !== record.id && (
                      <Tooltip title={isTarget ? 'Отменить выбор для вставки' : 'Выбрать для вставки'} {...tooltipColor}>
                        <Tag color={isTarget ? 'warning' : 'success'} style={targetStyle} onClick={handleClick}>
                          <CheckOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {copiedNotePositionId && copiedNotePositionId !== record.id && (
                      <Tooltip title={isTarget ? 'Отменить выбор для вставки примечания' : 'Выбрать для вставки примечания'} {...tooltipColor}>
                        <Tag color={isTarget ? 'warning' : 'lime'} style={targetStyle} onClick={handleClick}>
                          <FileAddOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                  </>
                );
              })()}

              {/* Тег выбора для массового удаления */}
              {isLeaf && isDeleteSelectionMode && (
                <Tooltip title={selectedDeleteIds.has(record.id) ? 'Отменить выбор' : 'Выбрать для удаления'} {...tooltipColor}>
                  <Tag
                    color={selectedDeleteIds.has(record.id) ? 'error' : 'default'}
                    style={{
                      cursor: 'pointer', margin: 0,
                      backgroundColor: selectedDeleteIds.has(record.id) ? '#ff4d4f' : undefined,
                      borderColor: selectedDeleteIds.has(record.id) ? '#ff4d4f' : undefined,
                      color: selectedDeleteIds.has(record.id) ? '#fff' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); onToggleDeleteSelection?.(record.id, e); }}
                  >
                    <DeleteOutlined />
                  </Tag>
                </Tooltip>
              )}

              {/* Тег выбора для изменения уровня иерархии */}
              {isLevelChangeMode && (
                <Tooltip title={selectedLevelChangeIds.has(record.id) ? 'Отменить выбор' : 'Выбрать для понижения уровня'} {...tooltipColor}>
                  <Tag
                    color={selectedLevelChangeIds.has(record.id) ? 'processing' : 'default'}
                    style={{
                      cursor: 'pointer', margin: 0,
                      backgroundColor: selectedLevelChangeIds.has(record.id) ? '#1890ff' : undefined,
                      borderColor: selectedLevelChangeIds.has(record.id) ? '#1890ff' : undefined,
                      color: selectedLevelChangeIds.has(record.id) ? '#fff' : undefined,
                    }}
                    onClick={(e) => { e.stopPropagation(); onToggleLevelChangeSelection?.(record.id, e); }}
                  >
                    <VerticalAlignBottomOutlined />
                  </Tag>
                </Tooltip>
              )}

              {/* Раскрывающиеся кнопки действий */}
              {isExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {/* Строка 1: Копирование (только для листовых) */}
                  {isLeaf && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {/* Скопировать работы и материалы */}
                      {copiedPositionId !== record.id && (
                        <Tooltip title="Скопировать работы и материалы" {...tooltipColor}>
                          <Tag color="blue" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onCopyPosition(record.id, e); }}>
                            <CopyOutlined />
                          </Tag>
                        </Tooltip>
                      )}
                      <Tooltip title="Скопировать примечание ГП" {...tooltipColor}>
                        <Tag color="purple" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onCopyNote(record.id, record.manual_note, e); }}>
                          <FileTextOutlined />
                        </Tag>
                      </Tooltip>
                    </div>
                  )}

                  {/* Строка 2: Добавление/Удаление */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {/* Добавить ДОП работу (для НЕ-ДОП позиций) */}
                    {!record.is_additional && (
                      <Tooltip title="Добавить ДОП работу" {...tooltipColor}>
                        <Tag color="success" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onOpenAdditionalModal(record.id, e); }}>
                          <PlusOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {record.is_additional && (
                      <Tooltip title="Удалить ДОП работу" {...tooltipColor}>
                        <Tag color="error" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onDeleteAdditionalPosition(record.id, record.work_name, e); }}>
                          <DeleteOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {isLeaf && (
                      <Tooltip title="Удалить работы и материалы" {...tooltipColor}>
                        <Tag color="orange" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onStartDeleteSelection(record.id, e); }}>
                          <ClearOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {!isLeaf && counts.works + counts.materials > 0 && (
                      <Tooltip title="Удалить работы и материалы" {...tooltipColor}>
                        <Tag color="orange" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onClearPositionBoqItems(record.id, record.work_name, e); }}>
                          <ClearOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                    {canChangeLevel && (
                      <Tooltip title="Понизить уровень иерархии" {...tooltipColor}>
                        <Tag color="geekblue" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onStartLevelChange(e); }}>
                          <VerticalAlignBottomOutlined />
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )}

              <Tooltip title="Действия" {...tooltipColor}>
                <Tag
                  color="default"
                  style={{ cursor: readOnly ? 'not-allowed' : 'pointer', margin: 0, opacity: readOnly ? 0.5 : 1, pointerEvents: readOnly ? 'none' : 'auto' }}
                  onClick={(e) => { e.stopPropagation(); setExpandedPositionId(isExpanded ? null : record.id); }}
                >
                  <MoreOutlined />
                </Tag>
              </Tooltip>
            </div>
          </div>
        );
      },
    },
  ], [
    positionCounts,
    leafPositionIndices,
    copiedPositionId,
    copiedNotePositionId,
    selectedTargetIds,
    currentTheme,
    expandedPositionId,
    readOnly,
    tempSelectedPositionIds,
    onToggleFilterCheckbox,
    onOpenAdditionalModal,
    onDeleteAdditionalPosition,
    onCopyPosition,
    onPastePosition,
    onToggleSelection,
    onCopyNote,
    onPasteNote,
    isDeleteSelectionMode,
    selectedDeleteIds,
    onToggleDeleteSelection,
    onStartDeleteSelection,
    onClearPositionBoqItems,
    isLevelChangeMode,
    selectedLevelChangeIds,
    onToggleLevelChangeSelection,
    onStartLevelChange,
    canChangeLevel,
  ]);

  return (
    <Card
      bordered={false}
      title={
        <Space>
          <FileTextOutlined />
          <span>Позиции заказчика</span>
          {isFilterActive && (
            <Tag color="blue">
              Показано {filterSelectedCount} из {totalPositionsCount}
            </Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          {/* Кнопки фильтра */}
          {!isFilterActive && tempSelectedPositionIds.size > 0 && (
            <Button type="primary" icon={<FilterOutlined />} onClick={onApplyFilter} disabled={readOnly}>
              Скрыть невыбранные строки ({tempSelectedPositionIds.size})
            </Button>
          )}
          {isFilterActive && (
            <>
              <Button
                icon={showAllPositions ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={onToggleShowAll}
                type={showAllPositions ? 'primary' : 'default'}
              >
                {showAllPositions ? 'Скрыть невыбранные' : 'Отобразить все строки'}
              </Button>
              <Button icon={<FilterOutlined />} onClick={onApplyFilter} disabled={readOnly}>
                Обновить фильтр
              </Button>
              <Button onClick={onClearFilter} disabled={readOnly}>Отменить фильтр</Button>
            </>
          )}
          {/* Существующие кнопки */}
          {copiedPositionId && selectedTargetIds.size > 0 && (
            <Button type="primary" icon={<CheckOutlined />} onClick={onBulkPaste} loading={isBulkPasting} disabled={loading}>
              Вставить работы и материалы ({selectedTargetIds.size})
            </Button>
          )}
          {copiedNotePositionId && selectedTargetIds.size > 0 && (
            <Button type="primary" icon={<FileAddOutlined />} onClick={onBulkPasteNote} loading={isBulkPasting} disabled={loading}>
              Вставить примечание ({selectedTargetIds.size})
            </Button>
          )}
          {isDeleteSelectionMode && (
            <>
              {selectedDeleteIds.size > 0 && (
                <Button type="primary" danger icon={<ClearOutlined />} onClick={onBulkDeleteBoqItems} loading={isBulkDeleting} disabled={loading}>
                  Удалить работы и материалы ({selectedDeleteIds.size})
                </Button>
              )}
              <Button onClick={onCancelDeleteSelection}>Отменить выбор</Button>
            </>
          )}
          {isLevelChangeMode && (
            <>
              {selectedLevelChangeIds.size > 0 && (
                <Button type="primary" icon={<VerticalAlignBottomOutlined />} onClick={onBulkLevelChange} loading={isLevelChanging} disabled={loading}>
                  Понизить уровень ({selectedLevelChangeIds.size})
                </Button>
              )}
              <Button onClick={onCancelLevelChange}>Отменить выбор</Button>
            </>
          )}
          <Button
            icon={<UploadOutlined />}
            onClick={onMassImport}
            disabled={!selectedTender || loading || readOnly}
          >
            Импорт из Excel
          </Button>
          <Button icon={<DownloadOutlined />} onClick={onExportToExcel} disabled={!selectedTender || loading}>
            Экспорт в Excel
          </Button>
        </Space>
      }
      style={{ marginTop: 24 }}
    >
      <Table
        columns={columns}
        dataSource={clientPositions}
        rowKey="id"
        loading={loading}
        rowClassName={(record) => {
          if (copiedPositionId === record.id) return 'copied-row';
          if (isDeleteSelectionMode && selectedDeleteIds.has(record.id)) return 'delete-selected-row';
          return '';
        }}
        onRow={(record, index) => {
          const isLeaf = leafPositionIndices.has(record.id);
          return {
            onClick: () => onRowClick(record, index!),
            onMouseUp: (e: React.MouseEvent) => {
              if (e.button === 1 && isLeaf && selectedTender) {
                e.preventDefault();
                e.stopPropagation();
                const url = `/positions/${record.id}/items?tenderId=${selectedTender.id}&positionId=${record.id}`;
                // Открываем в фоновой вкладке
                const newWindow = window.open(url, '_blank');
                // Возвращаем фокус на текущее окно
                if (newWindow) {
                  window.focus();
                }
              }
            },
            style: {
              cursor: isLeaf ? 'pointer' : 'default',
              opacity: (showAllPositions && isFilterActive && !tempSelectedPositionIds.has(record.id)) ? 0.5 : 1,
              backgroundColor: (isDeleteSelectionMode && selectedDeleteIds.has(record.id))
                ? (currentTheme === 'dark' ? 'rgba(255, 77, 79, 0.15)' : 'rgba(255, 77, 79, 0.08)')
                : (isLevelChangeMode && selectedLevelChangeIds.has(record.id))
                ? (currentTheme === 'dark' ? 'rgba(24, 144, 255, 0.15)' : 'rgba(24, 144, 255, 0.08)')
                : undefined,
            },
          };
        }}
        pagination={false}
        scroll={{ x: 1200, y: 600 }}
        virtual
        size="small"
      />
    </Card>
  );
};
