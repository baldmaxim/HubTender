import { createElement, useCallback } from 'react';
import { Modal } from 'antd';
import { activeRuns, fetchAutopriceReviews, fetchAutopriceRuns } from '../lib/api/autoprice';
import { isNotApproved } from '../pages/AutopriceReview/utils/reviewPolicy';
import type { IReviewRow } from '../pages/AutopriceReview/types';

const MAX_LISTED = 20;

const askConfirm = (notApproved: IReviewRow[]): Promise<boolean> =>
  new Promise((resolve) => {
    const listed = notApproved.slice(0, MAX_LISTED);
    const rest = notApproved.length - listed.length;
    Modal.confirm({
      title: `Есть неподтверждённые позиции авторасценки: ${notApproved.length}`,
      content: createElement(
        'div',
        null,
        ...listed.map((r) =>
          createElement('div', { key: r.client_position_id }, `${r.item_no ?? r.position_number} — ${r.work_name}`),
        ),
        rest > 0 ? createElement('div', { key: 'rest' }, `…и ещё ${rest}`) : null,
      ),
      okText: 'Экспортировать всё равно',
      cancelText: 'Отмена',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

/**
 * Предупреждение перед экспортом: в тендере есть авторасценка с неподтверждёнными позициями.
 * Только предупреждает — любая ошибка запросов и отсутствие прогонов дают `true` без UI.
 */
export const useAutopriceExportWarning = () => {
  const confirmExport = useCallback(async (tenderId: string): Promise<boolean> => {
    try {
      const runs = activeRuns(await fetchAutopriceRuns(tenderId));
      if (runs.length === 0) return true;
      const latest = [...runs].sort((a, b) => b.imported_at.localeCompare(a.imported_at))[0];
      const { reviews } = await fetchAutopriceReviews(latest.id);
      const notApproved = (reviews ?? []).filter(isNotApproved);
      if (notApproved.length === 0) return true;
      return await askConfirm(notApproved);
    } catch {
      return true;
    }
  }, []);

  return { confirmExport };
};
