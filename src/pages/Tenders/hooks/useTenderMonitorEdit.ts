import { useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { patchTenderRegistryFields } from '../../../lib/api/tenderRegistry';
import type { TenderRegistryWithRelations, TenderStatus } from '../../../lib/types';
import {
  buildRegistryPatch,
  buildTenderDraft,
  isInfoDraftValid,
  type ChronologyDraftRow,
  type ITenderDraft,
  type ITenderInfoDraft,
  type PackageDraftRow,
} from '../utils/tenderMonitorDraft';

export type TenderSaveResult = 'saved' | 'unchanged' | 'invalid' | 'failed';

type RowsUpdater<T> = (rows: T[]) => T[];

interface IEditSession {
  /** Снимок на входе в редактирование: с ним сравниваем, что отправить. */
  original: ITenderDraft;
  draft: ITenderDraft;
}

interface IUseTenderMonitorEditArgs {
  tender: TenderRegistryWithRelations | null;
  open: boolean;
  statuses: TenderStatus[];
  onUpdate: () => Promise<void> | void;
}

// Общий режим редактирования карточки тендера: «Редактировать» → черновик всех вкладок →
// «Сохранить» одним запросом. Фоновое обновление перечня черновик не трогает.
export function useTenderMonitorEdit({ tender, open, statuses, onUpdate }: IUseTenderMonitorEditArgs) {
  const { message } = App.useApp();
  const [session, setSession] = useState<IEditSession | null>(null);
  const [saving, setSaving] = useState(false);
  // Enter сразу после ввода сохраняет свежий черновик, а не замыкание прошлого рендера.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const savingRef = useRef(false);

  const tenderId = tender?.id;
  // Закрытие окна или другой тендер — выход из редактирования без сохранения.
  useEffect(() => {
    setSession(null);
  }, [open, tenderId]);

  const startEdit = () => {
    if (!tender) return;
    const draft = buildTenderDraft(tender);
    setSession({ original: draft, draft });
  };

  const cancelEdit = () => setSession(null);

  const updateDraft = (update: (draft: ITenderDraft) => ITenderDraft) =>
    setSession((prev) => (prev ? { ...prev, draft: update(prev.draft) } : prev));

  const updateInfo = <K extends keyof ITenderInfoDraft>(key: K, value: ITenderInfoDraft[K]) =>
    updateDraft((draft) => ({ ...draft, info: { ...draft.info, [key]: value } }));

  const updateChronology = (update: RowsUpdater<ChronologyDraftRow>) =>
    updateDraft((draft) => ({ ...draft, chronology: update(draft.chronology) }));

  const updatePackageItems = (update: RowsUpdater<PackageDraftRow>) =>
    updateDraft((draft) => ({ ...draft, packageItems: update(draft.packageItems) }));

  const save = async (): Promise<TenderSaveResult> => {
    const current = sessionRef.current;
    if (!current || !tender || savingRef.current) return 'unchanged';

    if (!isInfoDraftValid(current.draft.info)) {
      message.error('Заполните наименование и заказчика');
      return 'invalid';
    }

    const patch = buildRegistryPatch(current.original, current.draft, tender, statuses);
    if (Object.keys(patch).length === 0) {
      setSession(null);
      return 'unchanged';
    }

    const setBusy = (busy: boolean) => {
      savingRef.current = busy;
      setSaving(busy);
    };

    setBusy(true);
    try {
      await patchTenderRegistryFields(tender.id, patch);
    } catch (err) {
      setBusy(false);
      message.error((err as Error).message);
      return 'failed';
    }

    // «Сохранить» крутится до перечитывания перечня: повторный клик не шлёт тот же патч.
    try {
      await onUpdate();
    } finally {
      setBusy(false);
    }
    setSession(null);
    message.success('Изменения сохранены');
    return 'saved';
  };

  return {
    editing: session != null,
    draft: session?.draft ?? null,
    saving,
    startEdit,
    cancelEdit,
    updateInfo,
    updateChronology,
    updatePackageItems,
    save,
  };
}
