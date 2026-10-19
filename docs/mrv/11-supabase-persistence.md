# 11 — Supabase persistence (Directives 04–06)

Status: **vertical slice; not production-ready; not accepted.** Directive 06 changes are summarised in
[`12-directive-06-evidence.md`](12-directive-06-evidence.md), which supersedes the import/range/run rules below where they differ.

**Environment.** Supabase project `vbxvhbnhstdfbkgjuzgs` is classified by its owner as **"production or unsure"**
(Directive 06). The Directive 05 conclusion that it was a development project (inferred from it being empty) is withdrawn.
Migrations 0001/0002 were applied to it during Directive 05. **0003 is NOT applied** and no further remote schema
change, test user or test data may be created there until the owner explicitly classifies it. The app has **no built-in
project fallback**: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be configured or requests fail with 503.

## Architecture
- **Identity:** Supabase Auth (cookie sessions via `@supabase/ssr`). `/signin`, `/auth/callback`, `/reset-password`, `/onboarding`.
- **API:** `/api/mrv/*` → `lib/server/mrv/router.ts` → `service.ts` with a **user-scoped** client (RLS applies). No service-role key.
- **Trusted executor (0003):** the server parses/validates sources and runs `calculateStore`, then signs the exact RPC body with an
  HMAC key held only in the server environment (`MRV_EXECUTOR_KEY_ID`/`MRV_EXECUTOR_KEY`) and in `mrv_private.executor_key`.
  `mrv_import_v2`, `mrv_finalize_run`, `mrv_withdraw_reading` verify that signature (bound to purpose, user, tenant, facility,
  ±5 min, single use), re-check permissions, and independently verify inputs. Directive 05's `mrv_record_run`/`mrv_record_import`
  are retired (raise + EXECUTE revoked). Without the key, imports/calculations return 503; stored runs remain readable.
- **Authorization:** `mrv_auth.has_permission(tenant, facility, permission)`, evaluated live in every policy and RPC.
- **Legacy PGlite harness** (`/api/v1`): only with `TRACE_SYNTHETIC_BACKEND=1` outside production.

## Data model (`db/supabase/0001`, `0002`, `0003`)
| Table | Purpose | Mutability |
|---|---|---|
| `tenant`, `tenant_membership`, `facility`, `role_assignment`, `role_permission` | tenancy & roles | admin-managed |
| `data_source`, `import_batch` (+ `mapping`), `source_file` | import attempts, SHA-256, explicit mapping, private file path | append-only |
| `config_document` (+ `effective_from/to/basis`) | effective-dated setup, constants/EFs, fuel defaults, registers | append-only |
| `activity_reading` (+ `measurement_type`, `interval_basis`, `mapping_version`, `source_identity`, `legacy_key`) | readings with explicit interval and revision chain; `quality_state` accepted/rejected/withdrawn | insert-only; only `is_current` flips |
| `calculation_run` (+ `results_sha256`, `dependency_sha256`, `selection_policy`, `executor_key_id`) and `_input`, `_config`, `run_qa_result` | immutable snapshot | append-only |
| `run_invalidation` | staleness record | append-only |
| `report_snapshot` / `report_impact` (0003) | approved snapshot locked; later corrections recorded as impacts | locked / append-only |
| `mrv_private.executor_key`, `executor_nonce` | executor key and used signatures (no Data API exposure) | — |

## Rules (current)
- Intervals come from row columns (`Interval Start`, `Interval End`, `Measurement Type`) or an explicit import mapping
  (`lib/mrv/importMapping.ts`), declared for the whole file or per sheet (e.g. monthly production + quarter-total fuel).
  Ambiguous rows are rejected. See doc 12 for selection, reconciliation, coverage, config and run rules.
- Re-imports: same file → `duplicate`; same record with identical values → `unchanged`; changed values → new revision.
- Rejected imports are recorded and never replace the displayed dataset. Synthetic data only in synthetic organizations.

## Verification evidence
See doc 12. The Directive 05 rolled-back remote check (`db/supabase/tests/rls_persistence_check.sql`, 24/24 on 2026-10-19) exercised
the now-retired RPCs; it has not been re-run against 0003 because 0003 is not applied remotely.
