# 09 — Directive 02 Foundation Repairs: Execution Evidence & Handoff

Baseline reviewed: `3ac13384` (working tree clean; newer local change since `4b752cf` = `next-env.d.ts` only).
All fixtures are **synthetic**. No real Q1 2025 data was available; **no Q1 validation and no production-readiness
claim** is made. Nothing was deployed.

## Repository hygiene (Directive item 4)

| Finding | Evidence | Action |
|---|---|---|
| `.env.local` **was tracked** — added in commit `4b752cf` (Sprint 1 commit). The Sprint 1 statement "untracked" was wrong. | `git log -- .env.local` → `4b752cf`; file size 0 bytes in working tree and at `4b752cf` (inspected without printing values) | Removed from the tree (untracked going forward). `.gitignore` now ignores `.env` / `.env.*` except `.env.example`. Placeholder-only `.env.example` added. |
| Credentials committed? | Committed file was empty | **No rotation required.** History not rewritten (not authorized; nothing sensitive). |
| Deployment / database configuration | No `vercel.json`, no DB client/ORM, no migrations; `.vercel/` git-ignored; `next.config.ts` has no deployment settings | No provider selected or provisioned; deployed state unknown — must be inspected before Sprint 2 selection. |

## Repairs delivered (Directive item 3)

| Item | Implementation |
|---|---|
| A numeric parsing | Parser reads **raw** cell values (`raw: true`); `lib/numeric.ts` strict parser accepts numbers, plain decimals and US-grouped text; rejects ambiguous text (`520.000`, `32,5`, `1.234,5`, `520 t`, `#N/A`) as input issues (value `null`, raw kept). |
| B fabricated defaults | Blank template has no PASS, no "Mapped", no 0 totals, no pre-selected method; data-entry blank form has no prefilled plant numbers. |
| C hardcoded PASS | PR-01 checks every activity date against the Setup period (FAIL / NOT_EVALUATED). MB-04 requires inventory movements (opening, purchases, dispatches, closing) → otherwise NOT_EVALUATED. All range checks return NOT_EVALUATED on missing inputs. |
| D one calculation path | `calculateStore` used by workbook, manual, demo and data package. Workbook 08/09/10/13 values stored as `assertions` (MATCH/MISMATCH/NOT_COMPARABLE) and shown on the Calculations page. |
| E failed import | `resolveImport` never replaces/clears the active dataset (also covers presentation exports and bad JSON). |
| F stale drafts | Drafts (`V2`) record facility, period and base dataset revision; mismatch or legacy V1 → explicit Restore/Discard banner; never auto-applied. |
| G synthetic labelling | Demo uses "SYNTHETIC DEMO PLANT (fictitious)"; persistent banner; PDF banner on every page; xlsx banner on every sheet; JSON `synthetic: true`; `SYNTHETIC_DEMO_` filenames; never "ready". |
| H wording | Removed "verified", "certified", "100 % compliant", "ISO 14064 Compliance Assurance", "EU ETS / CBAM Aligned"; PDF retitled "Internal QA/QC Working Report" with a limitations statement. |
| I export/import | Re-importable JSON data package (doc 08) vs presentation exports (rejected on import with a clear message). |
| J provenance | Every imported row keeps `_source` {origin, file, sheet, row, raw}; manual edits keep `previous`. |

## Tests executed (actual results)

| # | Run | Result |
|---|---|---|
| 1 | `run_type_checks` (whole project) | **No type errors** |
| 2 | `run_build` (production, Next.js 16.3.5) | **Passed** (21 static routes) |
| 3 | Acceptance cases (`tests/acceptance/cases.ts`) executed in Chromium 155 via the dev-only harness `/dev/acceptance`, browser timezone Asia/Dubai (UTC+4) | First run **12/13** (AT-A12 failed: QA check name "Input period aligned" matched the forbidden-claim scan) → renamed to "Input dates within reporting period" → second run **13/13 passed** |
| 4 | Browser smoke: Data Entry blank form → "Load Synthetic Demo" → Submit | Blank: "Required data 3 of 24 items (12 %) · QA FAIL". Demo applied: synthetic banner shown; "Not ready · 100 % complete · QA pass 100 % · Not externally verified — Synthetic demo data". Only console error: preview-harness CSP `frame-ancestors` message (not app code). |
| 5 | `npm test` (Vitest CLI) | **Not executed** — no shell/test-runner tool in this environment. `tests/acceptance.test.ts` wraps the identical case functions; must be run in CI/locally. |

