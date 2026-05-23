import { API_BASE_URL } from '../api/featureFlags';
import { emitAuthEvent } from './events';
import { clearSession, loadSession, saveSession } from './storage';
import type {
  AppAuthError,
  AppAuthUser,
  AppSession,
  AuthResultPayload,
} from './types';

// Refresh access token when it has fewer than this many seconds left.
// Picking 60 s gives the network round-trip plenty of headroom and matches
// the BFF's 15-minute access TTL gracefully.
const REFRESH_LEEWAY_SECONDS = 60;

// In-flight refresh promise — coalesces concurrent callers so we only ever
// rotate the refresh token ONCE per expiry. Without this guard, two parallel
// API calls would each consume the same refresh_token, triggering the
// server's reuse-detection and revoking the whole family.
let inflightRefresh: Promise<AppSession | null> | null = null;

// In-memory session cache. Hydrated from localStorage on first access and
// kept in sync by every public mutator below.
let cached: AppSession | null | undefined; // undefined = not yet read

function ensureLoaded(): AppSession | null {
  if (cached === undefined) cached = loadSession();
  return cached;
}

function persist(session: AppSession | null): void {
  cached = session;
  if (session) saveSession(session);
  else clearSession();
}

function makeError(message: string, status?: number, code?: AppAuthError['code']): AppAuthError {
  const err = new Error(message) as AppAuthError;
  err.status = status;
  err.code = code;
  return err;
}

function toAppSession(payload: AuthResultPayload): AppSession {
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_at: Math.floor(new Date(payload.expires_at).getTime() / 1000),
    refresh_expires_at: Math.floor(new Date(payload.refresh_expires_at).getTime() / 1000),
    user: payload.user,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// signInWithPassword posts to /api/v1/auth/login. On success: persists the
// session, emits SIGNED_IN, returns the session. Maps Go BFF error codes to
// AppAuthError codes so the Login page can show consistent toasts.
export async function signInWithPassword(email: string, password: string): Promise<AppSession> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch((err) => {
    throw makeError(`network: ${(err as Error).message}`, undefined, 'network');
  });

  if (!res.ok) {
    if (res.status === 401) throw makeError('invalid credentials', 401, 'invalid_credentials');
    if (res.status === 403) throw makeError('account access disabled', 403, 'access_blocked');
    throw makeError(`login failed (${res.status})`, res.status, 'unknown');
  }

  const payload = (await res.json()) as AuthResultPayload;
  const session = toAppSession(payload);
  persist(session);
  emitAuthEvent('SIGNED_IN', session);
  return session;
}

// signOut posts to /api/v1/auth/logout (best-effort) and unconditionally
// clears local state. We do NOT propagate logout errors — the user wanted
// out, and the server can sweep dangling tokens on the next refresh attempt.
export async function signOut(): Promise<void> {
  const s = ensureLoaded();
  const token = s?.refresh_token;
  persist(null);
  emitAuthEvent('SIGNED_OUT', null);
  if (!token) return;
  try {
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    });
  } catch {
    // Network failure — local state already cleared; ignore.
  }
}

// getSession returns the current cached session (or null). Does not refresh.
export function getSession(): AppSession | null {
  return ensureLoaded();
}

// getUser returns the user payload from the current session (or null).
export function getUser(): AppAuthUser | null {
  return ensureLoaded()?.user ?? null;
}

// getAccessToken returns a valid access token, refreshing on the fly if the
// cached one is missing / expired / about to expire. Returns null when no
// session exists at all (so the caller can short-circuit).
export async function getAccessToken(): Promise<string | null> {
  const s = ensureLoaded();
  if (!s) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (s.expires_at - nowSec > REFRESH_LEEWAY_SECONDS) {
    return s.access_token;
  }
  const refreshed = await refreshSession();
  return refreshed?.access_token ?? null;
}

// refreshSession posts to /api/v1/auth/refresh, rotates the local pair, and
// emits TOKEN_REFRESHED. Returns null when the refresh fails (in which case
// the local session is purged and SIGNED_OUT is emitted — the caller should
// redirect to /login).
//
// Coalesces concurrent callers via inflightRefresh — the server's reuse-
// detection would otherwise revoke the whole token family.
export function refreshSession(): Promise<AppSession | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const s = ensureLoaded();
      if (!s) return null;
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      }).catch(() => null);

      if (!res || !res.ok) {
        // Refresh failed — purge and emit SIGNED_OUT so the AuthContext
        // navigates to /login. Don't differentiate 401 from network here:
        // either way, the client cannot recover without a fresh login.
        persist(null);
        emitAuthEvent('SIGNED_OUT', null);
        return null;
      }
      const payload = (await res.json()) as AuthResultPayload;
      const newSession = toAppSession(payload);
      persist(newSession);
      emitAuthEvent('TOKEN_REFRESHED', newSession);
      return newSession;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

// me fetches the current profile from /api/v1/auth/me. Used by AuthContext
// at startup (after a stored-session hydrate) to refresh allowed_pages /
// access_status — the access token claim is stable but the underlying row
// can move (admin approve, role change).
export async function me(): Promise<AppAuthUser | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) {
    if (res && res.status === 401) {
      // Token was rejected even after refresh — give up and SIGN_OUT.
      persist(null);
      emitAuthEvent('SIGNED_OUT', null);
    }
    return null;
  }
  const payload = (await res.json()) as AppAuthUser;
  // Sync the user payload into the stored session.
  const s = ensureLoaded();
  if (s) {
    s.user = payload;
    persist(s);
    emitAuthEvent('USER_UPDATED', s);
  }
  return payload;
}

// hydrate is called at AuthContext mount: loads the persisted session into
// memory and emits INITIAL_SESSION (mirroring Supabase's startup behaviour).
// Idempotent — safe to call multiple times.
export function hydrate(): AppSession | null {
  const s = ensureLoaded();
  emitAuthEvent('INITIAL_SESSION', s);
  return s;
}

// getCurrentUserId returns the local user id (sub claim of the access
// token / persisted session.user.id). Synchronous; null when not signed in.
// Used by call sites that previously called supabase.auth.getUser() — those
// callers need a quick id for createdBy / cache keys, NOT the full profile.
export function getCurrentUserId(): string | null {
  return ensureLoaded()?.user.id ?? null;
}

// Re-export the subscription API so call sites can `import { onAuthStateChange }
// from '...lib/auth/client'` without knowing about events.ts.
export { onAuthStateChange } from './events';
