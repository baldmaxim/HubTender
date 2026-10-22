import { useRef, useState } from 'react';
import type { CSSProperties, FC } from 'react';
import { Input, Modal } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { LoadingOutlined, PhoneOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../lib/types';
import { textareaEnterToSave } from '../../../utils/keyboardSave';
import { getTenderControlVars, type TenderMonitorPalette } from '../utils/tenderMonitorTheme';

interface ICallNoteDialogProps {
  open: boolean;
  tender: TenderRegistryWithRelations | null;
  saving: boolean;
  palette: TenderMonitorPalette;
  onCancel: () => void;
  onSave: (text: string) => void;
}

/** Окно описания звонка: в хронологию звонок попадает только с непустым текстом. */
export const CallNoteDialog: FC<ICallNoteDialogProps> = ({ open, tender, saving, palette, onCancel, onSave }) => {
  const [text, setText] = useState('');
  const textAreaRef = useRef<TextAreaRef>(null);

  const trimmed = text.trim();
  const canSave = trimmed !== '' && !saving;
  const submit = () => {
    if (canSave) {
      onSave(trimmed);
    }
  };

  const meta = tender
    ? [tender.client_name, tender.tender_number ? `№${tender.tender_number}` : null].filter(Boolean).join(' · ')
    : '';

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      // Поверх окна тендера («Позвонить» есть и в его шапке); тосты antd выше.
      zIndex={1001}
      // Набранное описание не теряется от промаха мимо окна.
      maskClosable={!saving && trimmed === ''}
      keyboard={!saving}
      footer={null}
      closeIcon={null}
      width={440}
      centered
      afterOpenChange={(visible) => {
        if (visible) {
          textAreaRef.current?.focus();
        }
      }}
      // Поле пустое при следующем открытии.
      afterClose={() => setText('')}
      styles={{
        content: {
          background: palette.cardBg,
          border: `1px solid ${palette.dangerBorder}`,
          borderRadius: 14,
          padding: 0,
          overflow: 'hidden',
        },
        body: { padding: 0 },
        mask: { backdropFilter: 'blur(4px)' },
      }}
    >
      <div className="tm-call-note" style={getTenderControlVars(palette) as CSSProperties}>
        <div className="tm-call-note__title">
          <PhoneOutlined aria-hidden />
          Описание звонка
        </div>
        {tender ? (
          <div className="tm-call-note__tender">
            <div className="tm-call-note__name">{tender.title}</div>
            {meta ? <div className="tm-call-note__meta">{meta}</div> : null}
          </div>
        ) : null}
        <Input.TextArea
          ref={textAreaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={textareaEnterToSave(submit, setText)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          allowClear
          disabled={saving}
          placeholder="С кем говорили и о чём договорились"
          aria-label="Описание звонка"
        />
        <p className="tm-call-note__hint">
          Без описания звонок в хронологию не попадёт. Enter — записать, Shift+Enter — новая строка.
        </p>
        <div className="tm-call-note__actions">
          <button type="button" className="tm-btn" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button
            type="button"
            className="tm-btn tm-btn--danger"
            onClick={submit}
            disabled={!canSave}
            aria-busy={saving || undefined}
          >
            {saving ? <LoadingOutlined aria-hidden /> : <PhoneOutlined aria-hidden />}
            Записать звонок
          </button>
        </div>
      </div>
    </Modal>
  );
};
