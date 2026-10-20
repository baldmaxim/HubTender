import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import { deleteTenderRegistryRows, type DeletedTenderRegistryRow } from '../../../lib/api/tenderRegistry';
import type { TenderRegistryWithRelations } from '../../../lib/types';
import { pluralize } from '../../../utils/pluralize';
import type { ITenderSelection } from '../components/selection/tenderSelection';

interface IUseTenderDeleteModeArgs {
  tenders: TenderRegistryWithRelations[];
  onDeleted: () => Promise<void> | void;
}

// «Удалить тендер»: режим выбора → окно подтверждения → одно удаление на сервере.
export function useTenderDeleteMode({ tenders, onDeleted }: IUseTenderDeleteModeArgs) {
  const { message } = App.useApp();
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Тендер, который тем временем удалил другой пользователь, из выбора выпадает сам.
  const selectedTenders = useMemo(
    () => tenders.filter((tender) => selectedIds.has(tender.id)),
    [tenders, selectedIds]
  );

  const start = () => {
    setSelectedIds(new Set());
    setActive(true);
  };

  const cancel = useCallback(() => {
    setActive(false);
    setConfirmOpen(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Esc выходит из режима выбора; при открытом подтверждении Esc закрывает только окно.
  const confirmOpenRef = useRef(confirmOpen);
  confirmOpenRef.current = confirmOpen;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmOpenRef.current) cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, cancel]);

  const confirmDelete = async () => {
    const ids = selectedTenders.map((tender) => tender.id);
    if (ids.length === 0) return;

    setDeleting(true);
    let deleted: DeletedTenderRegistryRow[];
    try {
      deleted = await deleteTenderRegistryRows(ids);
    } catch (err) {
      setDeleting(false);
      message.error((err as Error).message);
      return;
    }

    // Выходим из режима после перечитывания перечня — удалённые строки не мелькают снова.
    try {
      await onDeleted();
    } finally {
      setDeleting(false);
    }
    cancel();
    message.success(
      `Удалено из перечня: ${deleted.length} ${pluralize(deleted.length, 'тендер', 'тендера', 'тендеров')}`
    );
  };

  const selection = useMemo<ITenderSelection>(
    () => ({ active, isSelected: (id) => selectedIds.has(id), toggle }),
    [active, selectedIds, toggle]
  );

  return {
    active,
    selection,
    selectedTenders,
    deleting,
    confirmOpen,
    start,
    cancel,
    openConfirm: () => setConfirmOpen(true),
    closeConfirm: () => setConfirmOpen(false),
    confirmDelete,
  };
}
