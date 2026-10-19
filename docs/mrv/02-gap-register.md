# 02 — Evidence-Backed Gap Register (Sprint 1)

Severity: **Critical** (corrupts reported figures/status or makes MRV close impossible), **High**, **Medium**, **Low**.
Test IDs (T1–T6) refer to [07-sprint1-test-evidence.md](07-sprint1-test-evidence.md).

## A. Data integrity and calculation

| ID | Sev | Finding | Evidence | Class. | Target sprint |
|---|---|---|---|---|---|
| G-01 | Critical | Uploaded workbooks are **never calculated**. KPIs, QA/QC, report outputs and dashboard come verbatim from sheets 08/09/10/13; input sheets 03–06 are display-only and never reconciled with them. | `lib/parser.ts:192-244` (no `calculateStore` call); T2: 340,000 t clinker entered → Overview 0 t | CONFIRMED | S3/S5 |
| G-02 | Critical | Numbers are parsed from **formatted text** (`raw:false`) with `parseFloat`, so thousands separators truncate values: `175,000` → 175; `175,100` → 175. Affects every numeric cell incl. `08_Calculations` and constants. | `lib/parser.ts:146, 181-186`; T2 | CONFIRMED | S3 |
| G-03 | Critical | The app's own blank template contains hardcoded `PASS` for all 18 checks, dashboard `QA/QC Status = PASS`, evidence `Mapped`, and formulas written as text strings. An **empty** template imports as valid: 18/18 PASS, "100% pass rate", "All evidence mapped and verified", all emissions 0. | `lib/export.ts:527-541, 549-566, 585-588, 608`; T1 | CONFIRMED | S3/S6 |
| G-04 | High | Hardcoded PASS in engine: PR-01 (no date check), MB-04 (no stock check). Report/UI default missing status to PASS/Mapped. | `calcEngine.ts:401-421`; `export.ts:78-79`; `dataentry/page.tsx:316`; T5 (−200 t stock delta → PASS) | CONFIRMED | S6 |
| G-05 | High | Missing → zero and silent defaults: `toNum(v, 0)`; oxidation factor → 1.0; calcination conversion → 1.0; grid EF → 0.4878; clinker EF → 0.5325 when constant row absent. | `calcEngine.ts:39-43, 81, 98-99, 124, 186-188` | CONFIRMED | S2/S5 |
| G-06 | High | Duplicated formulas in UI (data entry live preview, page-level re-aggregation). | See 01 §4 | CONFIRMED | S5 |
| G-07 | High | Two divergent calculation sources (Excel cached values vs `calcEngine`) feed the same reports. Same inputs can produce different results depending on entry path. | 01 §2 | CONFIRMED | S5 |
| G-08 | High | Own Excel export cannot be re-imported (no `13_Dashboard`; headers on row 1 vs parser row 3). Formula column exported empty (key mismatch `Formula` vs `Formula / Link`). | `export.ts:340-414, 393`; `calcEngine.ts` calcList key `Formula`; T3 | CONFIRMED | S3 |
| G-12 | High | Units not modelled: fuel `Unit` column ignored; NCV unit assumed to match quantity unit; percent vs fraction implicit (`CaCO3 %`/100, biomass 0–1, TSR %). No dimension checks. | `calcEngine.ts:93-115, 64-90` | CONFIRMED | S2 |
| G-13 | High | Product intensity: `SEE cement = (process + fossil fuel + grid) / cement produced`. Ignores clinker consumed vs produced, stock change, purchased/sold clinker; mixes direct and indirect; single product only. | `calcEngine.ts:209-214` | CONFIRMED (logic); methodology validity UNVERIFIED | S4/S5 |
| G-14 | Medium | SHC numerator = all fuel energy in `05_Kiln_Fuel_Input` (no kiln vs drying/auxiliary split); denominator clinker produced. | `calcEngine.ts:205` | CONFIRMED (logic) | S4 |
| G-15 | Medium | Path U trusts stored `Energy GJ`, `Fossil CO2 t` without checking Qty × NCV × EF. | `parser.ts` `parse05` | CONFIRMED (code) | S3/S4 |
| G-16 | Medium | Clinker balance = produced − used only; no opening/closing stock, purchases, sales, transfers, CKD/bypass dust. | `calcEngine.ts:215, 412-421` | CONFIRMED | S5 |
| G-17 | Medium | Method A and B both computed; selection by `String.includes("Method A")`; no comparability or boundary explanation. Method A excludes CKD/bypass dust, organic carbon, non-carbonate CaO. Demo A vs B differ by 5.0 %. | `calcEngine.ts:179-193`; T5 | CONFIRMED (logic) | S4 |
| G-18 | Medium | Factor provenance unverified: clinker EF 0.5325 "IPCC default for 65 % CaO"; grid EF 0.4878 "Egypt Q1 2025" (URL is a homepage); fuel defaults have no source/version/effective date. | `calcEngine.ts:13-36` | UNVERIFIED — VT-04 | S4 |
| G-19 | Medium | Intermediate per-row rounding (`toFixed(2/4)`) before summing; binary floating point; no documented precision policy. Demo impact 0.0045 t on Method A. | `calcEngine.ts:86-88, 107-112`; T5 | CONFIRMED | S2/S5 |
| G-24 | Medium | Dates: `parseDate` uses `toISOString()`; for local-time `Date` objects in UTC+ zones (Egypt UTC+2) this can shift a date back one day. No period-boundary check exists (PR-01 hardcoded). | `parser.ts:163-178` | PARTIALLY VERIFIED — VT-05 | S2/S3 |

