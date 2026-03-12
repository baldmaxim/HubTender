/**
 * Модальное окно для сопоставления и переноса данных между версиями тендера
 */

import { useState, useMemo } from 'react';
import { Modal, Upload, Button, Space, Divider, Alert, Result, Typography } from 'antd';
import {
  UploadOutlined,
  FileExcelOutlined,
  CheckCircleOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import type { Tender } from '../../../../lib/supabase';
import { useFileParser } from './hooks/useFileParser';
import { useVersionMatching } from './hooks/useVersionMatching';
import { MatchStatistics } from './components/MatchStatistics';
import { MatchControls } from './components/MatchControls';
import { MatchingTable } from './components/MatchingTable';

const { Text, Title } = Typography;

interface VersionMatchModalProps {
  open: boolean;
  onClose: () => void;
  tender: Tender | null;
}

/**
 * Главный компонент модального окна сопоставления версий
 *
 * Workflow:
 * 1. Загрузить Excel файл новой версии
 * 2. Автоматическое сопоставление позиций
 * 3. Ручная корректировка (при необходимости)
 * 4. Создание новой версии тендера
 * 5. Перенос данных и дополнительных работ
 */
export function VersionMatchModal({ open, onClose, tender }: VersionMatchModalProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  // Хук парсинга Excel
  const {
    parsedData,
    parseResult,
    parsing,
    error: parseError,
    parseFile,
    reset: resetParser,
  } = useFileParser();

  // Мемоизируем newPositions чтобы избежать создания нового массива на каждом рендере
  const newPositions = useMemo(() => parsedData || [], [parsedData]);

  // Хук сопоставления версий
  const {
    state,
    performAutoMatch,
    toggleTransfer,
    acceptAllLowConfidence,
    manualMatch,
    breakMatch,
    setFilter,
    createVersion,
    reset: resetMatching,
  } = useVersionMatching({
    sourceTender: tender,
    newPositions,
  });

  /**
   * Обработка загрузки файла
   */
  const handleFileUpload = async (file: File) => {
    setFileList([
      {
        uid: '-1',
        name: file.name,
        status: 'uploading',
        percent: 0,
      } as UploadFile,
    ]);

    await parseFile(file);

    setFileList([
      {
        uid: '-1',
        name: file.name,
        status: 'done',
        percent: 100,
      } as UploadFile,
    ]);

    return false; // Предотвратить автоматическую загрузку
  };

  /**
   * Создать новую версию
   */
  const handleCreateVersion = async () => {
    await createVersion();
  };

  /**
   * Закрыть модальное окно
   */
  const handleClose = () => {
    resetParser();
    resetMatching();
    setFileList([]);
    onClose();
  };

  /**
   * Футер модального окна
   */
  const modalFooter = () => {
    // Если версия создана успешно
    if (state.newTenderId) {
      return (
        <Button type="primary" onClick={handleClose}>
          Закрыть
        </Button>
      );
    }

    // Если есть сопоставления
    if (state.matches.length > 0) {
      return (
        <Space>
          <Button onClick={handleClose}>Отмена</Button>
          <Button
            type="primary"
            onClick={handleCreateVersion}
            loading={state.creating}
            icon={<CheckCircleOutlined />}
          >
            Создать новую версию
          </Button>
        </Space>
      );
    }

    // По умолчанию
    return (
      <Button onClick={handleClose}>Отмена</Button>
    );
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <SwapOutlined />
          <span>Сопоставление версий тендера</span>
          {tender && (
            <Text type="secondary">
              №{tender.tender_number} v{tender.version}
            </Text>
          )}
        </Space>
      }
      onCancel={handleClose}
      footer={modalFooter()}
      width="90%"
      style={{ top: 20 }}
      bodyStyle={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
    >
      {/* Успешное создание версии */}
      {state.newTenderId && (
        <Result
          status="success"
          title="Новая версия создана успешно!"
          subTitle={
            <Space direction="vertical" size="small">
              <Text>
                Тендер №{tender?.tender_number} v{((tender?.version || 0) + 1)} создан.
              </Text>
              <Text>Все данные успешно перенесены.</Text>
            </Space>
          }
          extra={
            <Button type="primary" onClick={handleClose}>
              Закрыть
            </Button>
          }
        />
      )}

      {/* Рабочий интерфейс */}
      {!state.newTenderId && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Информация о тендере */}
          {tender && (
            <Alert
              message={`Исходный тендер: №${tender.tender_number} v${tender.version || 0}`}
              description={`Будет создана новая версия: v${(tender.version || 0) + 1}`}
              type="info"
              showIcon
            />
          )}

          {/* Загрузка Excel файла */}
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Title level={5}>
              <FileExcelOutlined /> Шаг 1: Загрузите Excel файл новой версии
            </Title>
            <Upload
              beforeUpload={handleFileUpload}
              fileList={fileList}
              maxCount={1}
              accept=".xlsx,.xls"
              onRemove={() => {
                setFileList([]);
                resetParser();
                resetMatching();
              }}
            >
              <Button icon={<UploadOutlined />} loading={parsing}>
                Загрузить Excel файл
              </Button>
            </Upload>

            {parseError && (
              <Alert message="Ошибка парсинга" description={parseError} type="error" showIcon />
            )}
          </Space>

          {/* Сопоставление */}
          {newPositions.length > 0 && (
            <>
              <Divider />

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Title level={5}>
                  <SwapOutlined /> Шаг 2: Сопоставьте позиции
                </Title>

                <MatchControls
                  filter={state.filter}
                  onFilterChange={setFilter}
                  onAutoMatch={performAutoMatch}
                  onAcceptAllLowConfidence={acceptAllLowConfidence}
                  autoMatchDisabled={state.matches.length > 0}
                  acceptAllDisabled={!state.matches.some(m => m.matchType === 'low_confidence' && !m.transferData)}
                  loading={state.loading}
                />
              </Space>

              {/* Статистика */}
              {state.matches.length > 0 && (
                <>
                  <MatchStatistics matches={state.matches} loading={state.loading} />

                  {/* Таблица сопоставления */}
                  <MatchingTable
                    matches={state.matches}
                    newPositions={newPositions}
                    filter={state.filter}
                    onToggleTransfer={toggleTransfer}
                    onManualMatch={manualMatch}
                    onBreakMatch={breakMatch}
                    loading={state.loading}
                  />
                </>
              )}
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
