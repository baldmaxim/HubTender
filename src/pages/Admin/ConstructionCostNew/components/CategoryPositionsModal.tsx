/**
 * Модальное окно drill-down по категории затрат.
 * Показывает позиции заказчика с суммами выбранной категории по 6 типам элементов.
 * Наименование позиции — ссылка на элементы позиции в отдельной вкладке.
 */
import React from 'react';
import { Modal, Table, Typography, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { usePositionTabActions } from '../../../../contexts/PositionTabsContext';
import {
  useCategoryPositions,
  type CategoryPositionRow,
} from '../hooks/useCategoryPositions';

const { Text, Link } = Typography;

interface CategoryPositionsModalProps {
  open: boolean;
  tenderId: string | null;
  category: { id: string; detailName: string; categoryName: string } | null;
  onClose: () => void;
}

const fmt = (v: number) =>
  (v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const CategoryPositionsModal: React.FC<CategoryPositionsModalProps> = ({
  open,
  tenderId,
  category,
  onClose,
}) => {
  const { rows, loading } = useCategoryPositions(tenderId, open ? category?.id ?? null : null);
  const navigate = useNavigate();
  const { openTab } = usePositionTabActions();

  // Открываем элементы позиции внутренней вкладкой приложения (keep-alive): «Затраты» остаются
  // смонтированной вкладкой. Закрываем модалку, чтобы она не висела на скрытой странице.
  const openPosition = (record: CategoryPositionRow) => {
    if (!tenderId) return;
    openTab({
      positionId: record.id,
      tenderId,
      title: record.position_number != null ? `№ ${record.position_number}` : 'Позиция',
    });
    navigate(`/positions/${record.id}/items?tenderId=${tenderId}&positionId=${record.id}`);
    onClose();
  };

  const numCol = (
    title: string,
    key: 'subWorks' | 'subMaterials' | 'works' | 'materials' | 'materialsComp' | 'worksComp',
  ) => ({
    title: <div style={{ textAlign: 'center' }}>{title}</div>,
    dataIndex: key,
    key,
    width: 100,
    align: 'center' as const,
    render: (value: number) => fmt(value),
  });

  const columns: ColumnsType<CategoryPositionRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>№ п/п</div>,
      dataIndex: 'position_number',
      key: 'position_number',
      width: 70,
      align: 'center',
      fixed: 'left',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Раздел</div>,
      dataIndex: 'item_no',
      key: 'item_no',
      width: 104,
      align: 'center',
      render: (value: string | null) => value || '—',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Наименование</div>,
      dataIndex: 'work_name',
      key: 'work_name',
      width: 320,
      render: (value: string, record: CategoryPositionRow) => (
        <Link onClick={() => openPosition(record)} style={{ textDecoration: 'underline' }}>
          {value}
        </Link>
      ),
    },
    numCol('Суб-раб', 'subWorks'),
    numCol('Суб-мат', 'subMaterials'),
    numCol('Раб', 'works'),
    numCol('Мат', 'materials'),
    numCol('Мат-комп', 'materialsComp'),
    numCol('Раб-комп', 'worksComp'),
    {
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'center',
      fixed: 'right',
      render: (value: number) => (
        <Text strong style={{ color: '#10b981' }}>
          {fmt(value)}
        </Text>
      ),
    },
  ];

  const totals = rows.reduce(
    (acc, r) => ({
      subWorks: acc.subWorks + r.subWorks,
      subMaterials: acc.subMaterials + r.subMaterials,
      works: acc.works + r.works,
      materials: acc.materials + r.materials,
      materialsComp: acc.materialsComp + r.materialsComp,
      worksComp: acc.worksComp + r.worksComp,
      total: acc.total + r.total,
    }),
    { subWorks: 0, subMaterials: 0, works: 0, materials: 0, materialsComp: 0, worksComp: 0, total: 0 },
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1280}
      zIndex={1200}
      style={{ maxWidth: '95vw' }}
      title={category ? `${category.categoryName} — ${category.detailName}` : 'Категория затрат'}
      destroyOnClose
    >
      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          bordered
          scroll={{ x: 1214, y: 'calc(100vh - 320px)' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  <Text strong>Итого:</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center">
                  <Text strong>{fmt(totals.subWorks)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="center">
                  <Text strong>{fmt(totals.subMaterials)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="center">
                  <Text strong>{fmt(totals.works)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="center">
                  <Text strong>{fmt(totals.materials)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="center">
                  <Text strong>{fmt(totals.materialsComp)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="center">
                  <Text strong>{fmt(totals.worksComp)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} align="center">
                  <Text strong style={{ color: '#10b981' }}>
                    {fmt(totals.total)}
                  </Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Spin>
    </Modal>
  );
};

export default CategoryPositionsModal;