## B. Validation, evidence, governance

| ID | Sev | Finding | Evidence | Class. | Target sprint |
|---|---|---|---|---|---|
| G-20 | High | Import validation = sheet names + row-3 header labels only. No type, range, unit, period, facility, duplicate, or file-size checks; parse functions never add errors after headers pass. | `parser.ts:200-243` | CONFIRMED | S3 |
| G-26 | High | Evidence is an ID/status register; no files, checksums or reviewer decisions. "Mapped" is displayed as "verified". | `parse11`; `overview/page.tsx:258`; `export.ts:276` | CONFIRMED | S7 |
| G-10 | High | Unsupported compliance/verification claims in UI and PDF ("EU ETS / CBAM Aligned", "ISO 14064 Compliance Assurance", "automated cross-sheet reconciliation", "verified fields", "100 % compliant", "per CBAM rules"). | 01 §5 | CONFIRMED | S1 follow-up / S8 |
| G-11 | High | Synthetic demo uses a real plant name ("Helwan Cement Plant") and notes "ISO 17025 accredited", "Verified"; PDF carries no demo watermark. Demo could be presented as real/verified data. | `calcEngine.ts:519, 557-562`; `export.ts` | CONFIRMED | S8 (quick fix proposed earlier) |
| G-27 | Medium | Data entry: a `localStorage` draft takes priority over a loaded workbook, silently replacing what the user sees in the form. | `dataentry/page.tsx:160-180` | CONFIRMED (code) | S3 |

## C. Platform, security, operations

| ID | Sev | Finding | Evidence | Class. | Target sprint |
|---|---|---|---|---|---|
| G-09 | Critical | No backend, database, authentication, authorization, tenancy, audit trail, approval or locking. Dataset lost on refresh. | Build output (all static); `StoreContext.tsx:29` | CONFIRMED | S2/S7 (needs D-01) |
| G-21 | Medium | xlsx 0.18.5 (last npm-registry release) and jspdf 2.5.2. Public advisories are reported for xlsx < 0.19.3 (prototype pollution) and < 0.20.2 (ReDoS), and for older jspdf releases. | `package-lock.json:4556, 6416` | PARTIALLY VERIFIED — VT-06 (`npm audit`) | S3/S10 |
| G-22 | Low | `.gitignore` has no `.env*` pattern. `.env.local` exists but is **not** tracked at HEAD (verified). `*.xlsx` ignored → reference data needs a deliberate storage decision. | `.gitignore`; git HEAD check | CONFIRMED | S2 |
| G-23 | Medium | No automated tests, test runner or CI. | `package.json` | CONFIRMED | S2 (D-05) |
| G-25 | Medium | Uploaded files are not preserved; no checksum; no duplicate-upload detection; no import history. | `StoreContext.tsx` `handleFile` | CONFIRMED | S3 |

## D. Audit findings F01–F09 (audit document not supplied)

The audit referenced in the brief is **not present** in the repository or prior chat history (searched). Mapping
below uses only the one-line descriptions in the Sprint 4 brief. Audit numbers are not treated as plant quantities.

| Audit | Brief description | Mapped to | Status |
|---|---|---|---|
| F01 | Quantity/display scaling and report totals | G-02 (thousands-separator truncation ×1000), G-01 (totals not derived from inputs) | Mechanism CONFIRMED; audit's specific figures UNVERIFIED (VT-01) |
| F02 | Clinker production, consumption, stock changes | G-16, G-04 (MB-04) | Mechanism CONFIRMED; quantities need Q1 data (VT-02) |
| F03 | Fuel-energy/clinker denominator consistency in SHC | G-14 | Logic CONFIRMED; impact needs Q1 data |
| F04 | Fuel quantity × calorific value vs stored energy | G-15 | Code path CONFIRMED; impact needs Q1 data |
| F05 | Product-allocated clinker vs reconciled clinker consumption | G-13 | Logic CONFIRMED; impact needs Q1 data |
| F06 | Method A/B process-emissions differences | G-17 | Logic CONFIRMED; 5.0 % on synthetic demo only |
| F07 | Not described in brief | — | UNVERIFIED (VT-01) |
| F08 | Not described in brief | — | UNVERIFIED (VT-01) |
| F09 | Not described in brief | — | UNVERIFIED (VT-01) |

## E. Audit acceptance tests AT-01–AT-10

No automated tests exist in the repository, so **no AT has an existing test**. AT definitions are not available
(VT-01). Sprint 1 manual tests T1–T6 will be cross-mapped once definitions are supplied.

| AT | Existing test | Status |
|---|---|---|
| AT-01 … AT-10 | None | UNVERIFIED — definitions required (D-02) |

## F. Verification tasks

| ID | Task | Owner | Blocks |
|---|---|---|---|
| VT-01 | Obtain audit document (F01–F09, AT-01–AT-10) and re-map | MRV lead | S4 exit, S8 exit |
| VT-02 | Obtain real Q1 2025 workbook(s) + 9/13/14-sheet references; record checksums | Plant data owner | S3, S4, S8 |
| VT-03 | Declare reporting profiles and authoritative basis for Q1 2025 | MRV lead | S4, S5 |
| VT-04 | Source every default factor (clinker EF, grid EF, fuel NCV/EF/biomass) with document, version, effective period | Methodology owner | S4 |
| VT-05 | Execute date-import test in UTC+2 environment with real date cells | QA | S3 |
| VT-06 | Run `npm audit` / SCA and record results | Security | S3 |
