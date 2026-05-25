// Thin fetch wrapper for the Go BFF.
//
// Attaches a Bearer token from the app-auth client (auto-refresh on
// near-expiry, no Supabase round-trip).
import { API_BASE_URL } from './featureFlags';
import {
  getAccessToken as appAuthGetAccessToken,
  refreshSession as appAuthRefreshSession,
} from '../auth/client';

type FetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
  /**
   * When set, apiFetch stores the ETag from 200 responses under this key and
   * sends it back as If-None-Match on subsequent calls. On 304 the previously
   * cached body is returned without a new network round-trip body.
   *
   * Use stable strings, not URLs (e.g. 'ref:roles') — handlers may alias paths.
   */
  cacheKey?: string;
  /**
   * Per-call timeout in milliseconds. Defaults to DEFAULT_FETCH_TIMEOUT_MS.
   * Pass 0 to disable the timeout (e.g. long-running exports).
   */
  timeoutMs?: number;
};

// Если Go BFF недоступен/висит, браузерный fetch по умолчанию ждёт десятки
// секунд и может блокировать autosave-цепочки. 10 с — запас для здорового
// ответа и быстрый fail в сценариях «сервис лежит».
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface CachedResponse {
  etag: string;
  body: unknown;
}

// Module-level ETag cache. Survives component re-mounts within a tab; cleared
// on full page reload. Not persisted across sessions.
const etagCache = new Map<string, CachedResponse>();

async function getToken(): Promise<string | null> {
  return appAuthGetAccessToken();
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { cacheKey, timeoutMs, signal: callerSignal, ...rest } = options;
  const token = await getToken();

  const buildRequest = (bearer: string | null): { headers: Record<string, string>; signal: AbortSignal | undefined } => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    };
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

    const cached = cacheKey ? etagCache.get(cacheKey) : undefined;
    if (cached && !headers['If-None-Match']) {
      headers['If-None-Match'] = cached.etag;
    }

    // Timeout + пользовательский signal. AbortSignal.any объединяет оба
    // (браузеры Chromium 116+, Firefox 124+, Safari 17.4+).
    const timeout = timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const signals: AbortSignal[] = [];
    if (timeout > 0) signals.push(AbortSignal.timeout(timeout));
    if (callerSignal) signals.push(callerSignal);
    const signal = signals.length === 0
      ? undefined
      : signals.length === 1
        ? signals[0]
        : AbortSignal.any(signals);

    return { headers, signal };
  };

  const cached = cacheKey ? etagCache.get(cacheKey) : undefined;

  let { headers, signal } = buildRequest(token);
  let res = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers, signal });

  // 401 retry: try ONE refresh+retry before giving up. The refreshSession()
  // helper coalesces concurrent callers, so multiple parallel apiFetch calls
  // won't burn the refresh token in parallel.
  if (res.status === 401) {
    const refreshed = await appAuthRefreshSession();
    if (refreshed) {
      ({ headers, signal } = buildRequest(refreshed.access_token));
      res = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers, signal });
    }
    // If refresh failed, refreshSession already emitted SIGNED_OUT — the
    // AuthContext will navigate to /login. Returning the 401 below lets the
    // caller surface the failure too.
  }

  if (res.status === 304 && cached) {
    return cached.body as T;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Предпочитаем `detail` (RFC 7807) — там приходит конкретное сообщение
    // от Go-handler/SQL, иначе откатываемся на `title` или statusText.
    const messageText = body.detail || body.title || res.statusText;
    throw Object.assign(new Error(messageText), {
      status: res.status,
      body,
    });
  }

  if (res.status === 204) return undefined as T;

  // Некоторые batch-эндпоинты Go BFF отвечают 201/200 с пустым телом.
  // res.json() на пустом body кидает SyntaxError — поэтому читаем как текст
  // и парсим только при непустом содержимом.
  const text = await res.text();
  if (!text) return undefined as T;
  const body = JSON.parse(text) as T;

  if (cacheKey) {
    const etag = res.headers.get('ETag');
    if (etag) {
      etagCache.set(cacheKey, { etag, body });
    }
  }

  return body;
}

/** Drop one entry (or everything) from the client-side ETag cache. */
export function invalidateApiCache(key?: string): void {
  if (key) etagCache.delete(key);
  else etagCache.clear();
}
