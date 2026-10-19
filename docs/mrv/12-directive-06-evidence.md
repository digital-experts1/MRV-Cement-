# 12 — Directive 06 / 06B: trusted execution, explicit intervals and units, Q1 2025 reconciliation

Evidence classes used below (never merged):
**W** = test written · **D** = executed through a development endpoint (same case modules, in the running dev server) ·
**R** = executed by the Vitest runner · **H** = hosted end-to-end (real Supabase Auth/PostgREST/Storage).
PGlite results are **D**, real PostgreSQL semantics with a stand-in auth/storage schema — **not** hosted verification.

## 1. Environment (06B §1) — BLOCKED
- The configured Supabase project is classified **"production or unsure"** (unchanged). No other project is configured,
  and no staging designation exists in configuration. **Required from the owner:** the project ref of a confirmed
  non-production staging project, explicitly authorised for migrations and synthetic test logins.
- Migration `db/supabase/0003_mrv_trusted_execution.sql` is **local only, not applied anywhere hosted**. No remote schema
  change, secret, user or data was created. Production behaviour and data are unchanged.
- Once authorised: inspect schema/migration history → apply 0001–0003 in order (additive) → copy the provisioned key
  (`select key_id, encode(secret,'hex') from mrv_private.executor_key where active`) into the server environment as
  `MRV_EXECUTOR_KEY_ID` / `MRV_EXECUTOR_KEY` (never printed or committed) → run `tests/hosted/stagingE2E.test.ts`.
- `db/supabase/tests/rls_persistence_check.sql` predates 0003 (calls retired RPCs) and must not be used as 0003 evidence.

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
| Retired `mrv_record_run` / `mrv_record_import` denied | PASS | W, not run |
| Unsigned / forged-key / altered payload / fake QA PASS rejected; no run persisted | PASS | W, not run |
| Expired, future-dated, nonce-less, replayed signature rejected | PASS | W (expired, replay) |
| Cross-facility and cross-operation signature rejected | PASS | W (cross-facility) |
| Other user / cross-tenant with a valid signature rejected | PASS | W |
| Revoked user rejected at execution time | PASS | W (needs operator-revoked login) |
| Legitimate server calculation succeeds; import and run retries idempotent | PASS | W |
| Concurrent import invalidates an in-flight run (40001) | PASS | — |

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

## 5. Signed-in application workflow (06B §4) — BLOCKED
Login → factory → upload → mapping → readings → server calculation → QA → saved run → draft report, plus reload/restart,
duplicate and corrected imports, invalid import, factory switching, cross-tenant/restricted factory, private download,
and January/Q1/full-year/custom ranges, have **not** been demonstrated on hosted infrastructure (no staging project).
Covered locally only at DB/logic level (D): duplicate/correction/invalid import, cross-tenant/factory, storage paths,
January/Q1/custom ranges, quarter fuel not attributed to March, incomplete coverage visible.

## 6. Test execution record (this environment)
| Suite | W | D | R | H |
|---|---|---|---|---|
| Pure cases + acceptance (`tests/mrv/cases.ts`, acceptance) | yes | **35/35** (`/api/dev/mrv-selftest`) | not run | — |
| PGlite DB harness (`tests/mrv/dbHarness.ts`) | yes | **47/47** (`/api/dev/mrv-db-selftest`) | not run | — |
| Isolation (`tests/isolation/cases.ts`) | yes | **18/18, 130 checks** (`/api/dev/isolation`) | not run | — |
| Synthetic reference register | yes | 0 discrepancies, 1 not comparable | not run | — |
| Q1 reconciliation (`tests/q1Reconciliation.test.ts`) | yes | module output checked via `/api/dev/q1-inspect` | **not run** | — |
| Hosted staging (`tests/hosted/stagingE2E.test.ts`) | yes | — | skipped (guards) | **not run** |
| TypeScript | — | — | `tsc` clean | — |
| Production build (`next build`) | — | — | passed | — |

The Vitest runner (`npm test`) could not be invoked from this environment; R must be produced by running `npm test`.
