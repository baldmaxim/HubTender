import type { FC } from 'react';
import { CheckOutlined } from '@ant-design/icons';

/** Визуальный флажок выбора; состояние озвучивает сам элемент (role="checkbox"). */
export const SelectCheck: FC<{ checked: boolean }> = ({ checked }) => (
  <span className={checked ? 'tm-check tm-check--on' : 'tm-check'} aria-hidden>
    <CheckOutlined />
  </span>
);
