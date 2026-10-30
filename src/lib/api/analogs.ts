// Расценивание по реальному аналогу: поиск позиции-аналога, предпросмотр, применение, отмена.
import { apiFetch } from './client';
import type {
  IAnalogApplication,
  IAnalogApplyRequest,
  IAnalogApplyResult,
  IAnalogNextPosition,
  IAnalogPreview,
  IAnalogRequest,
  IAnalogSearchResponse,
  IAnalogSource,
} from './analogs.types';

/** Предпросмотр и применение гонят расчёт в транзакции — таймаут больше штатного. */
const WRITE_TIMEOUT_MS = 60_000;

const unwrap = <T>(res: { data: T }): T => res.data;

export const searchAnalogs = async (posId: string, q?: string, limit?: number): Promise<IAnalogSearchResponse> => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return unwrap(
    await apiFetch<{ data: IAnalogSearchResponse }>(`/api/v1/positions/${posId}/analogs${qs ? `?${qs}` : ''}`, {
      timeoutMs: 30_000,
    }),
  );
};

export const fetchAnalogSource = async (sourcePosId: string): Promise<IAnalogSource> =>
  unwrap(await apiFetch<{ data: IAnalogSource }>(`/api/v1/analogs/sources/${sourcePosId}`, { timeoutMs: 30_000 }));

export const previewAnalog = async (posId: string, req: IAnalogRequest): Promise<IAnalogPreview> =>
  unwrap(
    await apiFetch<{ data: IAnalogPreview }>(`/api/v1/positions/${posId}/analog:preview`, {
      method: 'POST',
      body: JSON.stringify(req),
      timeoutMs: WRITE_TIMEOUT_MS,
    }),
  );

export const applyAnalog = async (posId: string, req: IAnalogApplyRequest): Promise<IAnalogApplyResult> =>
  unwrap(
    await apiFetch<{ data: IAnalogApplyResult }>(`/api/v1/positions/${posId}/analog:apply`, {
      method: 'POST',
      body: JSON.stringify(req),
      timeoutMs: WRITE_TIMEOUT_MS,
    }),
  );

export const fetchAnalogApplications = async (posId: string): Promise<IAnalogApplication[]> =>
  unwrap(await apiFetch<{ data: IAnalogApplication[] }>(`/api/v1/positions/${posId}/analog-applications`)) ?? [];

export const revertAnalogApplication = async (id: string): Promise<IAnalogApplication> =>
  unwrap(
    await apiFetch<{ data: IAnalogApplication }>(`/api/v1/analog-applications/${id}/revert`, {
      method: 'POST',
      timeoutMs: WRITE_TIMEOUT_MS,
    }),
  );

export const fetchNextAnalogPosition = async (posId: string): Promise<IAnalogNextPosition | null> =>
  unwrap(await apiFetch<{ data: IAnalogNextPosition | null }>(`/api/v1/positions/${posId}/analog-next`)) ?? null;

/** Русское сообщение бэкенда из тела `{error, message}`; иначе текст ошибки. */
export const analogErrorMessage = (err: unknown): string => {
  const body = (err as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === 'string' && body.message) return body.message;
  return err instanceof Error ? err.message : 'Не удалось выполнить запрос';
};

/** Код ошибки бэкенда (`body.error`), если есть. */
export const analogErrorCode = (err: unknown): string | null => {
  const body = (err as { body?: { error?: unknown } } | null)?.body;
  return body && typeof body.error === 'string' ? body.error : null;
};
