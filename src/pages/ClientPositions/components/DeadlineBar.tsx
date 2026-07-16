import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import type { Tender } from '../../../lib/types';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Text } = Typography;

interface DeadlineBarProps {
  selectedTender: Tender;
  currentTheme: string;
}

export const DeadlineBar: React.FC<DeadlineBarProps> = ({ selectedTender, currentTheme }) => {
  // Только портрет телефона (<576px): в ландшафте ширины (844px) хватает на 14px.
  const { isPhone } = useIsMobile();
  const [now, setNow] = useState(() => dayjs());
  const deadlineStr = selectedTender.submission_deadline;
  const isExpired = deadlineStr ? dayjs(deadlineStr).isBefore(now) : false;

  // Страница «Позиции заказчика» под keep-alive почти не перерисовывается, поэтому
  // тикаем сами, чтобы шкала продвигалась. После дедлайна таймер не запускаем.
  useEffect(() => {
    if (!deadlineStr || isExpired) return;
    const id = setInterval(() => setNow(dayjs()), 60_000); // минутной гранулярности достаточно — шкала меряется в днях
    return () => clearInterval(id);
  }, [deadlineStr, isExpired]);

  if (!deadlineStr) return null;

  const deadline = dayjs(deadlineStr);

  // Вычисляем общую длительность от даты создания до дедлайна.
  // Если created_at отсутствует/невалиден — шкала на 0% (не зависает на 100%).
  const createdAt = dayjs(selectedTender.created_at);
  const hasAnchor = !!selectedTender.created_at && createdAt.isValid();
  const totalDays = hasAnchor ? deadline.diff(createdAt, 'day', true) : 0;
  const daysRemaining = deadline.diff(now, 'day', true);
  const progress = isExpired
    ? 100
    : hasAnchor && totalDays > 0
      ? Math.max(0, Math.min(100, ((totalDays - daysRemaining) / totalDays) * 100))
      : 0;

  const percentage = Math.round(progress);

  // Телефон: 9px + nowrap — вся шкала в одну строку (~338px из 390px).
  // lineHeight прижат к кеглю: от него напрямую зависит высота полосы ниже.
  const barText: React.CSSProperties = {
    color: 'white',
    fontWeight: 600,
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    ...(isPhone ? { fontSize: 9, lineHeight: '12px', whiteSpace: 'nowrap' as const } : null),
  };

  return (
    <div style={{
      position: 'relative',
      marginTop: 0,
      // Телефон: 12px строка + по 2px сверху/снизу — минимальный отступ до края шкалы.
      height: isPhone ? 16 : 40,
      borderRadius: '0 0 8px 8px',
      overflow: 'hidden',
      background: currentTheme === 'dark' ? '#0a5348' : '#ccfbf1',
    }}>
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        height: '100%',
        width: `${progress}%`,
        background: '#c62828',
        transition: 'all 0.5s ease',
      }} />
      <div style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: isPhone ? 6 : 24,
        padding: isPhone ? '0 8px' : '0 32px',
        zIndex: 1,
      }}>
        <Text style={barText}>
          {isExpired
            ? `Дедлайн истек ${now.diff(deadline, 'day')} дней назад`
            : `До дедлайна осталось ${Math.ceil(daysRemaining)} дней`
          }
        </Text>
        <Text style={barText}>
          Дедлайн: {deadline.format('DD MMMM YYYY, HH:mm')}
        </Text>
        <Text style={barText}>
          {`${percentage}%`}
        </Text>
      </div>
    </div>
  );
};
