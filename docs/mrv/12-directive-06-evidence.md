# 12 — Directive 06: trusted execution, explicit intervals, Q1 2025 reconciliation

Status legend: **Implemented** (code exists) · **Tested** (automated test executed and passed) · **Not verified** (no hosted evidence).

## 1. Environment and blockers
- The connected Supabase project is classified **"production or unsure"**. Migration `db/supabase/0003_mrv_trusted_execution.sql`
  is **local only, not applied**. No remote schema change, test user or test data was created in Directive 06.
- Without 0003 the hosted app reports a clear "migration not applied / executor not configured" error for calculation and import
  writes. A signed-in, hosted Supabase workflow (Auth → import → run → report) has **not** been demonstrated.
- To finish: provide a confirmed non-production project, apply 0003, set the executor key server-side, re-run
  `db/supabase/tests/rls_persistence_check.sql` (updated for 0003) and the signed-in workflow.

## 2. Interval rules (Implemented, Tested)
| Rule | Where | Test |
|---|---|---|
| Interval from row columns, or an explicit mapping; never from "last day of month" | `lib/mrv/importMapping.ts` | HS-01, HS-02 |
| Mapping declared for the whole file **or per sheet**; undeclared sheets are rejected | `parseMapping`, `MappingSelect` | HS-05 |
| `calendar_quarter_of_date` for quarter-total rows dated inside the quarter | `impliedByMapping` | HS-05 |
| A quarter total is never attributed to one month (excluded from a March-only range) | `selectForRange` | HS-05, RS-01 |
| Same-series overlaps in one import are errors; non-nesting stored overlaps are conflicts | `readings.ts`, `rangeSelection.ts` | HS-03, RS-03 |
| Finer vs coarser totals are reconciled; disagreement blocks completeness | `rangeSelection.ts` | RS-02 |
| Day-level, per-meter coverage | `computeCoverage` | RS-04 |
| Carbonate content in (0, 1] under a "%" header is rejected as ambiguous (not rescaled) | `calcRawMaterialRow` | EN-01 |

Engine version bumped to `trace-mrv-engine/2026.10-d06.1` (stored runs keep their own version and results).

## 3. Q1 2025 materials — what they are
| File | Nature | Use |
|---|---|---|
| `TRACE_FORCE_MRV_Cement_QAQC_V28_Collection_Workbook_v0_2.xlsx` | Workbook mode **`Cement_QAQC_V28_Demo`**, site "Demo Cement Plant - Egypt", factors marked "Demo" | Reconciliation input |
| `TRACE_FORCE_MRV_Internal_Report_Q1_2025_2026-10-19.pdf` | Report generated **by this application** | Cross-check of application output only — not an independent audit |
| `TRACE_FORCE_Universal_Cement_MRV_Standard_v1_0.xlsx` | Methodology/data-standard template (no plant values used) | Reference |

**Consequence:** the Q1 run below is a reconciliation against a demo workbook. It is **not** a validation against real plant
records, and no claim of real-Q1 accuracy, verification or compliance is made.

## 4. Declared mapping for this workbook
`default=calendar_month_of_date;kilnFuel=calendar_quarter_of_date` — taken from the workbook's own documentation:
03/04/06 rows are "Demo monthly row"s (Jan/Feb/Mar); all 05 fuel rows are dated 2025-03-31 but carry quarter evidence IDs
(`EV-FUEL-*-Q1`) and represent Q1 totals. With a single monthly mapping the fuel would have been attributed to March only.
**Owner confirmation required** that the fuel rows are Q1 totals.

## 5. Discrepancy register (Tested: `tests/q1Reconciliation.test.ts`, dev `GET /api/dev/q1-inspect`)
Reference = `tests/reference/reference.ts` on rows read directly with SheetJS (no parser/engine import). Application = real import path
(parse → readings with the mapping above → range selection → rebuild → `calculateStore`). Tolerance: relative 1e-9.

