import { apiFetch } from '../../lib/api/client';

export interface VersionTransferNewPositionPayload {
  row_index: number;
  item_no: string | null;
  hierarchy_level: number;
  work_name: string;
  unit_code: string | null;
  volume: number | null;
  client_note: string | null;
}

export interface VersionTransferMatchPayload {
  old_position_id: string;
  new_row_index: number;
}

export interface ExecuteVersionTransferParams {
  sourceTenderId: string;
  newPositions: VersionTransferNewPositionPayload[];
  matches: VersionTransferMatchPayload[];
}

export interface ExecuteVersionTransferResult {
  tenderId: string;
  version: number;
  positionsInserted: number;
  manualTransferred: number;
  boqItemsCopied: number;
  parentLinksRestored: number;
  costVolumesCopied: number;
  insuranceRowsCopied: number;
  additionalWorksCopied: number;
  additionalWorksSkipped: number;
}

export async function executeVersionTransfer({
  sourceTenderId,
  newPositions,
  matches,
}: ExecuteVersionTransferParams): Promise<ExecuteVersionTransferResult> {
  let envelope: { data: Partial<ExecuteVersionTransferResult> };
  try {
    envelope = await apiFetch<{ data: Partial<ExecuteVersionTransferResult> }>(
      `/api/v1/tenders/${encodeURIComponent(sourceTenderId)}/versions/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({ new_positions: newPositions, matches }),
        // Перенос версии — тяжёлая операция (копирование позиций/BOQ/затрат);
        // отключаем дефолтный 10s-таймаут apiFetch.
        timeoutMs: 0,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка серверного переноса версии: ${msg}`);
  }

  const data = envelope?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Сервер не вернул результат переноса версии');
  }

  const result = data as Partial<ExecuteVersionTransferResult>;

  if (!result.tenderId || typeof result.version !== 'number') {
    throw new Error('Сервер вернул неполный результат переноса версии');
  }

  return {
    tenderId: result.tenderId,
    version: result.version,
    positionsInserted: result.positionsInserted ?? 0,
    manualTransferred: result.manualTransferred ?? 0,
    boqItemsCopied: result.boqItemsCopied ?? 0,
    parentLinksRestored: result.parentLinksRestored ?? 0,
    costVolumesCopied: result.costVolumesCopied ?? 0,
    insuranceRowsCopied: result.insuranceRowsCopied ?? 0,
    additionalWorksCopied: result.additionalWorksCopied ?? 0,
    additionalWorksSkipped: result.additionalWorksSkipped ?? 0,
  };
}
