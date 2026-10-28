/** localStorage без исключений (приватный режим, квота, отключённое хранилище). */
export const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // хранилище недоступно — настройка просто не сохранится
  }
};
