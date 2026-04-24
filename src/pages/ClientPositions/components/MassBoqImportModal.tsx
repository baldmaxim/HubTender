import React, { useState, useEffect } from 'react';
import { Modal, Steps, Button, Space, Progress, Alert, Upload, Table, Tag, Typography, Collapse, List, Select } from 'antd';
import { FileExcelOutlined, CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useMassBoqImport } from '../hooks/useMassBoqImport';
import { BoqPreviewTable } from './BoqPreviewTable';
import { useAuth } from '../../../contexts/AuthContext';

const { Dragger } = Upload;
const { Text } = Typography;
const { Panel } = Collapse;

interface MassBoqImportModalProps {
  open: boolean;
  tenderId: string;
  tenderTitle: string;
  onClose: (success: boolean) => void;
}

export const MassBoqImportModal: React.FC<MassBoqImportModalProps> = ({
  open,
  tenderId,
  tenderTitle,
  onClose,
}) => {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [nomenclatureLoaded, setNomenclatureLoaded] = useState(false);
  const [addingToNomenclature, setAddingToNomenclature] = useState(false);

  const {
    parsedData,
    positionUpdates,
    validationResult,
    uploading,
    uploadProgress,
    clientPositionsMap,
    existingItemsByPosition,
    availableUnits,
    unitMappings,
    getUnknownUnits,
    setUnitMapping,
    applyUnitMappings,
    loadNomenclature,
    parseExcelFile,
    validateParsedData,
    processWorkBindings,
    insertBoqItems,
    addMissingToNomenclature,
    loadExistingItems,
    reset,
    getPositionStats,
  } = useMassBoqImport();

  // Загрузка справочников при открытии
  useEffect(() => {
    if (open && tenderId && !nomenclatureLoaded) {
      loadNomenclature(tenderId).then((success) => {
        setNomenclatureLoaded(success);
        if (!success) {
          Modal.error({
            title: 'Ошибка загрузки',
            content: 'Не удалось загрузить справочники. Попробуйте закрыть и открыть модал заново.',
          });
        }
      });
    }
    // loadNomenclature is a stable hook-returned function; intentionally excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenderId, nomenclatureLoaded]);

  // Сброс при закрытии
  useEffect(() => {
    if (!open) {
      setNomenclatureLoaded(false);
      setCurrentStep(0);
      reset();
    }
    // reset is a stable hook-returned function; intentionally excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Загрузка существующих BOQ items при переходе на шаг 1
  useEffect(() => {
    if (currentStep === 1 && positionUpdates.size > 0) {
      const ids = Array.from(positionUpdates.keys())
        .map(posNum => clientPositionsMap.get(posNum)?.id)
        .filter(Boolean) as string[];
      loadExistingItems(ids);
    }
    // clientPositionsMap and loadExistingItems are stable; intentionally excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, positionUpdates]);

  // Обработка загрузки файла
  const handleFileUpload = async (file: File) => {
    const success = await parseExcelFile(file);
    if (success) {
      setCurrentStep(1);
    }
    return false;
  };

  // Валидация
  const handleValidate = () => {
    const validation = validateParsedData(parsedData);
    const bindingErrors = processWorkBindings(parsedData);

    if (bindingErrors.length > 0) {
      validation.errors.push(...bindingErrors);
      validation.isValid = false;
    }

    if (validation.isValid) {
      handleImport();
    }
  };

  // Импорт
  const handleImport = async () => {
    setCurrentStep(2);
    const success = await insertBoqItems(parsedData, tenderId, user?.id);
    if (success) {
      setTimeout(() => handleClose(true), 500);
    }
  };

  // Применить маппинг единиц (parsedData обновится, затем пользователь нажимает Импортировать/Валидировать)
  const handleApplyUnitMappings = () => {
    applyUnitMappings();
  };

  // Добавить отсутствующую номенклатуру и повторить валидацию
  const handleAddMissingToNomenclature = async () => {
    setAddingToNomenclature(true);
    await addMissingToNomenclature(tenderId);
    setAddingToNomenclature(false);
  };

  // Закрытие
  const handleClose = (success: boolean = false) => {
    reset();
    setCurrentStep(0);
    setNomenclatureLoaded(false);
    onClose(success);
  };

  // Статистика по позициям
  const positionStats = getPositionStats();
  const matchedCount = positionStats.filter(p => p.matched).length;
  const unmatchedCount = positionStats.filter(p => !p.matched).length;
  const positionOnlyCount = positionStats.filter(
    p => p.matched && p.itemsCount === 0 && (p.manualVolume !== undefined || p.manualNote !== undefined)
  ).length;
  const hasDataToImport = parsedData.length > 0 || positionOnlyCount > 0;
  const unknownUnits = getUnknownUnits();
  const allUnitsMapped = unknownUnits.every(u => !!unitMappings[u]);
  const hasUnmappedUnits = unknownUnits.length > 0 && !allUnitsMapped;

  // Кнопки футера
  const getFooterButtons = () => {
    if (currentStep === 0) {
      return [
        <Button key="cancel" onClick={() => handleClose(false)} disabled={uploading}>
          Отмена
        </Button>,
      ];
    }

    if (currentStep === 1) {
      const hasMissingNomenclature = validationResult && (
        validationResult.missingNomenclature.works.length > 0 ||
        validationResult.missingNomenclature.materials.length > 0
      );
      const missingCount = hasMissingNomenclature
        ? (validationResult!.missingNomenclature.works.length + validationResult!.missingNomenclature.materials.length)
        : 0;

      return [
        <Button key="back" onClick={() => setCurrentStep(0)} disabled={uploading || addingToNomenclature}>
          Назад
        </Button>,
        ...(unknownUnits.length > 0 ? [
          <Button
            key="applyMappings"
            type="default"
            onClick={handleApplyUnitMappings}
            disabled={hasUnmappedUnits || uploading}
          >
            Применить маппинг единиц {allUnitsMapped ? `(${unknownUnits.length})` : `(${unknownUnits.filter(u => unitMappings[u]).length}/${unknownUnits.length})`}
          </Button>
        ] : []),
        ...(hasMissingNomenclature ? [
          <Button
            key="addNomenclature"
            onClick={handleAddMissingToNomenclature}
            loading={addingToNomenclature}
            disabled={uploading || hasUnmappedUnits}
          >
            Добавить в номенклатуру ({missingCount})
          </Button>
        ] : []),
        <Button
          key="import"
          type="primary"
          onClick={handleValidate}
          disabled={!hasDataToImport || addingToNomenclature || hasUnmappedUnits}
          loading={uploading}
        >
          {hasUnmappedUnits
            ? 'Сопоставьте единицы измерения'
            : parsedData.length > 0 && positionOnlyCount > 0
                ? `Загрузить ${parsedData.length} элементов + ${positionOnlyCount} поз. ГП`
                : parsedData.length > 0
                  ? `Загрузить ${parsedData.length} элементов`
                  : `Загрузить ${positionOnlyCount} позиций (данные ГП)`
          }
        </Button>,
      ];
    }

    if (currentStep === 2) {
      return [
        <Button key="close" onClick={() => handleClose(true)} disabled={uploading}>
          Закрыть
        </Button>,
      ];
    }

    return [];
  };

  return (
    <Modal
      title={`Массовый импорт BOQ — ${tenderTitle}`}
      open={open}
      onCancel={() => handleClose(false)}
      width={1000}
      footer={getFooterButtons()}
      maskClosable={!uploading}
      keyboard={!uploading}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Шаги */}
        <Steps current={currentStep} size="small">
          <Steps.Step title="Загрузка файла" />
          <Steps.Step title="Проверка и сопоставление" />
          <Steps.Step title="Импорт" />
        </Steps>

        {/* Шаг 0: Загрузка файла */}
        {currentStep === 0 && (
          <div>
            <Alert
              message="Формат файла для массового импорта"
              description={
                <div style={{ marginTop: 8 }}>
                  <Text strong>Обязательные колонки:</Text>
                  <List size="small" style={{ marginTop: 4 }}>
                    <List.Item>
                      <Text>Колонка 2: <Text code>Номер позиции</Text> — для сопоставления с позициями тендера</Text>
                    </List.Item>
                    <List.Item>
                      <Text>Колонка 3: <Text code>Затрата на строительство</Text></Text>
                    </List.Item>
                    <List.Item>
                      <Text>Колонка 5: <Text code>Тип элемента</Text> (раб, суб-раб, мат, суб-мат...)</Text>
                    </List.Item>
                    <List.Item>
                      <Text>Колонка 7: <Text code>Наименование</Text></Text>
                    </List.Item>
                    <List.Item>
                      <Text>Колонка 8: <Text code>Ед. изм.</Text></Text>
                    </List.Item>
                    <List.Item>
                      <Text type="secondary">
                        Если в позиции импортируются только материалы без работы, такая строка будет импортирована как независимый материал без привязки к работе.
                      </Text>
                    </List.Item>
                  </List>
                  <Text strong style={{ marginTop: 8, display: 'block' }}>Данные ГП для позиций (можно импортировать без работ/материалов):</Text>
                  <List size="small" style={{ marginTop: 4 }}>
                    <List.Item>
                      <Text>Колонка 12: <Text code>Количество ГП</Text> — обновит manual_volume в позиции</Text>
                    </List.Item>
                    <List.Item>
                      <Text>Колонка 20: <Text code>Примечание ГП</Text> — обновит manual_note в позиции</Text>
                    </List.Item>
                    <List.Item>
                      <Text type="secondary">Достаточно указать номер позиции + количество/примечание ГП. Существующие значения будут перезаписаны.</Text>
                    </List.Item>
                  </List>
                </div>
              }
              type="info"
              style={{ marginBottom: 16 }}
            />

            <Alert
              message="Сопоставление по номеру позиции"
              description="Номер позиции из Excel будет сопоставлен с полем position_number в базе данных. Убедитесь, что номера совпадают (5 = 5.0 = 5.00)."
              type="warning"
              style={{ marginBottom: 16 }}
            />

            <Dragger
              beforeUpload={(file) => {
                handleFileUpload(file as File);
                return false;
              }}
              accept=".xlsx,.xls"
              maxCount={1}
              disabled={uploading || !nomenclatureLoaded}
              showUploadList={false}
            >
              <p className="ant-upload-drag-icon">
                <FileExcelOutlined style={{ color: '#10b981', fontSize: 48 }} />
              </p>
              <p className="ant-upload-text">
                {nomenclatureLoaded
                  ? 'Нажмите или перетащите Excel файл'
                  : 'Загрузка справочников...'
                }
              </p>
              <p className="ant-upload-hint">Поддерживаются форматы: .xlsx, .xls</p>
            </Dragger>
          </div>
        )}

        {/* Шаг 1: Проверка и сопоставление */}
        {currentStep === 1 && (
          <div>
            {/* Статистика сопоставления */}
            <Alert
              message={
                <Space>
                  <span>Найдено позиций: {positionStats.length}</span>
                  <Tag color="green">{matchedCount} сопоставлено</Tag>
                  {unmatchedCount > 0 && <Tag color="red">{unmatchedCount} не найдено</Tag>}
                </Space>
              }
              type={unmatchedCount > 0 ? 'warning' : 'success'}
              style={{ marginBottom: 16 }}
            />

            {/* Таблица позиций */}
            <Table
              dataSource={positionStats}
              rowKey="positionNumber"
              size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
              style={{ marginBottom: 16 }}
              columns={[
                {
                  title: '№ позиции',
                  dataIndex: 'positionNumber',
                  width: 100,
                },
                {
                  title: 'Статус',
                  dataIndex: 'matched',
                  width: 120,
                  render: (matched: boolean) => matched
                    ? <Tag icon={<CheckCircleOutlined />} color="success">Найдена</Tag>
                    : <Tag icon={<CloseCircleOutlined />} color="error">Не найдена</Tag>,
                },
                {
                  title: 'Название позиции',
                  dataIndex: 'positionName',
                  ellipsis: true,
                },
                {
                  title: 'Элементов',
                  dataIndex: 'itemsCount',
                  width: 100,
                  align: 'center',
                  render: (count: number, record: { manualVolume?: number; manualNote?: string }) => {
                    if (count === 0 && (record.manualVolume !== undefined || record.manualNote !== undefined)) {
                      return <Tag color="blue">только ГП</Tag>;
                    }
                    return count;
                  },
                },
                {
                  title: 'Кол-во ГП',
                  dataIndex: 'manualVolume',
                  width: 100,
                  render: (v: number | undefined) => v !== undefined ? v.toLocaleString('ru-RU') : '—',
                },
                {
                  title: 'Примечание ГП',
                  dataIndex: 'manualNote',
                  width: 150,
                  ellipsis: true,
                  render: (v: string | undefined) => v || '—',
                },
              ]}
            />

            {/* Предпросмотр: существующие и новые строки */}
            <Collapse defaultActiveKey={['preview']} style={{ marginBottom: 16 }}>
              <Panel header="Предпросмотр строк (существующие и новые)" key="preview">
                <BoqPreviewTable
                  parsedData={parsedData}
                  positionUpdates={positionUpdates}
                  clientPositionsMap={clientPositionsMap}
                  existingItemsByPosition={existingItemsByPosition}
                />
              </Panel>
            </Collapse>

            {/* Маппинг единиц измерения */}
            {unknownUnits.length > 0 && (
              <Alert
                type="warning"
                style={{ marginBottom: 16 }}
                message={`Единицы измерения не найдены в справочнике (${unknownUnits.length})`}
                description={
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Сопоставьте каждую единицу из файла с единицей в базе данных, затем нажмите «Применить маппинг единиц»
                    </Text>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={unknownUnits.map(u => ({ key: u, excelUnit: u }))}
                      columns={[
                        {
                          title: 'В файле',
                          dataIndex: 'excelUnit',
                          width: 160,
                          render: (u: string) => <Tag color="orange">{u}</Tag>,
                        },
                        {
                          title: '→ В базе данных',
                          key: 'mapping',
                          render: (_: unknown, row: { excelUnit: string }) => (
                            <Select
                              showSearch
                              style={{ width: 220 }}
                              placeholder="Выберите единицу..."
                              value={unitMappings[row.excelUnit] || undefined}
                              onChange={(val: string) => setUnitMapping(row.excelUnit, val)}
                              optionFilterProp="children"
                              filterOption={(input, opt) =>
                                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                              }
                              options={availableUnits.map(u => ({
                                value: u.code,
                                label: u.code === u.name ? u.code : `${u.code} — ${u.name}`,
                              }))}
                            />
                          ),
                        },
                        {
                          title: 'Статус',
                          key: 'status',
                          width: 100,
                          render: (_: unknown, row: { excelUnit: string }) =>
                            unitMappings[row.excelUnit]
                              ? <Tag color="success">✓ Сопоставлено</Tag>
                              : <Tag color="warning">Не задано</Tag>,
                        },
                      ]}
                    />
                  </div>
                }
              />
            )}

            {/* Ошибки валидации */}
            {validationResult && !validationResult.isValid && (
              <Collapse defaultActiveKey={['errors']} style={{ marginBottom: 16 }}>
                <Panel
                  header={
                    <Space>
                      <WarningOutlined style={{ color: '#ff4d4f' }} />
                      <span>Ошибки валидации ({validationResult.errors.length})</span>
                    </Space>
                  }
                  key="errors"
                >
                  {/* Несопоставленные позиции */}
                  {validationResult.unmatchedPositions.length > 0 && (
                    <Alert
                      message="Позиции не найдены в тендере"
                      description={
                        <List
                          size="small"
                          dataSource={validationResult.unmatchedPositions}
                          renderItem={item => (
                            <List.Item>
                              <Text type="danger">
                                Позиция "{item.positionNumber}" — строки: {item.rows.join(', ')}
                              </Text>
                            </List.Item>
                          )}
                        />
                      }
                      type="error"
                      style={{ marginBottom: 8 }}
                    />
                  )}

                  {/* Отсутствующая номенклатура — можно добавить кнопкой в футере */}
                  {validationResult.missingNomenclature.works.length > 0 && (
                    <Alert
                      message="Работы отсутствуют в номенклатуре — нажмите «Добавить в номенклатуру»"
                      description={
                        <List
                          size="small"
                          dataSource={validationResult.missingNomenclature.works}
                          renderItem={item => (
                            <List.Item>
                              <Text>
                                {item.name} [{item.unit}] — строки: {item.rows.join(', ')}
                              </Text>
                            </List.Item>
                          )}
                        />
                      }
                      type="warning"
                      style={{ marginBottom: 8 }}
                    />
                  )}

                  {validationResult.missingNomenclature.materials.length > 0 && (
                    <Alert
                      message="Материалы отсутствуют в номенклатуре — нажмите «Добавить в номенклатуру»"
                      description={
                        <List
                          size="small"
                          dataSource={validationResult.missingNomenclature.materials}
                          renderItem={item => (
                            <List.Item>
                              <Text>
                                {item.name} [{item.unit}] — строки: {item.rows.join(', ')}
                              </Text>
                            </List.Item>
                          )}
                        />
                      }
                      type="warning"
                      style={{ marginBottom: 8 }}
                    />
                  )}

                  {/* Неизвестные затраты */}
                  {validationResult.unknownCosts.length > 0 && (
                    <Alert
                      message="Затраты не найдены в БД"
                      description={
                        <List
                          size="small"
                          dataSource={validationResult.unknownCosts}
                          renderItem={item => (
                            <List.Item>
                              <Text type="danger">
                                {item.text} — строки: {item.rows.join(', ')}
                              </Text>
                            </List.Item>
                          )}
                        />
                      }
                      type="error"
                      style={{ marginBottom: 8 }}
                    />
                  )}

                  {/* Прочие ошибки (отсутствующие поля, неверные типы, ошибки привязки) */}
                  {(() => {
                    const otherErrors = validationResult.errors.filter(
                      e => !['position_not_found', 'missing_nomenclature', 'missing_cost'].includes(e.type)
                    );
                    if (otherErrors.length === 0) return null;
                    return (
                      <Alert
                        message={`Прочие ошибки (${otherErrors.length})`}
                        description={
                          <List
                            size="small"
                            dataSource={otherErrors.slice(0, 50)}
                            renderItem={item => (
                              <List.Item>
                                <Text type="danger">
                                  Строка {item.rowIndex}: {item.message}
                                </Text>
                              </List.Item>
                            )}
                            footer={otherErrors.length > 50 ? <Text type="secondary">...и ещё {otherErrors.length - 50} ошибок</Text> : undefined}
                          />
                        }
                        type="error"
                      />
                    );
                  })()}
                </Panel>
              </Collapse>
            )}
          </div>
        )}

        {/* Шаг 2: Импорт */}
        {currentStep === 2 && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="info"
              message="Импорт данных"
              description={
                parsedData.length > 0
                  ? `Импортируется ${parsedData.length} элементов в ${matchedCount} позиций${positionOnlyCount > 0 ? ` + обновление ${positionOnlyCount} поз. ГП` : ''}`
                  : `Обновляется ${positionOnlyCount} позиций (данные ГП)`
              }
              showIcon
            />
            {uploading && (
              <Progress
                percent={uploadProgress}
                status="active"
                strokeColor={{ from: '#10b981', to: '#059669' }}
              />
            )}
            {!uploading && uploadProgress === 0 && (
              <Alert type="success" message="Импорт завершён успешно!" showIcon />
            )}
          </Space>
        )}
      </Space>
    </Modal>
  );
};
