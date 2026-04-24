import { Button, Space, Dropdown, Tag, Typography, Tooltip } from 'antd';
import { DownloadOutlined, MoreOutlined, LinkOutlined, FolderOutlined, FileTextOutlined, FileSearchOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import type { TenderRecord } from '../hooks/useTendersData';

const { Text } = Typography;

interface GetColumnsParams {
  onOpenUploadBOQ: (record: TenderRecord) => void;
  getActionMenu: (record: TenderRecord) => MenuProps['items'];
}

export const getTendersTableColumns = (params: GetColumnsParams): ColumnsType<TenderRecord> => {
  const { onOpenUploadBOQ, getActionMenu } = params;

  return [
    {
      title: 'Тендер',
      dataIndex: 'tender',
      key: 'tender',
      width: 180,
      ellipsis: true,
      render: (text: string, record: TenderRecord) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.tenderNumber}
          </Text>
        </div>
      ),
    },
    {
      title: 'Класс жилья',
      dataIndex: 'housingClass',
      key: 'housingClass',
      width: 100,
      align: 'center',
      render: (housingClass?: string) => {
        if (!housingClass) return <Text type="secondary">—</Text>;

        const colorMap: Record<string, string> = {
          'комфорт': 'blue',
          'бизнес': 'green',
          'премиум': 'purple',
          'делюкс': 'gold',
        };

        return (
          <Tag color={colorMap[housingClass] || 'default'} style={{ margin: 0 }}>
            {housingClass}
          </Tag>
        );
      },
    },
    {
      title: 'Объем стр-ва',
      dataIndex: 'constructionScope',
      key: 'constructionScope',
      width: 110,
      align: 'center',
      render: (constructionScope?: string) => {
        if (!constructionScope) return <Text type="secondary">—</Text>;

        const colorMap: Record<string, string> = {
          'генподряд': 'orange',
          'коробка': 'lime',
          'монолит': 'blue',
          'монолит подземной части': 'red',
          'монолит+нулевой цикл': 'purple',
        };

        return (
          <Tag color={colorMap[constructionScope.toLowerCase()] || 'default'} style={{ margin: 0 }}>
            {constructionScope}
          </Tag>
        );
      },
    },
    {
      title: 'Время до дедлайна',
      dataIndex: 'deadline',
      key: 'deadline',
      width: 110,
      align: 'center',
      render: (deadline: string, record: TenderRecord) => (
        <div>
          <Text>{record.status === 'completed' ? 'Завершён' : 'В работе'}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {deadline}
          </Text>
        </div>
      ),
    },
    {
      title: 'Дедлайн',
      dataIndex: 'daysUntilDeadline',
      key: 'daysUntilDeadline',
      width: 70,
      align: 'center',
      render: (days: number) => (
        <Tag
          color={days > 30 ? 'green' : days > 7 ? 'orange' : 'red'}
          style={{ margin: 0 }}
        >
          {days} дн.
        </Tag>
      ),
    },
    {
      title: 'Итоговая стоимость КП',
      dataIndex: 'estimatedCost',
      key: 'estimatedCost',
      width: 110,
      align: 'center',
      render: (cost: number) => (
        <Text strong style={{ fontSize: 12 }}>
          {Math.round(cost).toLocaleString('ru-RU')}
        </Text>
      ),
    },
    {
      title: 'Площадь по СП',
      dataIndex: 'areaSp',
      key: 'areaSp',
      width: 90,
      align: 'center',
      render: (area: number) => (
        <Text style={{ fontSize: 12 }}>{area.toLocaleString('ru-RU')} м²</Text>
      ),
    },
    {
      title: 'Площадь от Заказчика',
      dataIndex: 'areaClient',
      key: 'areaClient',
      width: 110,
      align: 'center',
      render: (area: number) => (
        <Text style={{ fontSize: 12 }}>{area > 0 ? `${area.toLocaleString('ru-RU')} м²` : '—'}</Text>
      ),
    },
    {
      title: 'Курс USD',
      dataIndex: 'usdRate',
      key: 'usdRate',
      width: 70,
      align: 'center',
      render: (rate: number) => (
        <Text style={{ fontSize: 12 }}>$ {rate.toFixed(1)}</Text>
      ),
    },
    {
      title: 'Курс EUR',
      dataIndex: 'eurRate',
      key: 'eurRate',
      width: 70,
      align: 'center',
      render: (rate: number) => (
        <Text style={{ fontSize: 12 }}>€ {rate.toFixed(1)}</Text>
      ),
    },
    {
      title: 'Курс CNY',
      dataIndex: 'cnyRate',
      key: 'cnyRate',
      width: 70,
      align: 'center',
      render: (rate: number) => (
        <Text style={{ fontSize: 12 }}>¥ {rate.toFixed(2)}</Text>
      ),
    },
    {
      title: 'Ссылки',
      dataIndex: 'hasLinks',
      key: 'hasLinks',
      width: 60,
      align: 'center',
      render: (_hasLinks: boolean, record: TenderRecord) => {
        const linkItems: MenuProps['items'] = [];

        if (record.uploadFolder) {
          linkItems.push({
            key: 'upload_folder',
            label: 'Папка для загрузки КП',
            icon: <FolderOutlined />,
            onClick: () => window.open(record.uploadFolder, '_blank')
          });
        }

        if (record.bsmLink) {
          linkItems.push({
            key: 'bsm_link',
            label: 'БСМ',
            icon: <FileTextOutlined />,
            onClick: () => window.open(record.bsmLink, '_blank')
          });
        }

        if (record.tzLink) {
          linkItems.push({
            key: 'tz_link',
            label: 'Уточнения по ТЗ',
            icon: <FileSearchOutlined />,
            onClick: () => window.open(record.tzLink, '_blank')
          });
        }

        if (record.qaFormLink) {
          linkItems.push({
            key: 'qa_form_link',
            label: 'Форма Вопрос-Ответ',
            icon: <QuestionCircleOutlined />,
            onClick: () => window.open(record.qaFormLink, '_blank')
          });
        }

        if (record.projectFolderLink) {
          linkItems.push({
            key: 'project_folder_link',
            label: 'Папка с проектом',
            icon: <FolderOutlined />,
            onClick: () => window.open(record.projectFolderLink, '_blank')
          });
        }

        if (linkItems.length === 0) {
          return (
            <Tooltip title="Нет доступных ссылок">
              <Button
                type="text"
                size="small"
                icon={<LinkOutlined />}
                disabled={true}
                style={{ padding: '2px 4px', cursor: 'not-allowed' }}
              />
            </Tooltip>
          );
        }

        return (
          <Dropdown
            menu={{ items: linkItems }}
            placement="bottomLeft"
            trigger={['hover']}
          >
            <Button
              type="text"
              size="small"
              icon={<LinkOutlined />}
              style={{
                padding: '2px 4px',
                color: '#10b981',
                cursor: 'pointer'
              }}
            />
          </Dropdown>
        );
      },
    },
    {
      title: 'Создан',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 80,
      align: 'center',
      render: (date: string) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{date}</Text>
      ),
    },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      width: 150,
      align: 'center',
      ellipsis: true,
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{text || '—'}</Text>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: TenderRecord) => (
        <Space size={2}>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => onOpenUploadBOQ(record)}
            style={{ fontSize: 11 }}
          >
            Загрузить
          </Button>
          <Dropdown
            menu={{ items: getActionMenu(record) }}
            placement="bottomRight"
          >
            <Button type="text" icon={<MoreOutlined />} size="small" />
          </Dropdown>
        </Space>
      ),
    },
  ];
};
