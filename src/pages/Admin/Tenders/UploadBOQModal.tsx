import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Space,
  message
} from 'antd';
import {
  UploadOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { createUnit } from '../../../lib/api/nomenclatures';
import { getErrorMessage } from '../../../utils/errors';
import { useBoqUpload } from './hooks/useBoqUpload';
import { UploadStep } from './components/UploadStep';
import { MappingStep } from './components/MappingStep';
import { PreviewStep } from './components/PreviewStep';

interface UploadBOQModalProps {
  visible: boolean;
  tenderId: string;
  tenderName: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const UploadBOQModal: React.FC<UploadBOQModalProps> = ({
  visible,
  tenderId,
  tenderName,
  onCancel,
  onSuccess,
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const {
    parsedData,
    validationResult,
    uploadProgress,
    existingUnits,
    unitMappings,
    uploading,
    fetchExistingUnits,
    parseExcelFile,
    handleMappingChange,
    isReadyForUpload,
    uploadData,
    reset,
  } = useBoqUpload();

  // Загрузка существующих единиц измерения при открытии модального окна
  useEffect(() => {
    if (visible) {
      fetchExistingUnits();
    }
  }, [visible, fetchExistingUnits]);

  // Обработка загрузки файла
  const handleFileUpload = (file: File) => {
    parseExcelFile(file);
    return false;
  };

  // Обработка удаления файла
  const handleRemoveFile = () => {
    setFileList([]);
    reset();
  };

  // Обработка загрузки данных в БД
  const handleUpload = async () => {
    const success = await uploadData(tenderId);
    if (success) {
      onSuccess();
      handleClose();
    }
  };

  // Закрытие модального окна
  const handleClose = () => {
    setFileList([]);
    reset();
    onCancel();
  };

  const handleCreateUnit = async (originalCode: string, values: { name: string; description?: string }) => {
    try {
      await createUnit({
        code: originalCode,
        name: values.name || originalCode,
        description: values.description || null,
        is_active: true,
        sort_order: 999,
      });
      message.success(`Единица "${originalCode}" успешно создана`);
      await fetchExistingUnits();
      handleMappingChange(originalCode, originalCode, 'map');
    } catch (error) {
      console.error('Ошибка при создании единицы:', error);
      message.error(`Ошибка при создании единицы: ${getErrorMessage(error)}`);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <FileExcelOutlined style={{ color: '#10b981' }} />
          <span>Загрузка ВОРа заказчика</span>
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={uploading}>
          Отмена
        </Button>,
        <Button
          key="upload"
          type="primary"
          onClick={handleUpload}
          loading={uploading}
          disabled={!isReadyForUpload()}
          icon={<UploadOutlined />}
        >
          {uploading ? 'Загрузка...' : 'Загрузить в БД'}
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Шаг 1: Загрузка файла */}
        <UploadStep
          fileList={fileList}
          onFileUpload={handleFileUpload}
          onRemove={handleRemoveFile}
          uploading={uploading}
          tenderName={tenderName}
        />

        {/* Шаг 2: Маппинг неизвестных единиц измерения */}
        {validationResult && validationResult.unknownUnits.length > 0 && (
          <MappingStep
            unitMappings={unitMappings}
            existingUnits={existingUnits}
            unknownUnitsCount={validationResult.unknownUnits.length}
            onMappingChange={handleMappingChange}
            onCreateUnit={handleCreateUnit}
          />
        )}

        {/* Шаг 3: Предпросмотр и прогресс */}
        <PreviewStep
          validationResult={validationResult}
          parsedDataCount={parsedData.length}
          uploadProgress={uploadProgress}
          uploading={uploading}
        />
      </Space>
    </Modal>
  );
};

export default UploadBOQModal;
