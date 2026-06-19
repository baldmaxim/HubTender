import React from 'react';
import { Button, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import UserTimeline from './UserTimeline';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';
import type { TimelineTenderListItem } from '../hooks/useTenders';

const { Text } = Typography;

interface TimelinePanelProps {
  selectedTender: TimelineTenderListItem;
  selectedGroup: TimelineGroupItem;
  selectedUserId: string | null;
  onUserSelect: (userId: string | null) => void;
  currentUserId: string | null;
  currentUserRoleCode: string | null;
  canRespond: boolean;
  onDataChanged: () => Promise<void> | void;
  refreshSignal: number;
  onClose: () => void;
  colorText: string;
  colorBorderSecondary: string;
  /** На телефоне крестик не нужен (Drawer имеет собственное закрытие). */
  hideClose?: boolean;
}

/** Содержимое правой панели хронологии: шапка группы + таймлайн участников. */
export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  selectedTender,
  selectedGroup,
  selectedUserId,
  onUserSelect,
  currentUserId,
  currentUserRoleCode,
  canRespond,
  onDataChanged,
  refreshSignal,
  onClose,
  colorText,
  colorBorderSecondary,
  hideClose = false,
}) => {
  return (
    <>
      <div style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${colorBorderSecondary}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: colorText, lineHeight: 1.35 }}>
              {selectedGroup.name}
            </div>
            <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
              {selectedTender.title}
            </Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {selectedTender.tender_number}
            </Text>
          </div>
          {!hideClose && <Button type="text" icon={<CloseOutlined />} onClick={onClose} />}
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <UserTimeline
          group={selectedGroup}
          selectedUserId={selectedUserId}
          onUserSelect={onUserSelect}
          currentUserId={currentUserId}
          currentUserRoleCode={currentUserRoleCode}
          canRespond={canRespond}
          onDataChanged={onDataChanged}
          refreshSignal={refreshSignal}
        />
      </div>
    </>
  );
};
