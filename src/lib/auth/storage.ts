import type { AppSession } from './types';
import { invalidateAll as clearPositionRowCache } from '../cache/positionRowCache';

// localStorage key prefix for every app-auth value. Distinct from any
// Supabase key so the two systems can coexist during the cutover.
const PREFIX = 'hubtender_app_auth';
const KEY_SESSION = `${PREFIX}_session`;

// Returns true when localStorage is available (SSR / Node test runners may
// not have window). Defensive — saves a check at every call site.
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

// loadSession returns the persisted session or null. Validates the shape;
// any malformed payload is discarded (so a stale schema can't crash the app).
export function loadSession(): AppSession | null {
  if (!hasLocalStorage()) return null;
  const raw = window.localStorage.getItem(KEY_SESSION);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isAppSession(parsed)) {
      window.localStorage.removeItem(KEY_SESSION);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt JSON — drop and start fresh.
    window.localStorage.removeItem(KEY_SESSION);
    return null;
  }
}

// saveSession persists the session. The plaintext refresh_token MUST stay
// here only — it never leaves the client outside of /refresh /logout POSTs.
//
// The auth session is critical and tiny, but localStorage is shared with
// best-effort caches (e.g. positionRowCache) that can fill the per-origin
// quota. So if setItem throws QuotaExceededError we drop those disposable
// caches and retry once — the session must never lose to a throwaway cache.
// If it still fails, we keep the in-memory session (persistence is best-effort)
// rather than crash the login flow.
export function saveSession(session: AppSession): void {
  if (!hasLocalStorage()) return;
  const payload = JSON.stringify(session);
  try {
    window.localStorage.setItem(KEY_SESSION, payload);
  } catch {
    clearPositionRowCache();
    try {
      window.localStorage.setItem(KEY_SESSION, payload);
    } catch {
      // Storage still full after sweeping caches — give up persisting.
    }
  }
}

// clearSession removes every app-auth key. Called on signOut(), 401-after-
// refresh, and on token-corruption fallbacks. Sweeps the whole prefix so a
// schema change leaves no orphans.
export function clearSession(): void {
  if (!hasLocalStorage()) return;
  const ls = window.localStorage;
  const toRemove: string[] = [];
  for (let i = 0; i < ls.length; i += 1) {
    const k = ls.key(i);
    if (k && k.startsWith(PREFIX)) toRemove.push(k);
  }
  for (const k of toRemove) ls.removeItem(k);
}

// Type guard for AppSession — keeps loadSession honest if the wire shape
// drifts. Doesn't validate JWT signatures (server does that on every call).
function isAppSession(v: unknown): v is AppSession {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.access_token !== 'string' || !o.access_token) return false;
  if (typeof o.refresh_token !== 'string' || !o.refresh_token) return false;
  if (typeof o.expires_at !== 'number') return false;
  if (typeof o.refresh_expires_at !== 'number') return false;
  if (!o.user || typeof o.user !== 'object') return false;
  const u = o.user as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    typeof u.email === 'string' &&
    typeof u.role_code === 'string'
  );
}
