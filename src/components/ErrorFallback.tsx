import { Result, Button } from 'antd';

interface ErrorFallbackProps {
  error: unknown;
  resetError: () => void;
  /** Внутри вкладки рабочего стола: без высоты во весь экран (остальные вкладки живы). */
  compact?: boolean;
}

export default function ErrorFallback({ error, resetError, compact = false }: ErrorFallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        padding: 24,
        minHeight: compact ? undefined : '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Result
        status="error"
        title={compact ? 'Страница не отобразилась' : 'Что-то пошло не так'}
        subTitle={message || 'Произошла непредвиденная ошибка. Мы уже получили отчёт.'}
        extra={[
          <Button key="reload" type="primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>,
          <Button key="reset" onClick={resetError}>
            Попробовать снова
          </Button>,
        ]}
      />
    </div>
  );
}
