// Thin fetch wrapper for the Go BFF. Attaches Supabase JWT automatically.
import { supabase } from '../supabase';
import { API_BASE_URL } from './featureFlags';

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
};

interface CachedResponse {
  etag: string;
  body: unknown;
}

// Module-level ETag cache. Survives component re-mounts within a tab; cleared
// on full page reload. Not persisted across sessions.
const etagCache = new Map<string, CachedResponse>();

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { cacheKey, ...rest } = options;
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const cached = cacheKey ? etagCache.get(cacheKey) : undefined;
  if (cached && !headers['If-None-Match']) {
    headers['If-None-Match'] = cached.etag;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
  });

  if (res.status === 304 && cached) {
    return cached.body as T;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.title ?? res.statusText), {
      status: res.status,
      body,
    });
  }

  if (res.status === 204) return undefined as T;

  const body = (await res.json()) as T;

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
