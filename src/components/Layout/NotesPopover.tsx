import React, { useState, useEffect } from 'react';
import { Input, Button, Divider, Spin, Typography, Space, Empty } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTenderNotes } from '../../hooks/useTenderNotes';
import { canViewAllNotes } from '../../lib/types/types';

const { TextArea } = Input;
const { Text } = Typography;

interface NotesPopoverContentProps {
  tenderId: string | null;
  userId: string | null;
  roleCode: string;
  currentTheme: string;
  /** Ширина контейнера. На мобильных модалках передаётся '100%'. */
  width?: number | string;
}

export const NotesPopoverContent: React.FC<NotesPopoverContentProps> = ({
  tenderId,
  userId,
  roleCode,
  currentTheme,
  width = 360,
}) => {
  const isPrivileged = canViewAllNotes(roleCode);
  const { myNote, allNotes, loading, saving, saveNote } = useTenderNotes(
    tenderId,
    userId,
    isPrivileged,
  );

  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    setDraftText(myNote?.note_text ?? '');
  }, [myNote]);

  const isDark = currentTheme === 'dark';
  const mutedColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const noteBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const ownNoteBg = isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)';

  if (!tenderId) {
    return (
      <div style={{ width, maxWidth: '100%', padding: '8px 0' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ color: mutedColor, fontSize: 12 }}>
              Выберите тендер на странице&nbsp;позиций заказчика
            </Text>
          }
        />
      </div>
    );
  }

  return (
    <Spin spinning={loading}>
      <div style={{ width, maxWidth: '100%' }}>
        {/* Поле ввода своей заметки */}
        <div style={{ fontSize: 11, color: mutedColor, marginBottom: 4 }}>Ваша заметка</div>
        <TextArea
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          placeholder="Введите заметку к тендеру..."
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{ marginBottom: 8, resize: 'none' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={draftText === (myNote?.note_text ?? '') || saving}
            onClick={() => saveNote(draftText)}
          >
            Сохранить
          </Button>
        </div>

        {/* Все заметки тендера (только для привилегированных ролей) */}
        {isPrivileged && allNotes.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0', borderColor: dividerColor }} />
            <div style={{ fontSize: 11, color: mutedColor, marginBottom: 6 }}>
              Заметки всех пользователей
            </div>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {allNotes.map(note => {
                const isOwn = note.user_id === userId;
                return (
                  <div
                    key={note.id}
                    style={{
                      background: isOwn ? ownNoteBg : noteBg,
                      borderRadius: 4,
                      padding: '6px 8px',
                      fontSize: 12,
                      border: isOwn
                        ? `1px solid ${isDark ? 'rgba(16,185,129,0.25)' : 'rgba(16,185,129,0.3)'}`
                        : '1px solid transparent',
                    }}
                  >
                    {/* ФИО — дата */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text strong style={{ fontSize: 12 }}>
                        {note.user_full_name}
                        {isOwn && (
                          <Text style={{ fontSize: 10, color: '#10b981', marginLeft: 4 }}>
                            (вы)
                          </Text>
                        )}
                      </Text>
                      <Text style={{ fontSize: 11, color: mutedColor }}>
                        {dayjs(note.updated_at).format('DD.MM.YY HH:mm')}
                      </Text>
                    </div>
                    {/* Текст заметки */}
                    <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {note.note_text}
                    </Text>
                  </div>
                );
              })}
            </Space>
          </>
        )}
      </div>
    </Spin>
  );
};
