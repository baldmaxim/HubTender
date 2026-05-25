// Type-only barrel. The folder name remains `supabase/` for historical
// continuity (avoids touching the 80+ files that import types from here),
// but no Supabase runtime code is shipped with the bundle — the SDK was
// removed in docs/yandex-migration/43_SUPABASE_AUTH_REMOVAL_RESULT.md.
// Types in this folder are kept-in-sync via `npm run gen:types` against
// the source-of-truth schema (currently still Supabase pre-prod; replace
// with a Yandex-pg-typed pipeline when convenient).
export * from './types';
export * from './types/tasks';
