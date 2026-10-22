import { useMemo, useState, type CSSProperties, type FC, type ReactElement } from 'react';
import { ConfigProvider, Popover, type PopoverProps } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../lib/types';
import {
  getDashboardStatus,
  getDashboardStatusLabel,
  getDaysSinceControl,
} from '../utils/tenderMonitor';
import type { TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import './CallListPopover.css';

interface ICallListPopoverProps {
  /** Тендеры, которым пора звонить (shouldShowCallAction). */
  tenders: TenderRegistryWithRelations[];
  palette: TenderMonitorPalette;
  /** Скрыть «Позвонить» (генеральный директор, телефон). */
  readOnly?: boolean;
  placement?: PopoverProps['placement'];
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  children: ReactElement;
}

// Свою «выезжающую» анимацию даёт CSS (.tm-calls), штатный zoom antd здесь выключен.
const NO_MOTION_THEME = { token: { motion: false } };

/** Выезжающий по нажатию список «Кому позвонить»: самые давние без контроля — сверху. */
export const CallListPopover: FC<ICallListPopoverProps> = ({
  tenders,
  palette,
  readOnly,
  placement = 'bottom',
  onOpenTender,
  onQuickCall,
  children,
}) => {
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () =>
      tenders
        .map((tender) => ({ tender, days: getDaysSinceControl(tender) ?? 0 }))
        .sort((left, right) => right.days - left.days),
    [tenders]
  );

  const vars = {
    '--tm-calls-text': palette.text,
    '--tm-calls-muted': palette.muted,
    '--tm-calls-border': palette.borderSoft,
    '--tm-calls-hover': palette.disabledBg,
    '--tm-calls-danger': palette.danger,
    '--tm-calls-danger-bg': palette.dangerBg,
    '--tm-calls-danger-border': palette.dangerBorder,
    '--tm-calls-focus': palette.info,
  } as CSSProperties;

  const content = (
    <div className="tm-calls" style={vars}>
      <div className="tm-calls__head">
        <PhoneOutlined aria-hidden />
        Кому позвонить
        <span className="tm-calls__count">{rows.length}</span>
      </div>
      {rows.length > 0 ? (
        <ul className="tm-calls__list">
          {rows.map(({ tender, days }, index) => (
            <li
              key={tender.id}
              className="tm-calls__item"
              style={{ '--tm-calls-i': Math.min(index, 8) } as CSSProperties}
            >
              <button
                type="button"
                className="tm-calls__open"
                onClick={() => {
                  setOpen(false);
                  onOpenTender(tender);
                }}
              >
                <span className="tm-calls__title">{tender.title}</span>
                <span className="tm-calls__meta">
                  {tender.client_name || 'Заказчик не указан'} · {getDashboardStatusLabel(getDashboardStatus(tender))}
                </span>
              </button>
              <span className="tm-calls__days" title="Дней с последнего контроля">
                {days} дн
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  className="tm-calls__call"
                  aria-label={`Отметить звонок: ${tender.title}`}
                  title="Отметить звонок в хронологии"
                  onClick={() => {
                    // Список закрываем, как при открытии тендера: иначе он висит поверх окна описания звонка.
                    setOpen(false);
                    void onQuickCall(tender);
                  }}
                >
                  <PhoneOutlined />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="tm-calls__empty">Все звонки сделаны</div>
      )}
    </div>
  );

  return (
    <ConfigProvider theme={NO_MOTION_THEME}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement={placement}
        arrow={false}
        content={content}
        styles={{
          body: {
            padding: 0,
            background: palette.panelBg,
            border: `1px solid ${palette.border}`,
            borderRadius: 12,
            overflow: 'hidden',
          },
        }}
      >
        {children}
      </Popover>
    </ConfigProvider>
  );
};
