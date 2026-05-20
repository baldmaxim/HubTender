# 27. FINAL DATA REFRESH RESULT

> Fresh end-to-end refresh after Phase 5 frontend migration. Three legs:
> **OLD Supabase → PROD Supabase → Yandex PostgreSQL**, followed by Go BFF
> verification vs Yandex.
>
> Sandbox session itself did **not** modify production `DATABASE_URL`,
> deploy frontend, introduce app-auth, or push (at the time this document
> was first written). Operator-side actions (frontend deploy, Go BFF
> rebuild) followed in a separate session and are recorded in
> [24_FRONTEND_DEPLOY_RESULT.md](./24_FRONTEND_DEPLOY_RESULT.md).
> Note: production Go BFF runtime `DATABASE_URL` had **already** pointed to
> Yandex since the 2026-05-18 cutover
> ([23_RUNTIME_CUTOVER_RESULT.md](./23_RUNTIME_CUTOVER_RESULT.md));
> today's refresh therefore reloaded data into the already-active runtime
> target.
> DSN / passwords / tokens / hashes never printed.

- Date (UTC): 2026-05-20
- Operator confirmations recorded:
  - OLD write-path stopped (no new writes during export).
  - PROD reload authorised (full truncate + re-import).
  - Yandex clean + re-import authorised.
  - Backups / restore points accepted by operator.
- Phase 5 baseline: `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED` (doc 26).
  Frontend runtime business calls = 0; only Supabase Auth bridge remains.

---

## Pipeline summary

| Leg | Stage | Status |
|---|---|---|
| OLD → PROD | connection check | `CHECK_OK` |
| OLD → PROD | export (pool-safe, batch 2500) | `DATA_EXPORT_OK` |
| OLD → PROD | prepare (`--clean-auth --clean-prod`) | `PREPARE_READY` |
| OLD → PROD | import (`--clean-prod --clean-auth`, batch 5000) | `IMPORT_OK` |
| OLD → PROD | verify (rows + checksums + FK) | `VERIFY_OK` |
| OLD → PROD | verify-auth (passwords / identities) | `AUTH_VERIFY_OK` |
| PROD → Yandex | check (PROD + Yandex SSL verify-full) | non-empty target → expected, addressed below |
| PROD → Yandex | fresh export PROD (`source_label=PROD_SUPABASE`) | `DATA_EXPORT_OK` |
| PROD → Yandex | clean Yandex (data only) | `DATA_CLEAN_OK` |
| PROD → Yandex | verify-schema (Yandex 0 rows + extensions + triggers) | `SCHEMA_VERIFY_OK` |
| PROD → Yandex | import (`--confirm`, batch 5000) | `DATA_IMPORT_OK` |
| PROD → Yandex | verify (rows + checksums + FK) | `YANDEX_VERIFY_OK` |
| PROD → Yandex | verify-passwords (bcrypt) | `YANDEX_AUTH_VERIFY_OK` |
| Go BFF | smoke vs Yandex (22 checks) | `GO_BFF_YANDEX_VERIFY_OK` |

All gating scripts emitted their canonical `*_OK` tokens. No blockers, no
manual repair needed.

---

## Row counts (canonical — all 3 tiers identical)

OLD → PROD verify (`docs/old-to-prod/VERIFY_RESULT.md`) and PROD → Yandex
verify (`docs/yandex-migration/13_YANDEX_VERIFY_RESULT.md`) match
row-by-row across all 41 public + 2 auth tables.

| Table | rows |
|---|---:|
| `public.roles` | 9 |
| `public.units` | 28 |
| `public.construction_scopes` | 5 |
| `public.tender_statuses` | 4 |
| `public.markup_parameters` | 15 |
| `public.library_folders` | 7 |
| `public.notifications` | 0 |
| `public.users` | 33 |
| `public.cost_categories` | 24 |
| `public.material_names` | 6 593 |
| `public.work_names` | 2 341 |
| `public.detail_cost_categories` | 218 |
| `public.markup_tactics` | 3 |
| `public.materials_library` | 1 843 |
| `public.works_library` | 856 |
| `public.tender_registry` | 69 |
| `public.tenders` | 49 |
| `public.client_positions` | 46 033 |
| `public.import_sessions` | 246 |
| `public.templates` | 238 |
| `public.construction_cost_volumes` | 3 774 |
| `public.tender_insurance` | 16 |
| `public.tender_markup_percentage` | 597 |
| `public.tender_notes` | 6 |
| `public.tender_pricing_distribution` | 31 |
| `public.tender_documents` | 0 |
| `public.subcontract_growth_exclusions` | 1 712 |
| `public.user_tasks` | 165 |
| `public.boq_items` | 118 491 |
| `public.boq_items_audit` | 408 794 |
| `public.template_items` | 1 104 |
| `public.user_position_filters` | 9 221 |
| `public.comparison_notes` | 2 321 |
| `public.cost_redistribution_results` | 31 364 |
| `public.projects` | 12 |
| `public.project_additional_agreements` | 76 |
| `public.project_monthly_completion` | 386 |
| `public.tender_groups` | 54 |
| `public.tender_group_members` | 186 |
| `public.tender_iterations` | 0 |
| `auth.users` | 33 |
| `auth.identities` | 33 (PROD) / 33 (Yandex) — see auth note |

Total payload across both legs ≈ **637 100+ rows** moved cleanly.

### Auth identities note

- OLD has 4 native `auth.identities` rows + 29 users without identities (legacy
  Supabase shape).
- OLD → PROD import bootstrapped **29 missing email-identities** → PROD has 33
  identities matching 33 users (`old=4 + bootstrap=29 = 33`).
