import React from 'react';
import { Tag, Tooltip } from 'antd';
import {
  CopyOutlined,
  CheckOutlined,
  DeleteOutlined,
  MoreOutlined,
  ClearOutlined,
  FileTextOutlined,
  FileAddOutlined,
  PlusOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons';
import type { ClientPosition } from '../../../lib/supabase';

interface PositionRowActionsProps {
  record: ClientPosition;
  isLeaf: boolean;
  isExpanded: boolean;
  currentTheme: string;
  readOnly?: boolean;
  copiedPositionId: string | null;
  copiedNotePositionId: string | null;
  selectedTargetIds: Set<string>;
  isDeleteSelectionMode: boolean;
  selectedDeleteIds: Set<string>;
  isLevelChangeMode: boolean;
  selectedLevelChangeIds: Set<string>;
  isPositionDeleteMode: boolean;
  selectedPositionDeleteIds: Set<string>;
  canChangeLevel: boolean;
  canDeletePositions: boolean;
  counts: { works: number; materials: number };
  onToggleSelection: (positionId: string, event: React.MouseEvent) => void;
  onToggleDeleteSelection?: (positionId: string, event: React.MouseEvent) => void;
  onToggleLevelChangeSelection?: (positionId: string, event: React.MouseEvent) => void;
  onTogglePositionDeleteSelection?: (positionId: string, event: React.MouseEvent) => void;
  onCopyPosition: (positionId: string, event: React.MouseEvent) => void;
  onCopyNote: (positionId: string, noteValue: string | null, event: React.MouseEvent) => void;
  onOpenAdditionalModal: (parentId: string, event: React.MouseEvent) => void;
  onDeleteAdditionalPosition: (positionId: string, positionName: string, event: React.MouseEvent) => void;
  onStartDeleteSelection: (positionId: string, event: React.MouseEvent) => void;
  onClearPositionBoqItems: (positionId: string, positionName: string, event: React.MouseEvent) => void;
  onStartLevelChange: (event: React.MouseEvent) => void;
  onStartPositionDeleteSelection?: (positionId: string, event: React.MouseEvent) => void;
  onToggleExpanded: (id: string) => void;
}

const PositionRowActionsInner: React.FC<PositionRowActionsProps> = ({
  record,
  isLeaf,
  isExpanded,
  currentTheme,
  readOnly,
  copiedPositionId,
  copiedNotePositionId,
  selectedTargetIds,
  isDeleteSelectionMode,
  selectedDeleteIds,
  isLevelChangeMode,
  selectedLevelChangeIds,
  isPositionDeleteMode,
  selectedPositionDeleteIds,
  canChangeLevel,
  canDeletePositions,
  counts,
  onToggleSelection,
  onToggleDeleteSelection,
  onToggleLevelChangeSelection,
  onTogglePositionDeleteSelection,
  onCopyPosition,
  onCopyNote,
  onOpenAdditionalModal,
  onDeleteAdditionalPosition,
  onStartDeleteSelection,
  onClearPositionBoqItems,
  onStartLevelChange,
  onStartPositionDeleteSelection,
  onToggleExpanded,
}) => {
  const tooltipColor = currentTheme === 'dark' ? {
    overlayInnerStyle: { backgroundColor: '#434343', color: '#fff' }
  } : {};

  return (
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

      {/* Тег выбора для массового удаления работ/материалов */}
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

      {/* Тег выбора для массового удаления строк заказчика */}
      {isPositionDeleteMode && (
        <Tooltip title={selectedPositionDeleteIds.has(record.id) ? 'Отменить выбор' : 'Выбрать для удаления'} {...tooltipColor}>
          <Tag
            color={selectedPositionDeleteIds.has(record.id) ? 'error' : 'default'}
            style={{
              cursor: 'pointer', margin: 0,
              backgroundColor: selectedPositionDeleteIds.has(record.id) ? '#ff4d4f' : undefined,
              borderColor: selectedPositionDeleteIds.has(record.id) ? '#ff4d4f' : undefined,
              color: selectedPositionDeleteIds.has(record.id) ? '#fff' : undefined,
            }}
            onClick={(e) => { e.stopPropagation(); onTogglePositionDeleteSelection?.(record.id, e); }}
          >
            <DeleteOutlined />
          </Tag>
        </Tooltip>
      )}

      {/* Раскрывающиеся кнопки действий */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isLeaf && (
            <div style={{ display: 'flex', gap: 4 }}>
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

          <div style={{ display: 'flex', gap: 4 }}>
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
            {canDeletePositions && (
              <Tooltip title="Удалить строки заказчика" {...tooltipColor}>
                <Tag color="red" style={{ cursor: 'pointer', margin: 0 }} onClick={(e) => { e.stopPropagation(); onStartPositionDeleteSelection?.(record.id, e); }}>
                  <DeleteOutlined />
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
          onClick={(e) => { e.stopPropagation(); onToggleExpanded(record.id); }}
        >
          <MoreOutlined />
        </Tag>
      </Tooltip>
    </div>
  );
};

const areEqual = (prev: PositionRowActionsProps, next: PositionRowActionsProps): boolean => {
  const id = next.record.id;
  return (
    prev.record.id === next.record.id &&
    prev.record.is_additional === next.record.is_additional &&
    prev.record.work_name === next.record.work_name &&
    prev.record.manual_note === next.record.manual_note &&
    prev.isLeaf === next.isLeaf &&
    prev.isExpanded === next.isExpanded &&
    prev.currentTheme === next.currentTheme &&
    prev.readOnly === next.readOnly &&
    prev.copiedPositionId === next.copiedPositionId &&
    prev.copiedNotePositionId === next.copiedNotePositionId &&
    prev.isDeleteSelectionMode === next.isDeleteSelectionMode &&
    prev.isLevelChangeMode === next.isLevelChangeMode &&
    prev.isPositionDeleteMode === next.isPositionDeleteMode &&
    prev.canChangeLevel === next.canChangeLevel &&
    prev.canDeletePositions === next.canDeletePositions &&
    prev.counts.works === next.counts.works &&
    prev.counts.materials === next.counts.materials &&
    prev.selectedTargetIds.has(id) === next.selectedTargetIds.has(id) &&
    prev.selectedDeleteIds.has(id) === next.selectedDeleteIds.has(id) &&
    prev.selectedLevelChangeIds.has(id) === next.selectedLevelChangeIds.has(id) &&
    prev.selectedPositionDeleteIds.has(id) === next.selectedPositionDeleteIds.has(id) &&
    prev.onToggleSelection === next.onToggleSelection &&
    prev.onToggleDeleteSelection === next.onToggleDeleteSelection &&
    prev.onToggleLevelChangeSelection === next.onToggleLevelChangeSelection &&
    prev.onTogglePositionDeleteSelection === next.onTogglePositionDeleteSelection &&
    prev.onCopyPosition === next.onCopyPosition &&
    prev.onCopyNote === next.onCopyNote &&
    prev.onOpenAdditionalModal === next.onOpenAdditionalModal &&
    prev.onDeleteAdditionalPosition === next.onDeleteAdditionalPosition &&
    prev.onStartDeleteSelection === next.onStartDeleteSelection &&
    prev.onClearPositionBoqItems === next.onClearPositionBoqItems &&
    prev.onStartLevelChange === next.onStartLevelChange &&
    prev.onStartPositionDeleteSelection === next.onStartPositionDeleteSelection &&
    prev.onToggleExpanded === next.onToggleExpanded
  );
};

export const PositionRowActions = React.memo(PositionRowActionsInner, areEqual);
