# 07 — Sprint 1 Test Execution Evidence

Environment: local dev preview (Next.js 16.3.5 dev server), Chromium via Playwright, baseline commit `eba7e43`.
Method: browser automation against the **unmodified application code paths**. The app's own generated files were
captured from `URL.createObjectURL` and re-imported through the real upload dialog. Fixture edits used SheetJS
0.18.5 (same version as the app) loaded in the test page only. **All data below is synthetic.** No plant data was
available.

| ID | Test | Expected (correct MRV behaviour) | Actual | Result |
|---|---|---|---|---|
| T0a | `run_type_checks` | No errors | No errors | PASS |
| T0b | `run_build` (production) | Builds | Builds in 11.8 s; all 18 routes static (no server code) | PASS (confirms G-09) |
| T1 | Import the app's own **blank template**, unchanged | Rejected or flagged incomplete; no PASS | Accepted as valid; "18 PASSED / 0 FAILED / 100 % pass rate"; "All evidence mapped and verified"; all emissions 0 | **FAIL → G-03** |
| T2 | Template with production rows filled: row 4 = 175000/230000/175100 formatted `#,##0`; row 5 = 165000/215000/165050 unformatted | Clinker 340,000 t in production table and KPIs | Production table: row 4 shows **175 / 230 / 175**; row 5 correct. Overview clinker = **0 t** (from template's `08_Calculations`) | **FAIL → G-01, G-02** |
| T3 | Load demo → Export Data → re-import the exported file | Round-trip succeeds | Rejected: `Missing sheet: "13_Dashboard"`. Exported `08_Calculations` "Formula / Link" column empty. Existing data kept. | **FAIL → G-08** |
| T4 | Failed re-import does not destroy loaded data | Previous dataset retained | "Helwan Cement Plant" dataset retained | PASS |
| T5 | Demo dataset: engine output vs independent hand calculation (sandbox script, does not import app code) | Arithmetic agreement | See table below — agreement to displayed precision | PASS (arithmetic only) |
| T6 | Demo dataset QA status with clinker used > produced (stock delta −200 t, no opening stock data) | Not PASS without stock evidence | MB-04 PASS; overall PASS | **FAIL → G-04** |

## T5 — expected vs actual (synthetic demo, arithmetic only)

| Metric | Independent calc | App displayed | Δ |
|---|---|---|---|
| Total fuel energy (GJ) | 2,099,020 | 2,099,020 | 0 |
| Fossil fuel CO₂ (t) | 188,177.755 | 188,177.76 | rounding |
| Biogenic CO₂ memo (t) | 9,414.683 | 9,414.68 | rounding |
| Process CO₂ Method A (t) | 290,750.6345 (unrounded) | 290,750.63 (sum of row-rounded) | 0.0045 (G-19) |
| Process CO₂ Method B (t) | 276,900 | 276,900.00 | 0 |
| Method A vs B | +5.00 % | not shown as a comparison | (G-17) |
| Grid CO₂ (t) | 46,341 | 46,341.00 | 0 |
| Direct CO₂ (t) | 465,077.755 | 465,077.76 | rounding |
| Total "embedded" CO₂ (t) | 511,418.755 | 511,418.76 | rounding |
| SEE clinker (t/t) | 0.89438 | 0.8944 | rounding |
| SEE cement (t/t), app basis | 0.75209 | 0.7521 | rounding |
| SEE cement, clinker-used basis (alternative, for discussion only) | 0.75235 | — | basis question (G-13) |
| SHC (GJ/t clinker) | 4.0366 | 4.037 | rounding |
| TSR (%) | 11.664 | 11.66 | rounding |

Agreement shows the engine sums correctly. It does **not** validate methodology, factors or boundaries.

## Not executed (honest record)
- No automated test suite exists; none was run.
- `npm audit` not executed (VT-06).
- Date/timezone import behaviour not tested in a UTC+2 environment (VT-05).
- No real Q1 2025 workbook was available (VT-02); no audit document (VT-01).
