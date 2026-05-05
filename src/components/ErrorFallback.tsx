import { Result, Button } from 'antd';

interface ErrorFallbackProps {
  error: unknown;
  resetError: () => void;
}

export default function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ padding: 24, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        status="error"
        title="Что-то пошло не так"
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
