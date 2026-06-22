import React from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';

interface HideOnPhoneProps {
  children: React.ReactNode;
}

/**
 * Прячет содержимое на телефоне (портрет и ландшафт) — флаг isPhoneDevice.
 * Используется для кнопок действий (экспорт/импорт/редактирование/сохранение),
 * которых не должно быть в мобильных read-only-видах.
 */
export const HideOnPhone: React.FC<HideOnPhoneProps> = ({ children }) => {
  const { isPhoneDevice } = useIsMobile();
  if (isPhoneDevice) return null;
  return <>{children}</>;
};
