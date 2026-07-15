import { useState } from 'react';
import { Button, Modal, Select, Space, Tag, Typography, message } from 'antd';
import type { SmartPreviewRow } from '../../../lib/api/boqSmartImport';
import { deactivateNomenclatureAlias } from '../../../lib/api/importMemory';
import { listMaterialNames, listWorkNames } from '../../../lib/api/nomenclatures';
import { ALIAS_BADGE_TEXT, aliasBadge, deactivateConfirmText } from '../../../lib/quality/smartImportMemoryPolicy';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface Props {
  row: SmartPreviewRow;
  rowReference: string;
  /** «Изменить»: пользователь выбирает другую номенклатуру вручную —
   *  selection сильнее alias на сервере; старый alias не меняется молча. */
  onManualPick: (ref: string, catalogId: string, label: string) => void;
  /** «Забыть»: alias деактивирован — повторный анализ обязателен (§12). */
  onForgotten: () => void;
}

/** Этап 2.3 (§11): управление alias-решением строки прямо в preview. */
export default function AliasRowActions({ row, rowReference, onManualPick, onForgotten }: Props) {
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(false);

  const badge = aliasBadge(row);
  if (!badge) return null;

  const isWork = (row.boq_item_type ?? '').startsWith('раб') || (row.boq_item_type ?? '').startsWith('суб-раб');

  const openPicker = async () => {
    setPicking(true);
    if (options || loading) return;
    setLoading(true);
    try {
      const rows = isWork ? await listWorkNames() : await listMaterialNames();
      setOptions(rows.map((r) => ({ value: r.id, label: `${r.name}${r.unit ? ` (${r.unit})` : ''}` })));
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const forget = () => {
    Modal.confirm({
      title: 'Забыть соответствие?',
      content: deactivateConfirmText('alias', row.description ?? row.nomenclature ?? ''),
      okText: 'Забыть', cancelText: 'Отмена',
      onOk: async () => {
        try {
          await deactivateNomenclatureAlias(badge.aliasId);
          message.success('Соответствие забыто — анализ будет обновлён');
          onForgotten();
        } catch (e) {
          message.error(getErrorMessage(e));
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Space size={6} wrap>
        <Tag color="cyan">{ALIAS_BADGE_TEXT}</Tag>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {badge.savedAt ? `сохранено ${badge.savedAt} · ` : ''}использований: {badge.useCount}
        </Text>
        <Button size="small" onClick={openPicker} loading={loading}>Изменить</Button>
        <Button size="small" danger onClick={forget}>Забыть соответствие</Button>
      </Space>
      {picking && options && (
        <Select
          size="small" showSearch style={{ width: '100%' }}
          placeholder="Выбрать другую номенклатуру (вручную)"
          options={options}
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          onChange={(id) => {
            const chosen = options.find((o) => o.value === id);
            if (chosen) onManualPick(rowReference, chosen.value, chosen.label);
            setPicking(false);
          }}
        />
      )}
    </Space>
  );
}
