import React, { useState } from 'react';
import { Popover, Modal } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { NotesPopoverContent } from './NotesPopover';

interface NotesWidgetProps {
  tenderId: string | null;
  userId: string | null;
  roleCode: string;
  currentTheme: string;
  /** На мобильных (<992px) заметки открываются модалкой по центру сверху. */
  isMobileLayout: boolean;
  isPhone: boolean;
}

export const NotesWidget: React.FC<NotesWidgetProps> = ({
  tenderId,
  userId,
  roleCode,
  currentTheme,
  isMobileLayout,
  isPhone,
}) => {
  const [notesOpen, setNotesOpen] = useState(false);

  const icon = (
    <MessageOutlined
      style={{
        fontSize: isPhone ? '20px' : '24px',
        cursor: 'pointer',
        color: tenderId ? '#10b981' : '#8c8c8c',
        fontWeight: 'bold',
      }}
    />
  );

  if (isMobileLayout) {
    return (
      <>
        <span onClick={() => setNotesOpen(true)}>{icon}</span>
        <Modal
          title="Заметки к тендеру"
          open={notesOpen}
          onCancel={() => setNotesOpen(false)}
          footer={null}
          destroyOnHidden
          width="92vw"
          style={{ top: 24, maxWidth: 420 }}
          styles={{ body: { paddingTop: 8 } }}
        >
          <NotesPopoverContent
            tenderId={tenderId}
            userId={userId}
            roleCode={roleCode}
            currentTheme={currentTheme}
            width="100%"
          />
        </Modal>
      </>
    );
  }

  return (
    <Popover
      content={
        <NotesPopoverContent
          tenderId={tenderId}
          userId={userId}
          roleCode={roleCode}
          currentTheme={currentTheme}
        />
      }
      title="Заметки к тендеру"
      trigger="click"
      open={notesOpen}
      onOpenChange={setNotesOpen}
      placement="bottomRight"
      destroyOnHidden
    >
      {icon}
    </Popover>
  );
};

export default NotesWidget;
