// Thin fetch wrapper for the Go BFF. Attaches Supabase JWT automatically.
import { supabase } from '../supabase';
import { API_BASE_URL } from './featureFlags';

type FetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.title ?? res.statusText), {
      status: res.status,
      body,
    });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
