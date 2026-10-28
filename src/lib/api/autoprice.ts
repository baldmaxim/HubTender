// Подтверждение авторасценки: тендеры с прогонами, список позиций и ревью инженера.
import { apiFetch } from './client';
import type {
  AutopriceAction,
  IAutopriceRun,
  IAutopriceTender,
  IPositionDetail,
  IReviewDetail,
  IReviewPatch,
  IReviewsResponse,
} from '../../pages/AutopriceReview/types';

export const fetchAutopriceTenders = async (): Promise<IAutopriceTender[]> => {
  const res = await apiFetch<{ tenders: IAutopriceTender[] }>('/api/v1/autoprice-tenders');
  return res.tenders ?? [];
};

export const fetchAutopriceRuns = async (tenderId: string): Promise<IAutopriceRun[]> => {
  const res = await apiFetch<{ runs: IAutopriceRun[] }>(`/api/v1/tenders/${tenderId}/autoprice-runs`);
  return res.runs ?? [];
};

export const fetchAutopriceReviews = (sessionId: string): Promise<IReviewsResponse> =>
  apiFetch<IReviewsResponse>(`/api/v1/autoprice-runs/${sessionId}/reviews`);

export const fetchAutopricePosition = (sessionId: string, positionId: string): Promise<IPositionDetail> =>
  apiFetch<IPositionDetail>(`/api/v1/autoprice-runs/${sessionId}/positions/${positionId}`);

export const patchAutopriceReview = (
  sessionId: string,
  positionId: string,
  patch: IReviewPatch,
): Promise<IReviewDetail> =>
  apiFetch<IReviewDetail>(`/api/v1/autoprice-runs/${sessionId}/positions/${positionId}/review`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const postAutopriceAction = (
  sessionId: string,
  positionId: string,
  action: AutopriceAction,
  comment?: string,
): Promise<IReviewDetail> =>
  apiFetch<IReviewDetail>(`/api/v1/autoprice-runs/${sessionId}/positions/${positionId}/review/action`, {
    method: 'POST',
    body: JSON.stringify({ action, comment }),
  });

/** Не отменённые прогоны: самый свежий — первый (бэкенд сортирует по imported_at desc). */
export const activeRuns = (runs: IAutopriceRun[]): IAutopriceRun[] => runs.filter((r) => !r.cancelled_at);

/** Русское сообщение бэкенда из тела `{error, message}`; иначе текст ошибки. */
export const autopriceErrorMessage = (err: unknown): string => {
  const body = (err as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === 'string' && body.message) return body.message;
  return err instanceof Error ? err.message : 'Не удалось выполнить запрос';
};
