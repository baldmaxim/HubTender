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

// RegisterPayload is the JSON body of POST /api/v1/auth/register.
export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
}

// RegisterResult mirrors the server response. access_status will be
// 'pending' for normal sign-ups (operator must approve) or 'approved' in
// the empty-DB bootstrap-admin edge case.
export interface RegisterResult {
  user_id: string;
  email: string;
  access_status: string;
}

// registerWithPassword posts to /api/v1/auth/register. It does NOT create
// a session — the new account lands in access_status='pending' and the
// user must wait for admin approval before login (an admin notification is
// fanned out on the server side). UI calls signInWithPassword separately
// after approval. The plaintext password leaves the browser exactly once
// (this POST) and is never stored locally.
export async function registerWithPassword(payload: RegisterPayload): Promise<RegisterResult> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    throw makeError(`network: ${(err as Error).message}`, undefined, 'network');
  });

  if (!res.ok) {
    if (res.status === 409) throw makeError('email already registered', 409, 'invalid_credentials');
    if (res.status === 400) {
      // Surface server-side validation detail (RFC 7807) when present so
      // the Register form can show "пароль слишком короткий" etc.
      let detail = 'invalid registration data';
      try {
        const body = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {
        /* ignore */
      }
      throw makeError(detail, 400, 'invalid_credentials');
    }
    throw makeError(`register failed (${res.status})`, res.status, 'unknown');
  }

  return (await res.json()) as RegisterResult;
}

// ForgotPasswordResult mirrors the server response. `reset_url` is only
// present in non-prod environments where SMTP is not configured (operator
// convenience for end-to-end testing without an email round-trip).
export interface ForgotPasswordResult {
  success: boolean;
  reset_url?: string;
}

// forgotPassword posts to /api/v1/auth/forgot-password. The server ALWAYS
// returns 200 with `success: true` regardless of whether the email exists
// (anti-enumeration) — the caller should show the same "если email есть,
// мы отправили письмо" toast for any outcome.
export async function forgotPassword(email: string): Promise<ForgotPasswordResult> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch((err) => {
    throw makeError(`network: ${(err as Error).message}`, undefined, 'network');
  });
  if (!res.ok) {
    throw makeError(`forgot-password failed (${res.status})`, res.status, 'unknown');
  }
  return (await res.json()) as ForgotPasswordResult;
}

// resetPassword posts to /api/v1/auth/reset-password. token is the value
// from the email link (server hashes it before lookup). Returns void on
// success (204); throws on invalid/used/expired token (401) or weak
// password (400).
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  }).catch((err) => {
    throw makeError(`network: ${(err as Error).message}`, undefined, 'network');
  });
  if (res.status === 204) return;
  if (res.status === 401) throw makeError('invalid or expired reset token', 401, 'refresh_invalid');
  if (res.status === 400) {
    let detail = 'invalid reset request';
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw makeError(detail, 400, 'invalid_credentials');
  }
  throw makeError(`reset failed (${res.status})`, res.status, 'unknown');
}

// changePassword posts to /api/v1/auth/change-password. Requires an active
// app-auth session (sends Bearer via getAccessToken). On success ALL
// refresh tokens of the user are revoked server-side — the next /refresh
// call from any tab will fail and force re-login.
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw makeError('not signed in', 401, 'invalid_credentials');
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }).catch((err) => {
    throw makeError(`network: ${(err as Error).message}`, undefined, 'network');
  });
  if (res.status === 204) return;
  if (res.status === 401) throw makeError('current password is incorrect', 401, 'invalid_credentials');
  if (res.status === 400) {
    let detail = 'invalid change request';
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw makeError(detail, 400, 'invalid_credentials');
  }
  throw makeError(`change-password failed (${res.status})`, res.status, 'unknown');
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
