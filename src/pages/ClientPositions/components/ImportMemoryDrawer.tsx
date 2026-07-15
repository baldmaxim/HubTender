import { useCallback, useEffect, useState } from 'react';
import {
  Button, Drawer, Input, Modal, Space, Switch, Table, Tabs, Tag, Typography, message,
} from 'antd';
import {
  MappingProfileRow, NomenclatureAliasRow, deactivateMappingProfile,
  deactivateNomenclatureAlias, listMappingProfiles, listNomenclatureAliases,
  patchMappingProfile,
} from '../../../lib/api/importMemory';
import { deactivateConfirmText, profileStatusDisplay } from '../../../lib/quality/smartImportMemoryPolicy';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Память изменилась (деактивация/переименование) — текущий анализ должен
   *  перепроверить профили/aliases на сервере (§12). */
  onChanged: () => void;
}

/** Этап 2.3 (§12): «Сохранённые настройки импорта» — компактное управление
 *  персональной памятью. Никаких финансовых полей; действия не запускают
 *  импорт и не меняют BOQ. */
export default function ImportMemoryDrawer({ open, onClose, onChanged }: Props) {
  const [profiles, setProfiles] = useState<MappingProfileRow[]>([]);
  const [aliases, setAliases] = useState<NomenclatureAliasRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([
        listMappingProfiles({ search: q, page_size: 100 }),
        listNomenclatureAliases({ search: q, page_size: 100 }),
      ]);
      setProfiles(p.items);
      setAliases(a.items);
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) { setDirty(false); void reload(''); setSearch(''); }
  }, [open, reload]);

  const markDirty = () => setDirty(true);

  const doDeactivateProfile = (row: MappingProfileRow) => {
    Modal.confirm({
      title: 'Отключить профиль?',
      content: deactivateConfirmText('profile', row.name),
      okText: 'Отключить', cancelText: 'Отмена',
      onOk: async () => {
        try {
          await deactivateMappingProfile(row.id);
          markDirty();
          await reload(search);
        } catch (e) { message.error(getErrorMessage(e)); }
      },
    });
  };

  const doDeactivateAlias = (row: NomenclatureAliasRow) => {
    Modal.confirm({
      title: 'Забыть соответствие?',
      content: deactivateConfirmText('alias', row.normalized_source_text),
      okText: 'Забыть', cancelText: 'Отмена',
      onOk: async () => {
        try {
          await deactivateNomenclatureAlias(row.id);
          markDirty();
          await reload(search);
        } catch (e) { message.error(getErrorMessage(e)); }
      },
    });
  };

  const toggleProfileActive = async (row: MappingProfileRow, active: boolean) => {
    if (!active) { doDeactivateProfile(row); return; }
    try {
      await patchMappingProfile(row.id, { is_active: true });
      markDirty();
      await reload(search);
    } catch (e) { message.error(getErrorMessage(e)); }
  };

  const saveRename = async () => {
    if (!renaming) return;
    try {
      await patchMappingProfile(renaming.id, { name: renaming.name });
      setRenaming(null);
      markDirty();
      await reload(search);
    } catch (e) { message.error(getErrorMessage(e)); }
  };

  const profileColumns = [
    {
      title: 'Профиль', key: 'name',
      render: (_: unknown, p: MappingProfileRow) => (
        renaming?.id === p.id ? (
          <Space.Compact style={{ width: '100%' }}>
            <Input size="small" value={renaming.name} maxLength={120}
              onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
            <Button size="small" type="primary" onClick={saveRename}>OK</Button>
          </Space.Compact>
        ) : (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>{p.name}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              поля: {(p.mapped_fields ?? []).join(', ') || '—'}
            </Text>
          </Space>
        )
      ),
    },
    {
      title: 'Статус', key: 'st', width: 150,
      render: (_: unknown, p: MappingProfileRow) => {
        const d = profileStatusDisplay(p.status);
        return <Tag color={d.color}>{d.label}</Tag>;
      },
    },
    { title: 'Исп.', dataIndex: 'use_count', width: 60 },
    { title: 'Последнее', dataIndex: 'last_used_at', width: 100 },
    {
      title: '', key: 'act', width: 180,
      render: (_: unknown, p: MappingProfileRow) => (
        <Space size={4}>
          <Button size="small" onClick={() => setRenaming({ id: p.id, name: p.name })}>Переименовать</Button>
          <Switch size="small" checked={p.status !== 'inactive'}
            onChange={(v) => toggleProfileActive(p, v)} />
        </Space>
      ),
    },
  ];

  const aliasColumns = [
    {
      title: 'Текст строки → номенклатура', key: 'src',
      render: (_: unknown, a: NomenclatureAliasRow) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{a.normalized_source_text}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            → {a.catalog_label || a.catalog_id} ({a.catalog_kind === 'work' ? 'работа' : 'материал'}
            {a.catalog_unit ? `, ${a.catalog_unit}` : ''})
          </Text>
        </Space>
      ),
    },
    { title: 'Тип', dataIndex: 'canonical_boq_item_type', width: 80 },
    { title: 'Ед.', dataIndex: 'normalized_unit_code', width: 70 },
    { title: 'Исп.', dataIndex: 'use_count', width: 60 },
    { title: 'Последнее', dataIndex: 'last_used_at', width: 100 },
    {
      title: '', key: 'act', width: 110,
      render: (_: unknown, a: NomenclatureAliasRow) => (
        a.is_active
          ? <Button size="small" danger onClick={() => doDeactivateAlias(a)}>Забыть</Button>
          : <Tag>отключено</Tag>
      ),
    },
  ];

  return (
    <Drawer
      title="Сохранённые настройки импорта"
      open={open} width={860}
      onClose={() => { onClose(); if (dirty) onChanged(); }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input.Search
          placeholder="Поиск по имени/тексту" allowClear value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => void reload(v)}
        />
        <Tabs
          items={[
            {
              key: 'profiles', label: `Профили колонок (${profiles.length})`,
              children: (
                <Table<MappingProfileRow>
                  rowKey="id" size="small" loading={loading}
                  columns={profileColumns} dataSource={profiles}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              ),
            },
            {
              key: 'aliases', label: `Соответствия номенклатуры (${aliases.length})`,
              children: (
                <Table<NomenclatureAliasRow>
                  rowKey="id" size="small" loading={loading}
                  columns={aliasColumns} dataSource={aliases}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                />
              ),
            },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 11 }}>
          Память хранит только подтверждённые вами решения: сопоставление колонок и выбор номенклатуры.
          Цены, количества и данные тендеров сюда не попадают. Действия здесь не изменяют импортированные данные.
        </Text>
      </Space>
    </Drawer>
  );
}
