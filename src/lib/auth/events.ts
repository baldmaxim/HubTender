import type { AppAuthEvent, AppSession } from './types';

// Minimal event emitter for auth-state changes. Synchronous fan-out so
// AuthContext sees updates in the same React render frame as the cause.
// No EventTarget — we don't need DOM event semantics, and EventTarget loses
// strict typing on payloads.

export type AuthEventListener = (event: AppAuthEvent, session: AppSession | null) => void;

const listeners = new Set<AuthEventListener>();

export function emitAuthEvent(event: AppAuthEvent, session: AppSession | null): void {
  for (const l of listeners) {
    try {
      l(event, session);
    } catch (err) {
      // A listener throwing must not break the others.
      console.error('[auth/events] listener threw:', err);
    }
  }
}

// onAuthStateChange returns a typed unsubscribe-handle that mirrors the
// Supabase subscription shape (`{ subscription: { unsubscribe } }`) so
// AuthContext can replace one provider with the other without touching
// the cleanup logic.
export function onAuthStateChange(listener: AuthEventListener): {
  data: { subscription: { unsubscribe: () => void } };
} {
  listeners.add(listener);
  return {
    data: {
      subscription: {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      },
    },
  };
}
