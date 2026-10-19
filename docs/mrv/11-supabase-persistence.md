# 11 — Supabase persistence (Directives 04/05 vertical slice)

Status: **implemented for one-factory vertical slice; not production-ready.** Supabase project `vbxvhbnhstdfbkgjuzgs`
(development). When it was inspected it had no tables, auth users or storage objects. Migrations were applied in
additive SQL batches; nothing was dropped or reset.

## Architecture
- **Identity:** Supabase Auth (email/password, cookie sessions via `@supabase/ssr`). `/signin`, `/auth/callback`, `/reset-password`, `/onboarding`.
- **API:** `/api/mrv/*` → `lib/server/mrv/router.ts` → `service.ts`. Every request calls `auth.getUser()` (live check against
  Supabase Auth) and uses a **user-scoped** Supabase client: reads are filtered by RLS and writes go through `SECURITY DEFINER`
  RPCs that check permissions again. **No service-role key is used.**
- **Authorization:** `mrv_auth.has_permission(tenant, facility, permission)` = active membership + unrevoked role assignment +
  `role_permission` (mirror of `lib/tenancy/permissions.ts`). It is evaluated live in every policy and RPC, so revocation takes effect immediately.
- **Calculation:** server-side only, always `calculateStore` (`lib/calcEngine.ts`) on readings loaded from the database.
- **Legacy PGlite harness** (`/api/v1`, synthetic users): disabled unless `TRACE_SYNTHETIC_BACKEND=1` outside production. No fallback.

## Data model (`db/supabase/0001_mrv_persistence.sql`, `0002_mrv_rpc_storage.sql`)
| Table | Purpose | Mutability |
|---|---|---|
| `tenant`, `tenant_membership`, `facility`, `role_assignment`, `role_permission` | tenancy & roles | admin-managed |
| `data_source`, `import_batch`, `source_file` | each import attempt (accepted/rejected/duplicate), SHA-256, private file path | append-only |
| `config_document` | versioned setup, constants/EFs, fuel defaults, registers (one version per import) | append-only |
| `activity_reading` | historical readings with interval, provenance, revision chain | insert-only; only `is_current` may flip true→false |
| `calculation_run` (+ `_input`, `_config`, `run_qa_result`) | immutable snapshot: frozen input, pinned reading/config ids, results, fingerprint, engine/methodology version, coverage | append-only |
| `run_invalidation` | staleness record (run never rewritten) | append-only |
| `report_snapshot` | report lock (approved snapshot immutable) | locked after approval |
| `workspace_preference` | last organization/factory/range per user | per user |
| `audit_event` | imports, runs, onboarding | append-only |

Every tenant-owned table has `tenant_id` + `facility_id`, composite foreign keys to its parents, and RLS. `authenticated`
has `SELECT` only; `anon` has nothing. Storage bucket `mrv-private` is private; object paths are
`<tenant>/<facility>/imports/<batch>/<file>` with insert/select policies using the same permission function (no update/delete).

## Import and history rules
- Every activity row needs an ISO `Date`; rows without one reject the whole import (never guessed).
- A row dated on the last day of a month is a **monthly summary** covering that month; any other date is a **daily** record.
- `record_key = section | identity fields | date | occurrence`. The same file again → `duplicate` batch (no rows). The same records
  again with identical values → `unchanged`. Changed values → **new revision**; the old revision is kept and still pinned by older runs.
- Rejected imports are recorded (with errors) and never replace the displayed dataset.
- Synthetic demo data can only be stored in organizations created as synthetic; all their readings and runs carry `synthetic`.
- Rows removed in the online form are **not** deleted from history (no deletion semantics yet).

## Range calculations
- Ranges come from `lib/mrv/dateRanges.ts` (calendar month/quarter/half/year, fiscal year, MTD/QTD/YTD, rolling windows,
  custom), resolved in the **factory timezone** with exact inclusive dates displayed.
- Inclusion (`lib/mrv/rangeSelection.ts`): only readings whose interval lies fully inside the range. Monthly totals crossing a
  boundary are excluded and reported (never prorated). Daily records are excluded when a monthly total of the same series covers that month.
- Coverage lists months without data per required section; missing is never zero and a partial or future-extending range is never "complete".
- Re-opening a range with unchanged inputs reuses the existing run (same input SHA-256 + engine version).
- Loading a run re-runs the engine on the frozen input and compares the result fingerprint (`recomputation matches` — this is
  not external verification). A new import that touches a run's range, or any config change, records a `run_invalidation`;
  runs referenced by approved report snapshots are not invalidated.

## Verification evidence (actually executed)
- **Real Supabase database:** `db/supabase/tests/rls_persistence_check.sql` — 24/24 PASS (2026-10-19). Synthetic users act as
  `authenticated`/`anon` with JWT claims inside one transaction that is always rolled back (verified afterwards: 0 users,
  tenants, readings, runs). It covers dedupe, revisions, stale runs, pinning, direct-write denial, cross-tenant read/write denial, mismatched
  tenant/facility IDs, demo-data guard, preference guard, storage policy predicate, immediate revocation, anon denial and immutability.
- **Pure logic in the dev server runtime:** `GET /api/dev/mrv-selftest` — 13/13 PASS (same cases as `tests/mrv.test.ts`).
- **Not yet executed:** `npm test` (no test runner is available in this environment); a signed-in browser end-to-end run
  (sign-up → onboarding → import Q1 → restart → reopen) through PostgREST/Storage; real-Q1-workbook validation.

## Known limitations
- Portfolio consolidation and member/role administration UI are not migrated (pages show notices). Roles beyond the creator's
  own (tenant admin + facility manager + MRV analyst) must be granted by an operator via SQL.
- Formal reporting periods, review/approval workflow on `report_snapshot`, evidence uploads, and AI features are not wired to Supabase yet.
- Row deletion, prorating policy and estimation are intentionally absent.
- The publishable key and URL default to the development project; production needs its own project/config and a reviewed migration.
