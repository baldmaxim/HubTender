import dayjs from 'dayjs';

export interface DeadlineProgress {
  /** 'none' — дедлайн не указан; 'completed' — прошёл; 'active' — идёт обратный отсчёт. */
  state: 'none' | 'completed' | 'active';
  percent: number;
  color: string;
  /** CSS-класс строки таблицы (deadline-critical/-warning/-caution/-completed или ''). */
  className: string;
  remainingText: string;
}

/**
 * Единый расчёт прогресса дедлайна — используется и в колонке таблицы, и в rowClassName,
 * и в карточном представлении, чтобы цвет/процент/класс считались в одном месте.
 */
export function computeDeadlineProgress(deadline: string, createdAt: string): DeadlineProgress {
  if (!deadline) {
    return { state: 'none', percent: 0, color: '#10b981', className: '', remainingText: '' };
  }

  const now = dayjs();
  const deadlineDate = dayjs(deadline);
  const createdDate = dayjs(createdAt);

  if (deadlineDate.isBefore(now)) {
    return { state: 'completed', percent: 100, color: '#10b981', className: 'deadline-completed', remainingText: '' };
  }

  const totalDuration = deadlineDate.diff(createdDate, 'millisecond');
  const elapsedDuration = now.diff(createdDate, 'millisecond');
  const percent = Math.min(Math.round((elapsedDuration / totalDuration) * 100), 99);

  const remainingDuration = deadlineDate.diff(now);
  const remainingDays = Math.floor(remainingDuration / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((remainingDuration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  let remainingText: string;
  if (remainingDays > 0) {
    remainingText = `${remainingDays} дн. ${remainingHours} ч.`;
  } else if (remainingHours > 0) {
    remainingText = `${remainingHours} ч.`;
  } else {
    remainingText = `${Math.floor(remainingDuration / (1000 * 60))} мин.`;
  }

  let color = '#10b981';
  let className = '';
  if (percent > 90) {
    color = '#ef4444';
    className = 'deadline-critical';
  } else if (percent > 75) {
    color = '#f97316';
    className = 'deadline-warning';
  } else if (percent > 50) {
    color = '#eab308';
    className = 'deadline-caution';
  }

  return { state: 'active', percent, color, className, remainingText };
}