- PROD → Yandex copied the resolved 33 identities directly → Yandex matches
  PROD exactly. `passwords: match=33 mismatch=0 missing=0 both_null=0`. bcrypt
  smoke ✓ on `o***@gmail.com`.

### `boq_items_audit`

`prod=408 794 yandex=408 794 inflation=0`. Audit triggers were disabled during
import (`trg_boq_items_audit`) and re-enabled in `finally` — verified active
post-import on both tiers.

### Data freshness

All exports were taken fresh today (2026-05-20). No reuse of older artefacts.
Manifests: `.old-to-prod-export/manifest.json` and
`.prod-to-yandex-export/manifest.json` — both `source_label=PROD_SUPABASE` /
OLD respectively, `duplicate_pk_total=0`, `errors=[]`, raw-type parsers
(date/timestamp/timestamptz/jsonb/json) self-checked.

---

## Go BFF status

- Local Go binary (HEAD `713607a`) launched with
  `DATABASE_URL=<YANDEX_DATABASE_URL>` (session-mode pooler),
  `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` pointing to PROD Supabase
  (`ocauafggjrqvopxjihas`). `.env` was not modified.
- All 22 smoke checks passed (5 unauth-expected + 2 health + 15 authed).
  Endpoints exercised: `/health`, `/health/db`, `/api/v1/me`,
  `/api/v1/me/permissions`, `/api/v1/references/*` (6), `/api/v1/tenders`,
  `/api/v1/tender-registry*` (3), `/api/v1/tender-statuses`,
  `/api/v1/construction-scopes`, `/api/v1/redistributions/save` (401 expected).
- Realtime listener attached to Yandex `LISTEN/NOTIFY` channel `rowchange` at
  startup.
- One transient finding: local Windows clock skew triggered
  `token used before issued` on first run; resolved with
  `JWT_CLOCK_SKEW_SECONDS=15` for the verification process only. Production
  leaves this strict (=0). Details in `18_GO_BFF_YANDEX_VERIFICATION.md`.

---

## Warnings / non-blockers

- **Pool-safe export**: both exports ran in `pool-safe` mode (one connection
  per table, no global REPEATABLE READ snapshot). Operator-confirmed
  no-writes window is the consistency guarantee. RUNBOOK §10.B forbids this
  mode for production cutover **without explicit freeze** — today's refresh
  satisfies that.
- **MCP preflight**: `MCP_PREFLIGHT_OK_WITH_WARNINGS` (25 risk items) — all
  reviewed via `.old-to-prod-export/schema_diff.md`; no blockers.
- **`tender_registry` duplicates**: `by_tender_number=10`, `by_title_client_area=0`
  — preserved identically across OLD/PROD/Yandex (pre-existing data shape, not
  a refresh artefact).
- **Local clock skew (Windows)**: see Go BFF status above. Configuration knob,
  not a code defect.

---

## Reports

| Report | Status token | Path |
|---|---|---|
| OLD→PROD VERIFY | `VERIFY_OK` | `docs/old-to-prod/VERIFY_RESULT.md` |
| OLD→PROD AUTH | `AUTH_VERIFY_OK` | `docs/old-to-prod/AUTH_VERIFY_RESULT.md` |
| PROD export | `DATA_EXPORT_OK` | `docs/yandex-migration/11_DATA_EXPORT_REPORT.md` |
| Yandex import | `DATA_IMPORT_OK` | `docs/yandex-migration/12_DATA_IMPORT_REPORT.md` |
| Yandex verify | `YANDEX_VERIFY_OK` | `docs/yandex-migration/13_YANDEX_VERIFY_RESULT.md` |
| Yandex auth | `YANDEX_AUTH_VERIFY_OK` | `docs/yandex-migration/14_YANDEX_AUTH_VERIFY_RESULT.md` |
| Go BFF vs Yandex | `GO_BFF_YANDEX_VERIFY_OK` | `docs/yandex-migration/18_GO_BFF_YANDEX_VERIFICATION.md` (re-verification 2026-05-20 section) |

---

## Final status

```
FINAL_DATA_REFRESH_OK
```

All six gating tokens green:

- `VERIFY_OK` (OLD → PROD)
- `AUTH_VERIFY_OK` (OLD → PROD)
- `DATA_IMPORT_OK` (PROD → Yandex)
- `YANDEX_VERIFY_OK` (PROD → Yandex)
- `YANDEX_AUTH_VERIFY_OK` (PROD → Yandex)
- `GO_BFF_YANDEX_VERIFY_OK` (Go BFF vs Yandex)

### Frontend deploy

Frontend deploy proceeded under separate authorisation on 2026-05-21.
Status: `FRONTEND_DEPLOY_OK` — see
[24_FRONTEND_DEPLOY_RESULT.md](./24_FRONTEND_DEPLOY_RESULT.md) for full
post-deploy record (nginx proxy, browser smoke, backend rebuild incident
fix-forward, runtime Yandex DSN summary).

### What was NOT touched in the data-refresh sandbox session

- Sandbox session itself did not modify `.env` files locally.
- App-auth — not introduced (separate plan: [22_APP_AUTH_MIGRATION_PLAN.md](./22_APP_AUTH_MIGRATION_PLAN.md)).
- Sandbox session did not perform git push at first write (push happened
  with explicit operator approval in subsequent step).
- No `import` / `clean` / `repair` outside of the documented refresh
  pipeline.

> **Production runtime state (updated):** Go BFF `DATABASE_URL` уже
> указывало на Yandex Managed PG до начала сегодняшнего refresh'а
> (cutover 2026-05-18, см. doc 23). Refresh обновил содержимое active
> runtime БД, а не активировал её впервые. Yandex — active runtime;
> предыдущий PROD Supabase DSN остаётся только как rollback reference.
