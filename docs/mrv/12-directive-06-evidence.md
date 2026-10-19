# 12 — Directive 06 / 06B: trusted execution, explicit intervals and units, Q1 2025 reconciliation

Evidence classes used below (never merged):
**W** = test written · **D** = executed through a development endpoint (same case modules, in the running dev server) ·
**R** = executed by the Vitest runner · **H** = hosted end-to-end (real Supabase Auth/PostgREST/Storage).
PGlite results are **D**, real PostgreSQL semantics with a stand-in auth/storage schema — **not** hosted verification.

## 1. Environment (06B §1) — DONE on the designated test project
- 2026-10-19: owner designated `vbxvhbnhstdfbkgjuzgs` as **development/test, no live customer data**, and authorised
  additive migrations and synthetic users/organizations. Pre-check: 0 users, tenants, readings, runs, batches, objects;
  0001/0002 present, 0003 absent.
- 0003 applied statement by statement (additive; two CHECK constraints widened atomically). Verified afterwards:
  `mrv_private` has no USAGE for anon/authenticated/service_role; retired RPCs not executable by anon/authenticated;
  `mrv_import_v2` / `mrv_finalize_run` / `mrv_withdraw_reading` executable by authenticated only.
- Executor key `exec-1` provisioned inside the database and copied into the git-ignored server environment
  (`MRV_EXECUTOR_KEY_ID` / `MRV_EXECUTOR_KEY`); `MRV_SUPABASE_ENVIRONMENT=test`. No service-role key used anywhere.
- Synthetic fixture: users `mrv-e2e-{a,b,c,r}@example.com`; "SYNTHETIC E2E Org A" (factories E1, E2, UI1; created via
  `mrv_create_organization` / `mrv_add_facility` as user A), "SYNTHETIC E2E Org B" (B1, as user B); C = facility_manager
  on E1 only; R = facility_manager on E1, revoked. All tenants `synthetic = true`.
- `db/supabase/tests/rls_persistence_check.sql` predates 0003 (calls retired RPCs) and must not be used as 0003 evidence.
- Not applied to any production project.

## 2. Trusted executor (06B §2)
Signature protocol `trace-mrv-exec/v2` (`lib/mrv/executorSign.ts` ⇄ `mrv_private.verify_executor`): HMAC-SHA256 over
operation · key id · actor (= `auth.uid()` of the calling JWT) · tenant · facility · issued_at · random nonce ·
SHA-256 of the complete body. Valid 120 s, ≤ 30 s future skew; nonce consumed once. Every RPC re-checks
`has_permission` at execution time; `mrv_finalize_run` independently verifies pinned readings, considered set,
configuration versions, input snapshot and synthetic labelling, and derives QA rows/overall from the results.
Idempotency: imports by batch id; runs by dependency + engine + input hash, evaluated **after** all integrity checks
(a defect where the shortcut ran first was found by the harness and fixed in this directive).

**Residual trust boundary:** the database does not recompute emissions; it trusts results signed with the server-only
executor key. Forged results without that key are rejected; anyone holding the key could sign arbitrary results.

| Requirement | PGlite (D) | Hosted (H) |
|---|---|---|
| Retired `mrv_record_run` / `mrv_record_import` denied | PASS | **PASS** |
| Direct PostgREST INSERT of a run / UPDATE of readings denied | PASS | **PASS** |
| Unsigned / forged-key / altered payload / fake QA PASS rejected; no run persisted | PASS | **PASS** |
| Expired, future-dated, replayed signature rejected | PASS | **PASS** (nonce-less: D only) |
| Cross-facility and cross-operation signature rejected | PASS | **PASS** |
| Other user / cross-tenant with a valid signature rejected | PASS | **PASS** |
| Revoked user rejected at execution time | PASS | **PASS** |
| Legitimate server calculation succeeds; import and run retries idempotent | PASS | **PASS** |
| Concurrent import invalidates an in-flight run (40001) | PASS | — (not run hosted) |

## 3. Unit handling (06B §3)
- `lib/mrv/unitMapping.ts` (`trace-source-units/v1`): importer declares `carbonate`/`moisture` = percent|fraction and
  `massBasis` = dry|wet (UI: *Raw-material units* in the import mapping), or rows carry `Carbonate Unit` / `Moisture Unit` /
  `Mass Basis`. Stamped on each raw-material reading with the mapping version; source values never changed; converted
  values in separate fields (`CaCO3 Fraction`, `MgCO3 Fraction`, `Dry Quantity t`). Row vs import contradiction = error.
- 0.5 declared or read as percent is 0.5 % (valid). A value outside its declared unit's range is flagged and not converted.
- Undeclared units: header (%) applies, quantity used as entered; if **every** CaCO3 value is ≤ 1 the semantics are
  contradictory → Method A not calculated. QA **CP-03** (only when Method A is selected): FAIL / WARNING / PASS.
- Engine factor set `STOICH-ROUNDED-MM/v1` (ratios of molar masses rounded to 2 dp — not "exact"). Not changed to match
  the workbook. Production methodology selection requires a documented technical basis.
