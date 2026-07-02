import React, { useMemo, useState } from 'react';
import { Modal, Upload, message, Table, Alert, Tag, Space, Typography } from 'antd';
import type { UploadFile } from 'antd/es/upload';
import { InboxOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import type {
  ChronologyItem,
  ConstructionScope,
  TenderPackageItem,
  TenderRegistryWithRelations,
  TenderStatus,
} from '../../lib/types';
import {
  createTenderRegistry,
  getNextTenderRegistrySortOrder,
  patchTenderRegistryFields,
} from '../../lib/api/tenderRegistry';
import dayjs from 'dayjs';
import {
  mergeChronologyItems,
  mergeTenderPackageItems,
  parseChronologyText,
  parseExcelDate,
  parseTenderPackageText,
  type ImportRowAction,
  type ParsedTender,
} from './utils/importTenders';

const { Text } = Typography;

interface ImportTendersModalProps {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  constructionScopes: ConstructionScope[];
  statuses: TenderStatus[];
  existingTenders: TenderRegistryWithRelations[];
}

interface ClassifiedRow {
  parsed: ParsedTender;
  action: ImportRowAction;
  match: TenderRegistryWithRelations | null;
  chronologyItems: ChronologyItem[];
  packageItems: TenderPackageItem[];
}

const ImportTendersModal: React.FC<ImportTendersModalProps> = ({
  open,
  onCancel,
  onSuccess,
  constructionScopes,
  statuses,
  existingTenders,
}) => {
  const [parsedData, setParsedData] = useState<ParsedTender[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const tenderByNumber = useMemo(() => {
    const map = new Map<string, TenderRegistryWithRelations>();
    existingTenders.forEach((tender) => {
      const number = tender.tender_number?.trim();
      if (number) {
        map.set(number, tender);
      }
    });
    return map;
  }, [existingTenders]);

  const rows = useMemo<ClassifiedRow[]>(() => {
    return parsedData.map((parsed) => {
      const number = parsed.tender_number?.trim();
      const match = number ? tenderByNumber.get(number) ?? null : null;
      const action: ImportRowAction = !number ? 'skip' : match ? 'update' : 'create';

      const chronologyItems = parseChronologyText(parsed.chronology);
      const packageItems = parseTenderPackageText(parsed.has_tender_package);

      return { parsed, action, match, chronologyItems, packageItems };
    });
  }, [parsedData, tenderByNumber]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.action] += 1;
        return acc;
      },
      { create: 0, update: 0, skip: 0 } as Record<ImportRowAction, number>,
    );
  }, [rows]);

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        const parsed: ParsedTender[] = (jsonData as Record<string, unknown>[]).map((row) => {
          const str = (v: unknown): string | undefined => (v ? String(v) : undefined);
          return {
            tender_number: str(row['Номер тендера'] ?? row['Номер']),
            title: str(row['Наименование ЖК'] ?? row['Наименование']) ?? '',
            client_name: str(row['Заказчик']) ?? '',
            object_address: str(row['Адрес объекта'] ?? row['Адрес']),
            construction_scope: str(row['Работа'] ?? row['Объем строительства']),
            area: row['Площадь по СП, м2']
              ? parseFloat(String(row['Площадь по СП, м2']))
              : row['Площадь']
                ? parseFloat(String(row['Площадь']))
                : undefined,
            submission_date: parseExcelDate(row['Дата подачи КП']) || undefined,
            chronology: str(row['Хронологии тендеров (дата выхода на площадку)'] ?? row['Хронология']),
            construction_start_date: parseExcelDate(row['Дата выхода на строительную площадку']) || undefined,
            site_visit_date: parseExcelDate(row['Дата посещения площадки']) || undefined,
            site_visit_photo_url: str(row['Фото посещения площадки']),
            has_tender_package: str(row['Наличие тендерного пакета']),
            invitation_date:
              parseExcelDate(row['Когда поступило приглашение']) ||
              parseExcelDate(row['Дата приглашения']) ||
              undefined,
            status: str(row['Статус']),
          };
        });

        setParsedData(parsed);
        message.success(`Загружено ${parsed.length} записей из файла`);
      } catch (error) {
        message.error('Ошибка чтения файла: ' + (error as Error).message);
      }
    };

    reader.readAsArrayBuffer(file);
    return false;
  };

  const handleImport = async () => {
    const importable = rows.filter((row) => row.action !== 'skip');

    if (importable.length === 0) {
      message.warning('Нет строк с номером тендера для импорта');
      return;
    }

    setLoading(true);

    try {
      const scopeMap = new Map(constructionScopes.map((scope) => [scope.name.toLowerCase(), scope.id]));
      const statusMap = new Map(statuses.map((status) => [status.name.toLowerCase(), status.id]));

      const resolveScopeId = (name?: string) =>
        name ? scopeMap.get(name.toLowerCase()) ?? null : null;
      const resolveStatusId = (name?: string) =>
        name ? statusMap.get(name.toLowerCase()) ?? null : null;

      const createRows = importable.filter((row) => row.action === 'create');
      const updateRows = importable.filter((row) => row.action === 'update');

      let nextSortOrder = await getNextTenderRegistrySortOrder();

      const createPayloads = createRows.map((row) => {
        const { parsed } = row;
        return {
          tender_number: parsed.tender_number || null,
          title: parsed.title,
          client_name: parsed.client_name,
          object_address: parsed.object_address || null,
          construction_scope_id: resolveScopeId(parsed.construction_scope),
          area: parsed.area || null,
          submission_date: parsed.submission_date || null,
          chronology_items: row.chronologyItems,
          construction_start_date: parsed.construction_start_date || null,
          site_visit_date: parsed.site_visit_date || null,
          site_visit_photo_url: parsed.site_visit_photo_url || null,
          tender_package_items: row.packageItems,
          invitation_date: parsed.invitation_date || null,
          status_id: resolveStatusId(parsed.status),
          sort_order: nextSortOrder++,
          is_archived: false,
        };
      });

      // Слияние: дополняем хронологию/пакет, скаляры — только если у тендера пусто.
      const buildUpdatePatch = (row: ClassifiedRow): Record<string, unknown> => {
        const { parsed, match } = row;
        const patch: Record<string, unknown> = {
          chronology_items: mergeChronologyItems(match?.chronology_items, row.chronologyItems),
          tender_package_items: mergeTenderPackageItems(match?.tender_package_items, row.packageItems),
        };

        const fillEmpty = (field: string, existing: unknown, value: unknown) => {
          if ((existing == null || existing === '') && value != null && value !== '') {
            patch[field] = value;
          }
        };

        fillEmpty('object_address', match?.object_address, parsed.object_address);
        fillEmpty('area', match?.area, parsed.area);
        fillEmpty('submission_date', match?.submission_date, parsed.submission_date);
        fillEmpty('construction_start_date', match?.construction_start_date, parsed.construction_start_date);
        fillEmpty('site_visit_date', match?.site_visit_date, parsed.site_visit_date);
        fillEmpty('site_visit_photo_url', match?.site_visit_photo_url, parsed.site_visit_photo_url);
        fillEmpty('invitation_date', match?.invitation_date, parsed.invitation_date);
        fillEmpty('construction_scope_id', match?.construction_scope_id, resolveScopeId(parsed.construction_scope));
        fillEmpty('status_id', match?.status_id, resolveStatusId(parsed.status));

        return patch;
      };

      await Promise.all([
        ...createPayloads.map((payload) =>
          createTenderRegistry(payload as unknown as Parameters<typeof createTenderRegistry>[0]),
        ),
        ...updateRows.map((row) => patchTenderRegistryFields(row.match!.id, buildUpdatePatch(row))),
      ]);

      const parts = [`создано ${createRows.length}`, `обновлено ${updateRows.length}`];
      if (summary.skip > 0) {
        parts.push(`пропущено ${summary.skip}`);
      }
      message.success(`Импорт завершён: ${parts.join(', ')}`);
      setParsedData([]);
      setFileList([]);
      onSuccess();
    } catch (error) {
      message.error('Ошибка импорта: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setParsedData([]);
    setFileList([]);
    onCancel();
  };

  const renderDate = (val?: string | null) => (val ? dayjs(val).format('DD.MM.YYYY') : '-');

  const previewColumns = [
    {
      title: 'Действие',
      key: 'action',
      width: 120,
      fixed: 'left' as const,
      render: (_: unknown, record: ClassifiedRow) => {
        if (record.action === 'update') return <Tag color="green">Обновление</Tag>;
        if (record.action === 'create') return <Tag color="blue">Новый</Tag>;
        return <Tag color="orange">Пропуск</Tag>;
      },
    },
    {
      title: 'Номер тендера',
      key: 'tender_number',
      width: 120,
      fixed: 'left' as const,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.tender_number || '-',
    },
    {
      title: 'Наименование',
      key: 'title',
      width: 180,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.title || '-',
    },
    {
      title: 'Заказчик',
      key: 'client_name',
      width: 160,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.client_name || '-',
    },
    {
      title: 'Адрес объекта',
      key: 'object_address',
      width: 160,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.object_address || '-',
    },
    {
      title: 'Объем строит-ва',
      key: 'construction_scope',
      width: 140,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.construction_scope || '-',
    },
    {
      title: 'Площадь',
      key: 'area',
      width: 90,
      render: (_: unknown, record: ClassifiedRow) =>
        record.parsed.area != null ? record.parsed.area.toFixed(2) : '-',
    },
    {
      title: 'Дата подачи КП',
      key: 'submission_date',
      width: 110,
      render: (_: unknown, record: ClassifiedRow) => renderDate(record.parsed.submission_date),
    },
    {
      title: 'Хронология',
      key: 'chronology',
      width: 280,
      render: (_: unknown, record: ClassifiedRow) => {
        if (record.chronologyItems.length === 0) return '-';
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {record.chronologyItems.map((item, index) => (
              <Text key={index} style={{ fontSize: 12 }}>
                {item.date ? dayjs(item.date).format('DD.MM.YYYY') : 'Без даты'} — {item.text}
              </Text>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Выход на площадку',
      key: 'construction_start_date',
      width: 120,
      render: (_: unknown, record: ClassifiedRow) => renderDate(record.parsed.construction_start_date),
    },
    {
      title: 'Посещение площадки',
      key: 'site_visit_date',
      width: 120,
      render: (_: unknown, record: ClassifiedRow) => renderDate(record.parsed.site_visit_date),
    },
    {
      title: 'Фото площадки',
      key: 'site_visit_photo_url',
      width: 140,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.site_visit_photo_url || '-',
    },
    {
      title: 'Тендерный пакет',
      key: 'has_tender_package',
      width: 280,
      render: (_: unknown, record: ClassifiedRow) => {
        if (record.packageItems.length === 0) return '-';
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {record.packageItems.map((item, index) => (
              <Text key={index} style={{ fontSize: 12 }}>
                {item.date ? dayjs(item.date).format('DD.MM.YYYY') : 'Без даты'} — {item.text}
              </Text>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Приглашение',
      key: 'invitation_date',
      width: 110,
      render: (_: unknown, record: ClassifiedRow) => renderDate(record.parsed.invitation_date),
    },
    {
      title: 'Статус',
      key: 'status',
      width: 130,
      render: (_: unknown, record: ClassifiedRow) => record.parsed.status || '-',
    },
  ];

  return (
    <Modal
      title="Импорт тендеров из Excel"
      open={open}
      onCancel={handleCancel}
      onOk={handleImport}
      okText="Импортировать"
      cancelText="Отмена"
      width="95vw"
      style={{ top: 20, maxWidth: 1600 }}
      confirmLoading={loading}
      okButtonProps={{ disabled: summary.create + summary.update === 0 }}
    >
      <Alert
        message="Формат Excel файла"
        description="Файл должен содержать следующие колонки: Номер тендера, Наименование ЖК, Заказчик, Адрес объекта, Работа, Площадь по СП м2, Дата подачи КП, Хронологии тендеров (дата выхода на площадку), Дата выхода на строительную площадку, Дата посещения площадки, Фото посещения площадки, Наличие тендерного пакета, Когда поступило приглашение, Статус"
        type="info"
        style={{ marginBottom: 16 }}
      />

      <Upload.Dragger
        fileList={fileList}
        beforeUpload={handleFileUpload}
        onRemove={() => {
          setFileList([]);
          setParsedData([]);
        }}
        accept=".xlsx,.xls"
        maxCount={1}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Нажмите или перетащите файл Excel для загрузки</p>
        <p className="ant-upload-hint">Поддерживаются файлы форматов .xlsx и .xls</p>
      </Upload.Dragger>

      {parsedData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={summary.skip > 0 ? 'warning' : 'info'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`Новых: ${summary.create}, обновлений: ${summary.update}, пропущено: ${summary.skip}`}
            description={
              summary.skip > 0
                ? 'Строки без номера тендера не будут загружены — заполните номер тендера в файле.'
                : 'Сопоставление выполнено по номеру тендера.'
            }
          />
          <h4>Предварительный просмотр ({parsedData.length} записей)</h4>
          <Table
            dataSource={rows}
            columns={previewColumns}
            rowKey={(_, index) => index?.toString() || '0'}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 'max-content' }}
            size="small"
          />
        </div>
      )}
    </Modal>
  );
};

export default ImportTendersModal;
