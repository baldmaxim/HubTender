import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'tenderHub_theme';
/** Класс на <html> на время смены темы — стили в src/index.css. */
const THEME_SWITCHING_CLASS = 'theme-switching';

type ThemeViewTransition = ReturnType<Document['startViewTransition']>;

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    // Получаем сохраненную тему из localStorage
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    // По умолчанию используем темную тему
    return 'dark';
  });
  const transitionRef = useRef<ThemeViewTransition | null>(null);

  // Layout-эффект: атрибут должен встать до снимка новой темы, а не после отрисовки.
  useLayoutEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Цвета на страницах приходят тремя путями с разной скоростью: стили antd (переход 0,2 с),
  // фон раскладки (0,3 с) и цвета, посчитанные в JS (мгновенно), — поэтому без общего снимка
  // страница перекрашивалась кусками. Здесь вся перерисовка идёт синхронно под снимком старой
  // темы, свои переходы элементов на это время выключены, а новая тема проявляется поверх
  // (View Transitions API, прозрачность — анимация идёт на композиторе и не дёргается).
  // До снимка ничего не делаем: класс ставится в том же синхронном блоке, что и смена темы, —
  // переходы не стартуют, а лишний пересчёт стилей не задерживает начало.
  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const apply = () => {
      root.classList.add(THEME_SWITCHING_CLASS);
      flushSync(() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark')));
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('startViewTransition' in document)) {
      // Без анимации, но всё равно разом: переходы возвращаем после отрисовки новой темы.
      apply();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!transitionRef.current) root.classList.remove(THEME_SWITCHING_CLASS);
      }));
      return;
    }

    const transition = document.startViewTransition(apply);
    transitionRef.current = transition;
    // ready отклоняется, если переход пропущен (повторный клик) — это не ошибка.
    transition.ready.catch(() => undefined);
    transition.finished.catch(() => undefined).then(() => {
      // Быстрый повторный клик запускает новый переход — класс снимает только последний.
      if (transitionRef.current !== transition) return;
      transitionRef.current = null;
      root.classList.remove(THEME_SWITCHING_CLASS);
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
