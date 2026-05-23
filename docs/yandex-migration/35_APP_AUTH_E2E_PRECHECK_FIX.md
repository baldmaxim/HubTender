# 35 — App-Auth E2E Pre-Check Fix

> Phase 6 frontend pre-check found `supabaseWithAudit.ts` actively used in
> `src/pages/PositionItems/**`, but its three internal helpers
> (`fetchItemETag`, `patchItemOnce`, `deleteItemOnce`) read the Bearer
> token via `supabase.auth.getSession()` — empty in `VITE_AUTH_MODE=app`,
> so BFF /api/v1/items/* would 401. This addendum records the minimal fix.

## Blocker found

| File | Issue |
|---|---|
| [src/lib/supabaseWithAudit.ts](../../src/lib/supabaseWithAudit.ts) (lines 11, 35, 58 pre-fix) | Three direct `supabase.auth.getSession()` calls inside Go-BFF fetch helpers. In `AUTH_MODE=app` Supabase never authenticates → no Bearer token → BFF 401. |

Call-sites that would have broken in app mode:

- [src/pages/PositionItems/PositionItems.tsx:148](../../src/pages/PositionItems/PositionItems.tsx#L148), 177, 219
- [src/pages/PositionItems/hooks/useItemActions.ts:82](../../src/pages/PositionItems/hooks/useItemActions.ts#L82), 142, 176, 209, 356
- [src/pages/PositionItems/hooks/useBoqItemsImport.ts:879](../../src/pages/PositionItems/hooks/useBoqItemsImport.ts#L879)
- [src/pages/PositionItems/hooks/useAuditRollback.ts:52](../../src/pages/PositionItems/hooks/useAuditRollback.ts#L52)

## Fix (Variant A — minimal)

Single file change: [src/lib/supabaseWithAudit.ts](../../src/lib/supabaseWithAudit.ts).

1. Added private helper `getAuditAccessToken()` that branches on `AUTH_MODE`:
   - `app` → `appAuthGetAccessToken()` (auto-refresh, single-flight; same as `src/lib/api/client.ts`)
   - `supabase` → legacy `supabase.auth.getSession()`
2. Replaced the three direct `getSession()` callers (`fetchItemETag`, `patchItemOnce`, `deleteItemOnce`) with `getAuditAccessToken()`.
3. Replaced the silent "send anonymous if no token" behaviour with an explicit `throw new Error('Authentication required')`. The previous flow let unauthenticated requests reach the BFF, which then 401'd with a confusing error path.
4. Added a deprecation header explaining the module's status and the
   replace-call-sites TODO.

No circular dependency:
- `src/lib/auth/client.ts` imports `featureFlags`, `events`, `storage`, `types` — never `supabaseWithAudit`
- `src/lib/auth/mode.ts` imports only its sibling `types.ts`

Existing behaviour preserved: `fetchItemETag` / `patchItemOnce` / `deleteItemOnce` / `insertBoqItemWithAudit` / `updateBoqItemWithAudit` / `deleteBoqItemWithAudit` / rollback — all keep their ETag / If-Match semantics, retry count, error wording.

## Checks

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ OK |
| `npm run lint -- --max-warnings 0` | ✅ OK |
| `npm run build` | ✅ OK |
| `npm run build:prod` (`--mode production.yandex`) | ✅ OK (~1 min, Sentry source maps uploaded) |

### Grep results

```
$ grep -n "supabase.auth.getSession()" src/lib/supabaseWithAudit.ts
40:  const { data } = await supabase.auth.getSession();
```

The single remaining call is inside the `else` branch of `getAuditAccessToken()`, fenced by `AUTH_MODE === 'app'` — allowed per spec ("fallback helper содержит supabase.auth.getSession() допустимо только внутри AUTH_MODE !== 'app' branch").

```
$ grep -rE "supabase\.(from|rpc|channel|removeChannel)\(" src --include="*.{ts,tsx}" | grep -v database.types.ts
(no matches)
```

`supabase.auth` aggregate count across `src/`: 21 (was 23 before fix; three direct call sites → one mode-gated helper).

## Remaining tech debt

- ⚠️ **The four PositionItems call-sites still import `supabaseWithAudit`** — works in app mode now, but the module remains the only off-`src/lib/api/` mutation path on BOQ items. Replace with typed wrappers in `src/lib/api/boq.ts` and delete `supabaseWithAudit.ts`. Separate PR.
- ⚠️ Frontend has NOT yet been clicked through in a real browser. This addendum only unblocks the E2E run; the actual E2E (login → /tenders → /positions/:id → edit BOQ item → save → reload → logout) is the next step.

## Status after fix

**APP_AUTH_E2E_PRECHECK_OK** — pre-check blocker resolved; E2E smoke can proceed.

Linked docs:
- [32_APP_AUTH_BACKEND_MVP_RESULT.md](32_APP_AUTH_BACKEND_MVP_RESULT.md) — backend MVP
- [33_APP_AUTH_BACKEND_SMOKE_RESULT.md](33_APP_AUTH_BACKEND_SMOKE_RESULT.md) — backend smoke
- [34_FRONTEND_APP_AUTH_MVP_RESULT.md](34_FRONTEND_APP_AUTH_MVP_RESULT.md) — frontend MVP
- 36_… (next) — E2E smoke result
