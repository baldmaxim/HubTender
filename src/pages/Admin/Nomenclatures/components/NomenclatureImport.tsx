import React, { useEffect } from 'react';
import { Modal, Upload, Button, Alert, Card, Typography, Tag, List, Select, Radio, Space, Progress } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNomenclatureUpload } from '../hooks/useNomenclatureUpload';

const { Text } = Typography;

interface NomenclatureImportProps {
  open: boolean;
  mode: 'materials' | 'works';
  onClose: (success: boolean) => void;
}

export const NomenclatureImport: React.FC<NomenclatureImportProps> = ({ open, mode, onClose }) => {
  const {
    parsedData,
    validationResult,
    uploadProgress,
    existingUnits,
    unitMappings,
    uploading,
    fetchExistingUnits,
    fetchExistingRecords,
    parseExcelFile,
    handleMappingChange,
    isReadyForUpload,
    uploadData,
    reset,
  } = useNomenclatureUpload();

  useEffect(() => {
    if (open) {
      fetchExistingUnits();
      fetchExistingRecords(mode);
    }
    // fetchExistingRecords and fetchExistingUnits are stable functions; intentionally excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const handleClose = () => {
    reset();
    onClose(false);
  };

  const handleUpload = async () => {
    const success = await uploadData(mode);
    if (success) {
      reset();
      onClose(true);
    }
  };

  const title = mode === 'materials' ? 'Импорт материалов из Excel' : 'Импорт работ из Excel';

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleClose}
      width={800}
      footer={
        <Space>
          <Button onClick={handleClose} disabled={uploading}>
            Отмена
          </Button>
          <Button
            type="primary"
            onClick={handleUpload}
            loading={uploading}
            disabled={!isReadyForUpload()}
          >
            {uploading
              ? `Загрузка... ${uploadProgress}%`
              : `Загрузить ${parsedData.length} записей`
            }
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Шаг 1: Загрузка файла */}
        <Card title="Шаг 1: Загрузка файла" size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary">
              Структура файла: Колонка 1 - Наименование, Колонка 2 - Единица измерения
            </Text>
            <Upload
              accept=".xlsx, .xls"
              beforeUpload={(file) => {
                parseExcelFile(file);
                return false;
              }}
              maxCount={1}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>
                Выбрать Excel файл
              </Button>
            </Upload>

            {validationResult && (
              <>
                {validationResult.errors.length > 0 && (
                  <Alert
                    type="error"
                    message="Ошибки валидации"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {validationResult.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                {validationResult.warnings.length > 0 && (
                  <Alert
                    type="warning"
                    message="Предупреждения"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {validationResult.warnings.map((warn, idx) => (
                          <li key={idx}>{warn}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                {validationResult.isValid && validationResult.unknownUnits.length === 0 && validationResult.duplicates.length === 0 && (
                  <Alert
                    type="success"
                    message={`Файл готов к загрузке: ${parsedData.length} записей`}
                  />
                )}
              </>
            )}
          </Space>
        </Card>

        {/* Шаг 2: Маппинг единиц (если есть unknownUnits) */}
        {validationResult && validationResult.unknownUnits.length > 0 && (
          <Card title="Шаг 2: Настройка единиц измерения" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {unitMappings.map(mapping => (
                <div key={mapping.originalCode} style={{ border: '1px solid #f0f0f0', padding: 12, borderRadius: 4 }}>
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <div>
                      <Text strong>Неизвестная единица: </Text>
                      <Tag color="orange">{mapping.originalCode}</Tag>
                    </div>

                    <Radio.Group
                      value={mapping.action}
                      onChange={(e) => {
                        const action = e.target.value;
                        if (action === 'create') {
                          handleMappingChange(mapping.originalCode, mapping.originalCode, 'create');
                        } else {
                          handleMappingChange(mapping.originalCode, null, 'map');
                        }
                      }}
                    >
                      <Space direction="vertical">
                        <Radio value="map">Сопоставить с существующей</Radio>
                        <Radio value="create">Создать новую единицу</Radio>
                      </Space>
                    </Radio.Group>

                    {mapping.action === 'map' && (
                      <Select
                        style={{ width: '100%' }}
                        placeholder="Выберите единицу из БД"
                        value={mapping.mappedCode}
                        options={existingUnits.map(u => ({
                          label: `${u.code} - ${u.name}`,
                          value: u.code
                        }))}
                        onChange={(value) => handleMappingChange(mapping.originalCode, value, 'map')}
                      />
                    )}

                    {mapping.action === 'create' && (
                      <Alert
                        type="info"
                        message={`Будет создана новая единица измерения с кодом "${mapping.originalCode}"`}
                        showIcon
                      />
                    )}
                  </Space>
                </div>
              ))}
            </Space>
          </Card>
        )}

        {/* Шаг 3: Превью дубликатов (если есть) */}
        {validationResult && validationResult.duplicates.length > 0 && (
          <Card title="Шаг 3: Найденные дубликаты" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">
                Будет загружена только первая запись из каждой группы
              </Text>
              {validationResult.duplicates.map((group, idx) => (
                <div key={idx} style={{ border: '1px solid #f0f0f0', padding: 12, borderRadius: 4 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    Группа дубликатов: {group.normalizedName}
                  </Text>
                  <List
                    size="small"
                    dataSource={group.occurrences}
                    renderItem={(occ, occIdx) => (
                      <List.Item>
                        <Space>
                          <Tag color={occIdx === 0 ? 'green' : 'default'}>
                            {occIdx === 0 ? '✓ Загрузится' : 'Пропустится'}
                          </Tag>
                          <Text>
                            Строка {occ.rowIndex + 2}: {occ.originalName} [{occ.unit_code}]
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </div>
              ))}
            </Space>
          </Card>
        )}

        {/* Прогресс бар при загрузке */}
        {uploading && (
          <Progress percent={uploadProgress} status="active" />
        )}
      </Space>
    </Modal>
  );
};
