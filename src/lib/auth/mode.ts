import type { AuthMode } from './types';

// Reads VITE_AUTH_MODE at build time. Vite inlines this expression at compile
// time so the bundle has a constant — no runtime env lookup.
//
// Falsy / unrecognised values fall back to 'supabase' to preserve legacy
// behaviour during the cutover window (this MUST be documented in
// .env.production.yandex.example so a misconfigured prod build defaults
// loudly rather than silently breaks).
export function getAuthMode(): AuthMode {
  const raw = (import.meta.env.VITE_AUTH_MODE ?? '').toString().trim().toLowerCase();
  if (raw === 'app') return 'app';
  return 'supabase';
}

// Convenience constant so call-sites don't repeat the import.
export const AUTH_MODE: AuthMode = getAuthMode();
