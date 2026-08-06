import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useIsMobile } from '../../hooks/useIsMobile';
import './UpdateBanner.css';

/** Как часто спрашивать сервер, не появился ли новый service worker. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Ключ хранилища: версия, которую пользователь отложил кнопкой «Позже». */
const DISMISS_KEY = 'tenderHub_update_dismissed';

/** Отложенная версия. localStorage может быть недоступен в приватном режиме. */
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* приватный режим — скроем хотя бы до перезагрузки вкладки */
  }
}

/**
 * Версия сборки, лежащей на сервере прямо сейчас.
 *
 * `version.json` не попадает в precache service worker'а, но между браузером и
 * сервером может стоять кеширующий прокси — отсюда no-store и cache-busting.
 * Если файла нет (старый деплой), возвращаем null: баннер всё равно покажем,
 * просто «Позже» будет действовать до перезагрузки вкладки.
 */
async function fetchServerVersion(): Promise<string | null> {
  try {
    const resp = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Баннер «Доступна новая версия» — фиксирован сверху по центру.
 *
 * Триггер — needRefresh от service worker: он срабатывает ровно тогда, когда на
 * сервере уже лежит другая сборка. Это важно не только для удобства: прод-деплой
 * делает `rsync --delete`, и открытая вкладка со старым index.html начинает
 * получать 404 на lazy-чанках при навигации.
 */
export default function UpdateBanner() {
  const { isPhone } = useIsMobile();
  const [version, setVersion] = useState<string | null>(null);
  const [versionChecked, setVersionChecked] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const timerRef = useRef<number | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    // Транзиентный сбой сети при загрузке /sw.js (окно деплоя, редирект с /login)
    // не должен всплывать в Sentry как unhandledrejection.
    onRegisterError() {
      /* некритично — молча игнорируем сбой регистрации SW */
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Без периодической проверки браузер спрашивает про новый SW только при
      // навигации — в SPA её может не случиться за весь рабочий день.
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        void registration.update();
      }, CHECK_INTERVAL_MS);
    },
  });

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!needRefresh) return;
    let stale = false;
    void fetchServerVersion().then((v) => {
      if (stale) return;
      setVersion(v);
      setVersionChecked(true);
    });
    return () => {
      stale = true;
    };
  }, [needRefresh]);

  const onLater = useCallback(() => {
    // Версию сервера узнать не удалось — привязываемся к собственной сборке и
    // запоминаем только на сессию вкладки, чтобы не заглушить будущие обновления.
    const key = version ?? __BUILD_ID__;
    if (version) {
      writeDismissed(version);
    } else {
      try {
        sessionStorage.setItem(DISMISS_KEY, key);
      } catch {
        /* хранилище недоступно */
      }
    }
    setDismissed(key);
    setNeedRefresh(false);
  }, [version, setNeedRefresh]);

  const onUpdate = useCallback(() => {
    void updateServiceWorker(true); // сам перезагрузит страницу
  }, [updateServiceWorker]);

  // Ждём ответа version.json: иначе уже отложенная сборка мигала бы баннером
  // на долю секунды при каждой проверке обновлений.
  if (!needRefresh || !versionChecked) return null;
  if ((version ?? __BUILD_ID__) === dismissed) return null;

  return (
    <div className={`update-banner${isPhone ? ' update-banner--phone' : ''}`}>
      <Alert
        type="info"
        showIcon
        message="Доступна новая версия"
        description="Обновите страницу, чтобы продолжить работу в актуальной версии приложения."
        action={
          <Space wrap>
            <Button size="small" type="primary" onClick={onUpdate}>
              Обновить
            </Button>
            <Button size="small" onClick={onLater}>
              Позже
            </Button>
          </Space>
        }
      />
    </div>
  );
}