| Metric | Workbook (cached) | Reference | Application | Status |
|---|---|---|---|---|
| Clinker produced (t) | 520,000 | 520,000 | 520,000 | within tolerance |
| Cement produced (t) | 680,000 | 680,000 | 680,000 | within tolerance |
| Clinker factor | 0.765 | 0.765 | 0.765 | within tolerance |
| Process CO2 Method B (selected) | 276,900 | 276,900 | 276,900 | within tolerance |
| Fuel combustion CO2 | 187,378.05592 | 187,378.05592 | 187,378.05592 | within tolerance |
| Biogenic CO2 memo | 8,278.32068 | 8,278.32068 | 8,278.32068 | within tolerance |
| Direct embedded CO2 | 464,278.05592 | 464,278.05592 | 464,278.05592 | within tolerance |
| Grid electricity (MWh) | 95,000 | 95,000 | 95,000 | within tolerance |
| Indirect grid CO2 | 46,341 | 46,341 | 46,341 | within tolerance |
| Total embedded CO2 | 510,619.05592 | 510,619.05592 | 510,619.05592 | within tolerance |
| SEE clinker (tCO2/t) | 0.892842415 | 0.892842415 | 0.892842415 | within tolerance |
| SEE cement (tCO2/t) | 0.750910376 | 0.750910376 | 0.750910376 | within tolerance |
| Total fuel energy (GJ) | 2,074,380 | 2,074,380 | 2,074,380 | within tolerance |
| Specific heat (GJ/t clinker) | 3.989192308 | 3.989192308 | 3.989192308 | within tolerance |
| TSR (%) | 11.81 (hard-typed, rounded) | 11.80979377 | 11.80979377 | within tolerance (workbook value is rounded) |
| Clinker stockpile delta (t) | −200 | −200 | −200 | within tolerance |
| Process CO2 Method A | 347,036.4 | not calculated | not calculated | **not comparable** — see D-1 |
| Stock movement closing difference | — | — | — | **not comparable** — no inventory evidence (MB-04 NOT_EVALUATED) |
| Product allocation per cement type | — | — | — | **not comparable** — single product; no approved allocation method |

The application PDF matches the application column.

## 6. Open findings
- **D-1 Carbonate units (open, owner decision).** 04 headers say `CaCO3 %`/`MgCO3 %`, values are fractions (0.95, 0.02), and the
  workbook formula treats them as fractions with factors 0.44/0.522 → 347,036.4 t. With stoichiometric ratios (44.01/100.09,
  44.01/84.31) the same fractions give 346,808.867 t (−0.066 %). The application now rejects such rows as ambiguous (six input
  issues) instead of silently dividing by 100 (which would have understated Method A 100×). Method A is not selected, so totals
  are unaffected, but the dataset is "not ready" until the unit is corrected (enter percent) or a fraction column is approved.
- **D-2 QA status.** Workbook `08_Calculations!C21` says PASS; the application says INCOMPLETE because MB-04 cannot be evaluated
  without inventory movements (missing is never PASS). Not an error in either formula; a policy difference.
- **D-3 Workbook formula defects.** `08_Calculations` B31/B33/B34 contain broken formulas (Excel error code 29, `#NAME?`) and
  the C values next to them (−200, 2,074,380, 244,980, 11.81) are typed, not computed. The application does not read them.
- **D-4 Fuel period.** Depends on owner confirmation of §4.
- **D-5 Evidence.** 15/15 evidence references are "Mapped" (linked only). No original invoices, lab sheets or meter reads were
  supplied, so no source value could be traced to an original document.

## 7. Test evidence (executed in this environment)
- Pure suite (`tests/mrv/cases.ts` + acceptance) via dev self-test: **34/34 passed** after these changes (adds HS-05, EN-01;
  RF-01 now also covers totals, SEE and TSR on the synthetic fixture).
- Q1 reconciliation: no discrepancies; three documented not-comparable rows.
- PGlite migration/RPC/isolation harness: 40/40 and 18/18 previously; not re-run against hosted Supabase.