### Case list (identical in Vitest and browser harness)

| ID | Directive test | Result (run 2) |
|---|---|---|
| AT-A01 | Formatted 520,000 stays 520000; ambiguous text rejected | PASS |
| AT-A02 | Blank template cannot produce readiness; no fabricated PASS/Mapped | PASS |
| AT-A03 | Imported PASS cannot override computed failure | PASS |
| AT-A04 | 42 × 32.5 = 1365 GJ = 1.365 TJ (exact decimal) | PASS |
| AT-A05 | Missing required data ≠ zero / PASS; no silent method default | PASS |
| AT-A06 | Out-of-period records detected (ISO text and Excel serial dates) | PASS |
| AT-A07 | Stock reconciliation without inventory → NOT_EVALUATED | PASS |
| AT-A08 | Manual vs imported equivalent inputs → identical results | PASS |
| AT-A09 | Failed import preserves previous dataset | PASS |
| AT-A10 | Data export re-import preserves inputs + provenance | PASS |
| AT-A11 | Demo data and every demo export marked synthetic | PASS |
| AT-A12 | Mapped evidence never described as externally verified | PASS |
| AT-A13 | Stale drafts resolved explicitly (facility/period/revision) | PASS |

## Remaining failures / limitations (honest record)

- Vitest CLI not executed here (see row 5). The `vitest` 5.x devDependency was installed but never run.
- Everything still runs client-side; no persistence, authentication, tenancy, roles or server authorization (Sprint 2).
- Draft and dataset live only in the browser; reload loses the active dataset (unchanged behaviour).
- Inventory reconciliation covers clinker only; product allocation not implemented.
- Out-of-period rows are flagged (FAIL, blocks readiness) but still included in totals.
- Percent-formatted Excel cells (e.g. CaCO3 stored as 0.785 displayed as 78.5 %) cannot be distinguished from a typed 0.785 — unit/scale validation is still open (G-12).
- QA bounds are still hard-coded in `lib/qaChecks.ts` (rule registry is Sprint 6). Completeness rules hard-coded (planned `ref.completeness_rule`).
- `/dev/acceptance` returns 404 in production but its client bundle is still compiled; remove or move behind a build flag in Sprint 2.
- Real Q1 2025 data, the F01–F09/AT-01–AT-10 audit document and reporting-basis decisions remain outstanding (D-02…D-04) and block real-data acceptance.
- Existing visualisation pages (analytics, per-input pages) were only smoke-checked, not regression-tested.

## Exact next implementation package (proposed: "Sprint 2a — Server foundation")

1. Run `npm test` in CI (GitHub Actions or provider CI) on every push; fail on any acceptance case.
2. Inspect the actual deployment target(s) and any existing database with the owner; record findings; then select the
   PostgreSQL + private object-storage provider (no paid provisioning without approval).
3. Add migrations (additive only) for `ref.unit`, `tenant`, `facility`, `app_user`, `role_assignment` (scope CHECK),
   `reporting_period`, `source_file`, `import_batch`, `raw_source_record`, `activity_record` (+ version),
   `inventory_movement`, with composite tenant FKs and RLS policies; integration tests proving cross-tenant denial.
4. Authentication skeleton + server-side authorization guard (tenant/facility scope) on route handlers.
5. Move `calculateStore` invocation to a server route handler (`POST /api/periods/:id/calculate`) creating a
   `calculation_job` and an immutable `calculation_snapshot` with copied inputs; UI reads snapshots.
6. Server-side workbook/data-package import endpoint storing the original file (SHA-256) and raw cells.
7. Exit gate: all AT-A01…AT-A13 green in CI + new tenancy/authorization integration tests; no deployment.
