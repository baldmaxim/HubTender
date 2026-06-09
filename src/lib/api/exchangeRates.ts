// Курсы валют ЦБ РФ через Go BFF (cbr.ru проксируется на сервере — из браузера
// напрямую нельзя из-за отсутствия CORS). Эндпоинт: GET /api/v1/exchange-rates.
import { apiFetch } from './client';

export interface CbrRates {
  /** Фактическая дата курса (ISO YYYY-MM-DD), как её вернул ЦБ. */
  date: string;
  /** RUB за 1 USD. */
  usd: number;
  /** RUB за 1 EUR. */
  eur: number;
  /** RUB за 1 CNY. */
  cny: number;
}

/** Курсы ЦБ РФ на дату `date` (YYYY-MM-DD). Бросает при недоступности ЦБ. */
export async function fetchCbrRates(date: string): Promise<CbrRates> {
  const res = await apiFetch<{ data: CbrRates }>(
    `/api/v1/exchange-rates?date=${encodeURIComponent(date)}`,
  );
  return res.data;
}
