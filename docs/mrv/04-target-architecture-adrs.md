# 04 — Target Architecture, Module Boundaries and ADRs (Sprint 1 proposal)

Starting hypothesis: **modular monolith inside the existing Next.js repository.** No rewrite, no separate services.

## Module boundaries (proposed folders)

| # | Module | Proposed location | Built in sprint |
|---|---|---|---|
| 1 | Identity, tenancy, facilities, authorization | `server/identity/` | S2 (tenancy), S7 (roles) |
| 2 | Reporting basis & period lifecycle | `server/periods/` | S2, S7 |
| 3 | Source registry & ingestion | `server/ingestion/` (+ existing `lib/parser.ts` refactored) | S3 |
| 4 | Canonical activity data & units | `domain/units/`, `server/activity/` | S2 |
| 5 | Methodologies & factor registry | `domain/methodology/`, `server/factors/` | S4–S5 |
| 6 | Calculation engine & runs | `domain/calc/` (pure), `server/calc-runs/` | S5 |
| 7 | Material reconciliation & allocation | `domain/reconciliation/` | S5 |
| 8 | Validation, QA/QC, issues | `domain/qaqc/`, `server/issues/` | S6 |
| 9 | Evidence & lineage | `server/evidence/` | S7 |
| 10 | Review, approval, locking, revisions | `server/approvals/` | S7 |
| 11 | Reporting & exports | `server/reports/` (+ `lib/export.ts` refactored) | S8 |
| 12 | Operations & admin | `server/ops/` | S10 |

`domain/` = pure TypeScript, no I/O, unit-tested. `server/` = persistence + authorization, only callable from
route handlers / server actions. UI (`app/`, `components/`) reads results; it owns no authoritative logic.

## Preserve / refactor / replace

| Component | Decision | Reason |
|---|---|---|
| Next.js / React / TS stack, App Router pages, layout, CSS design system, icons, charts | **Preserve** | Working, no defect evidence |
| Upload dialog, sidebar, navigation | **Preserve** | Recently fixed; becomes front-end for server import |
| `lib/parser.ts` | **Refactor** | Keep schema knowledge; switch to raw values (G-02), stop trusting 08/09/10/13 (G-01), add row-level errors, move to server |
| `lib/calcEngine.ts` | **Refactor** into `domain/calc` | Keep formulas as starting point; remove defaults/rounding/hardcoded PASS; version formulas |
| QA/QC list inside `calculateStore` | **Replace** with rule registry | Hardcoded statuses (G-04) |
| `lib/export.ts` blank template | **Refactor** | Remove fabricated PASS/Mapped/0 values (G-03) |
| `lib/export.ts` PDF | **Refactor** | Render from frozen run snapshot; remove unsupported claims |
| `StoreContext` as data owner | **Replace** (keep as UI cache) | Data must persist server-side |
| Data Entry Studio | **Refactor** | Submit to same server import/validation path; remove duplicate formulas |
| Page-level re-aggregation | **Replace** with run results | One source of truth |
| `createSampleDataset` | **Refactor** | Keep as clearly labelled synthetic fixture with fictitious plant name |

## Architecture Decision Records (proposed — status: Proposed, awaiting review)

**ADR-001 Modular monolith in existing repo.** Add `domain/` and `server/` layers to the Next.js app. Rejected:
microservices (no demonstrated need), rewrite (violates preserve rule).

**ADR-002 Server tier and persistence (needs D-01).** Next.js route handlers/server actions + PostgreSQL
(managed, e.g. Neon or Supabase) + object storage for source files and evidence. Requires updating `AI_RULES.md`.
Rejected: browser `localStorage`/IndexedDB (no server-side control, no multi-user, no isolation).

**ADR-003 Authoritative calculation is server-side and pure.** One `domain/calc` implementation invoked by the
server to produce immutable calculation runs. Browser may show *previews* labelled non-authoritative.

**ADR-004 Uploaded workbook formula outputs are never authoritative.** Sheets 08/09/10/13 are imported as
*comparison data* only and flagged when they disagree with the engine.

**ADR-005 Numeric policy.** Decimal arithmetic (e.g. decimal.js) for authoritative calculations; no intermediate
rounding; rounding only at presentation with documented precision per quantity; explicit missing / zero / not
applicable / below detection-limit states. (Needs D-05.)

**ADR-006 Explicit units and dimensions.** Every quantity stored as original value+unit and normalized value+unit
with a declared conversion path; percent vs fraction is a unit, not an assumption.

**ADR-007 Immutable snapshots.** Calculation runs reference immutable input snapshot, methodology version and
factor versions; approvals and reports reference a run ID; revisions create new versions.

**ADR-008 Rule-registry QA/QC.** Versioned rules with applicability, severity and statuses
(pass/fail/not evaluated/not applicable). Missing input ⇒ not evaluated ⇒ never PASS. Approval blocked server-side
by unresolved blocking issues.


---

## Directive 02 — Resolved architecture decisions (status: **Accepted** by supervisor directive)

| ID | Decision | Status / evidence |
|---|---|---|
| AD-01 | Keep the existing Next.js app as a **modular monolith**. No rewrite, no microservices. | Accepted. Existing UI conventions and upload behaviour preserved. |
| AD-02 | **Server-side authoritative calculation and authorization** (route handlers / server actions). | Accepted, **not yet implemented**. Interim: the single pure engine (`lib/calcEngine.ts`, `lib/qaChecks.ts`, `lib/completeness.ts`) has no browser dependencies so it can move server-side unchanged in Sprint 2. |
| AD-03 | **PostgreSQL** persistence + **private** object storage for source files and evidence. | Accepted, provider **not selected**. Repository inspection (Directive 02): no database code, no ORM, no `vercel.json`, `.vercel/` git-ignored, `.env.local` was empty. Deployed state is unknown and must be inspected before selection; no paid service provisioned, nothing reset. |
| AD-04 | **Vitest** + **decimal.js**; meaningful regression tests. | Implemented. `npm test`; engine arithmetic uses `Decimal` end-to-end; values are converted to JS numbers only for display/output. |
| AD-05 | One validated calculation path for workbook import, manual entry, demo and data-package re-import. Workbook 08/09/10/13 values are **comparison assertions only**. | Implemented (`calculateStore`, `lib/assertions.ts`). |
| AD-06 | Missing ≠ zero. Missing required inputs yield `null` results and `NOT_EVALUATED`/`FAIL`, never PASS. No silent defaults (grid EF, oxidation, conversion, clinker EF, calcination method). | Implemented. |
| AD-07 | Required-data completeness is computed and displayed separately from QA pass %. Readiness = complete ∧ no rejected inputs ∧ no FAIL ∧ no NOT_EVALUATED ∧ not synthetic. "Ready for internal review" is the strongest status the app can show. | Implemented (`lib/completeness.ts`). |
| AD-08 | Two export families: **data package** (`.json`, re-importable, inputs + provenance, no calculated values) vs **presentation reports** (PDF/xlsx, marked not re-importable and rejected by the importer). | Implemented, see [08-data-export-format.md](08-data-export-format.md). |
| AD-09 | Synthetic demo data uses a fictitious facility name and is labelled on every screen and every export; synthetic datasets are never "ready". | Implemented. |
| AD-10 | "Verified" can only be shown when a `verification_statement` event exists (see 05 §8). Until then all surfaces state "not externally verified". | Wording implemented; event model designed, not implemented. |
| AD-11 | AI features are advisory: they may explain lineage, assess reports with citations and request deterministic scenario runs; they may not compute authoritative totals, invent savings, approve reports or modify source data. | Work packages reserved in [06](06-backlog-risks-tests.md). |