- Engine version `trace-mrv-engine/2026.10-d06b.1`; stored runs keep their version and results.

## 4. Q1 2025 demo workbook (DEMO-labelled — not real plant data)
Test assumptions **pending owner confirmation**: Q1-A1 fuel rows are Q1 totals; Q1-A2 carbonate values are fractions;
Q1-A3 quantities are dry basis. Factor scenarios kept separate: `WORKBOOK-REPRO/Q1-DEMO/v1` (0.44 / 0.522) and
`STOICH-ROUNDED-MM/v1`.

| Metric | Workbook | Reference | Application | Status |
|---|---|---|---|---|
| Method B, fuel, biogenic, direct, grid, total, SEE, SHC, TSR, clinker factor, production | as in D06 | = | = | within relative 1e-9 (all 17 comparable rows) |
| Method A, units undeclared | 347,036.4 | not calculated | not calculated | not comparable (contradictory semantics) |
| Method A, units declared (Q1-A2/A3), engine factors | 347,036.4 | 346,808.867397 | 346,808.867397 | ref = app within 1e-9; **−227.53 t (−0.066 %) vs workbook**, explained by factor set, not resolved |
| Method A, workbook-reproduction factors | 347,036.4 | 347,036.4 | — | reproduces workbook formula only |
| Stock movement / inventory reconciliation | — | — | — | **unvalidated** — no inventory evidence (MB-04 NOT_EVALUATED) |
| Product allocation per cement type | — | — | — | **unvalidated** — no approved allocation methodology |

Method A is not the selected method in the workbook, so totals are unaffected. "No discrepancies" applies only to the
comparable rows above under the stated assumptions.

## 5. Signed-in application workflow (06B §4) — demonstrated (H, browser-driven, 2026-10-19)
Real browser (Playwright) against the dev server on the test project, user A, factory UI1 (empty beforehand):
1. Sign-in through `/signin` (Supabase Auth, cookie session) → `/overview`.
2. Factory UI1 selected; *Upload Readings File*; mapping "calendar quarter of date"; synthetic Q1 2025 test workbook
   (`/api/dev/synthetic-workbook`, 40,044 bytes) → HTTP 200, `accepted`, 4 readings inserted, original file stored
   privately (1 `source_file`, 1 storage object), server calculation finalized by the trusted executor.
3. Saved run `3f8bb4db…`: 2025-01-01 – 2025-03-31, 4 pinned inputs, QA PASS, synthetic, `executor_key_id = exec-1`,
   total embedded CO₂ 542,835 t (displayed), "recomputation matches".
4. Page reload → same run (same timestamp and total; "Existing calculation reused").
5. Draft report: *Get Report* → 4-page PDF, stamped "DRAFT — not approved" and SYNTHETIC. The draft report is a
   client-side export of the stored run; **no draft-report record is persisted** (no `report_snapshot` write path exists).
6. Application-server restart → fresh browser context (no cookies/storage) → sign-in → factory UI1 restored from
   `workspace_preference` → same stored run and total; database still holds exactly 1 run for UI1.

Not demonstrated in the browser (DB/API level only): duplicate and corrected re-import, invalid import, cross-tenant and
restricted factory in the UI, January/full-year range selection in the UI.

## 6. Test execution record (this environment)
| Suite | W | D | R | H |
|---|---|---|---|---|
| Pure cases + acceptance (`tests/mrv/cases.ts`, acceptance) | yes | **35/35** (`/api/dev/mrv-selftest`) | not run | — |
| PGlite DB harness (`tests/mrv/dbHarness.ts`) | yes | **47/47** (`/api/dev/mrv-db-selftest`) | not run | — |
| Isolation (`tests/isolation/cases.ts`) | yes | **18/18, 130 checks** (`/api/dev/isolation`) | not run | — |
| Synthetic reference register | yes | 0 discrepancies, 1 not comparable | not run | — |
| Q1 reconciliation (`tests/q1Reconciliation.test.ts`) | yes | module output checked via `/api/dev/q1-inspect` | **not run** | — |
| Hosted cases (`tests/hosted/cases.ts`) | yes | — | not run | **43/43** via `/api/dev/hosted-e2e` (21.6 s) |
| Browser workflow (§5) | — | — | — | **PASS** (steps 1–6) |
| TypeScript | — | — | `tsc` clean | — |
| Production build (`next build`) | — | — | passed (before hosted files) | — |

Hosted 43/43 covers: Auth (4 real logins, wrong password, anonymous refused), signed import + idempotent retry,
Q1/January/custom runs, full-year and partial-January ranges not silently calculated, run idempotency, retired RPCs and
direct writes denied, 9 tampering/replay/cross-scope rejections with zero runs created, cross-tenant read/import denial,
restricted factory read/import/calculate, revoked user, and private Storage (owner/restricted download, cross-tenant
and cross-factory denied, no public URL).

The Vitest runner could not be invoked from this environment. Locally:
`npm test` (offline suites) and
`node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/hosted/stagingE2E.test.ts` (hosted).
