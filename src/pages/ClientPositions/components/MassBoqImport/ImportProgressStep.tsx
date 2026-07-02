import React from 'react';
import { Alert, Progress, Space } from 'antd';

/** Шаг 2 массового импорта BOQ: прогресс / успех / ошибка. */
export const ImportProgressStep: React.FC<{
  importStatus: 'idle' | 'running' | 'success' | 'error';
  importError: string | null;
  uploadProgress: number;
  parsedDataLength: number;
  matchedCount: number;
  positionOnlyCount: number;
}> = ({ importStatus, importError, uploadProgress, parsedDataLength, matchedCount, positionOnlyCount }) => (
  <Space direction="vertical" style={{ width: '100%' }} size="middle">
    {importStatus === 'running' && (
      <>
        <Alert
          type="info"
          message="Импорт данных"
          description={
            parsedDataLength > 0
              ? `Импортируется ${parsedDataLength} элементов в ${matchedCount} позиций${positionOnlyCount > 0 ? ` + обновление ${positionOnlyCount} поз. ГП` : ''}`
              : `Обновляется ${positionOnlyCount} позиций (данные ГП)`
          }
          showIcon
        />
        <Progress
          percent={uploadProgress}
          status="active"
          strokeColor={{ from: '#10b981', to: '#059669' }}
        />
      </>
    )}
    {importStatus === 'success' && (
      <Alert type="success" message="Импорт завершён успешно!" showIcon />
    )}
    {importStatus === 'error' && (
      <Alert
        type="error"
        message="Импорт не выполнен — данные не загружены"
        description={importError || 'Произошла ошибка при импорте.'}
        showIcon
      />
    )}
  </Space>
);
