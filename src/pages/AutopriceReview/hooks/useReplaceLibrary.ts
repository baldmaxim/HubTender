import { useEffect, useState } from 'react';
import { App } from 'antd';
import { listMaterialsLibrary, listWorksLibrary } from '../../../lib/api/library';
import { autopriceErrorMessage } from '../../../lib/api/autoprice';
import type { MaterialLibraryFull, WorkLibraryFull } from '../../../lib/types';

export type ReplaceKind = 'work' | 'material';

/** Выбранная позиция библиотеки: работа или материал. */
export type ReplaceChoice =
  | { kind: 'work'; lib: WorkLibraryFull }
  | { kind: 'material'; lib: MaterialLibraryFull };

export interface IReplaceLibraryEntry {
  name: string;
  choice: ReplaceChoice;
}

/** Библиотека одного вида (работы или материалы) для поиска замены; грузится при открытии модалки. */
export const useReplaceLibrary = (kind: ReplaceKind) => {
  const { message } = App.useApp();
  const [works, setWorks] = useState<WorkLibraryFull[]>([]);
  const [materials, setMaterials] = useState<MaterialLibraryFull[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async (): Promise<void> => {
      try {
        if (kind === 'work') {
          const data = await listWorksLibrary();
          if (!cancelled) {
            setWorks(
              data.map((i) => ({ ...i, work_name: i.work_names?.name, unit: i.work_names?.unit })) as unknown as WorkLibraryFull[],
            );
          }
        } else {
          const data = await listMaterialsLibrary();
          if (!cancelled) {
            setMaterials(
              data.map((i) => ({
                ...i,
                material_name: i.material_names?.name,
                unit: i.material_names?.unit,
              })) as unknown as MaterialLibraryFull[],
            );
          }
        }
      } catch (error) {
        if (!cancelled) message.error('Ошибка загрузки библиотеки: ' + autopriceErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [kind, message]);

  const entries: IReplaceLibraryEntry[] =
    kind === 'work'
      ? works.map((w) => ({ name: w.work_name ?? '', choice: { kind: 'work', lib: w } }))
      : materials.map((m) => ({ name: m.material_name ?? '', choice: { kind: 'material', lib: m } }));

  return { entries, loading };
};
